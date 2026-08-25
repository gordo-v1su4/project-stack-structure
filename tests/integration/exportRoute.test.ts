import { describe, expect, mock, test } from "bun:test";

const authState = { signedIn: true };
const capturedFinalExportPayloads: Array<Record<string, unknown>> = [];

mock.module("@/auth", () => ({
  auth: async () => (authState.signedIn ? { user: { id: "github-test-user", login: "test-user" } } : null),
}));

mock.module("@/lib/mediaGateway", () => ({
  normalizeMediaPath: (value: string) => value,
  getMediaGatewayConfig: () => ({
    url: "https://media.test",
    token: "test-token",
    userId: "test-user",
    bucket: "test-bucket",
    uploadPrefix: "uploads",
  }),
  uploadFileToMediaGateway: async ({ file }: { file: File }) => ({
    bucket: "test-bucket",
    objectKey: `uploads/${file.name}`,
    mediaUrl: `https://media.test/${file.name}`,
    publicUrl: `https://media.test/${file.name}`,
  }),
  downloadJsonFromMediaGateway: async () => {
    throw new Error("404 not found");
  },
  uploadJsonToMediaGateway: async ({ data }: { data: unknown }) => ({
    bucket: "test-bucket",
    objectKey: "uploads/claim.json",
    publicUrl: "https://media.test/claim.json",
    payload: data,
  }),
}));

mock.module("@/lib/triggerOrchestration", () => ({
  triggerFinalExport: async (payload: Record<string, unknown>) => {
    capturedFinalExportPayloads.push(payload);
    return { id: "run-test-123" };
  },
}));

const { POST } = await import("@/app/api/export/final/route");

function buildValidForm() {
  const form = new FormData();
  form.set("requestKey", "route-final-export-validation-test");
  form.set("audio", new File([new Uint8Array([1, 2, 3])], "master.wav", { type: "audio/wav" }));
  form.set("file:0", new File([new Uint8Array([4, 5, 6])], "source0.mp4", { type: "video/mp4" }));
  form.set("segments", JSON.stringify([{ sourceIndex: 0, startTime: 0, endTime: 1, musicStart: 8, musicEnd: 9 }]));
  form.set("beats", JSON.stringify([8.25, 8.75]));
  form.set("lyricChunks", JSON.stringify([]));
  form.set("shaderPresetId", "high-energy-glitch");
  form.set(
    "shaderCues",
    JSON.stringify([
      { id: "beat-0", kind: "glitch-cut", start: 0, end: 0.2, intensity: 0.85, sync: "beat" },
      { id: "section-0", kind: "duotone-pulse", start: 0, end: 1, intensity: 0.65, sync: "section" },
    ]),
  );
  form.set("accentKinds", JSON.stringify({ beat: "glitch-cut", section: "duotone-pulse" }));
  return form;
}

describe("POST /api/export/final", () => {
  test("R1: rejects anonymous callers with 401 before any dispatch", async () => {
    authState.signedIn = false;
    const response = await POST(new Request("http://localhost/api/export/final", { method: "POST", body: buildValidForm() }));
    expect(response.status).toBe(401);
    expect(capturedFinalExportPayloads).toHaveLength(0);
    authState.signedIn = true;
  });

  test("rejects an incomplete export before dispatching Trigger.dev", async () => {
    const form = new FormData();
    form.set("requestKey", "route-final-export-validation-test");
    form.set("segments", JSON.stringify([{ sourceIndex: 0, startTime: 0, endTime: 1 }]));

    const response = await POST(new Request("http://localhost/api/export/final", { method: "POST", body: form }));
    const payload = await response.json() as { success?: boolean; error?: string };

    expect(response.status).toBe(400);
    expect(payload.success).toBe(false);
    expect(payload.error).toMatch(/audio|required/i);
  });

  test("S3: forwards the browser's shaderCues verbatim as effectCues plus accentKinds to Trigger.dev", async () => {
    const response = await POST(new Request("http://localhost/api/export/final", { method: "POST", body: buildValidForm() }));
    const payload = await response.json() as { success?: boolean; runId?: string; requestKey?: string };

    expect(response.status).toBe(202);
    expect(payload.success).toBe(true);
    expect(payload.runId).toBe("run-test-123");

    const dispatched = capturedFinalExportPayloads.at(-1)!;
    expect(dispatched.effectCues).toEqual([
      { id: "beat-0", kind: "glitch-cut", start: 0, end: 0.2, intensity: 0.85, sync: "beat" },
      { id: "section-0", kind: "duotone-pulse", start: 0, end: 1, intensity: 0.65, sync: "section" },
    ]);
    expect(dispatched.accentKinds).toEqual({ beat: "glitch-cut", section: "duotone-pulse" });
    expect((dispatched.segments as Array<Record<string, unknown>>)[0]).toMatchObject({ musicStart: 8, musicEnd: 9 });
  });

  test("omits effectCues/accentKinds when the client does not send them", async () => {
    const form = buildValidForm();
    form.delete("shaderCues");
    form.delete("accentKinds");

    await POST(new Request("http://localhost/api/export/final", { method: "POST", body: form }));

    const dispatched = capturedFinalExportPayloads.at(-1)!;
    expect(dispatched.effectCues).toBe(undefined);
    expect(dispatched.accentKinds).toBe(undefined);
  });
});
