import { describe, expect, mock, test } from "bun:test";
import type { H3GenerationJob } from "@/components/studio/h3Generation";
import { h3ProjectFixture } from "../helpers/h3Project";

const fixture = h3ProjectFixture();
let signedIn = true, dispatches = 0;
let stored: H3GenerationJob | null = null;
mock.module("@/lib/session", () => ({
  getSessionUser: async () => signedIn ? { id: "github-test" } : null,
  unauthorizedResponse: () => Response.json({ success: false }, { status: 401 }),
}));
mock.module("@/lib/studioProjectStore", () => ({
  readStudioProject: async (owner: string, project: string, options: { fresh?: boolean }) => {
    expect(options.fresh).toBe(true);
    return owner === "github-test" && project === "project-1" ? fixture.saved : null;
  },
}));
mock.module("@/lib/mediaGateway", () => ({ getMediaGatewayConfig: () => ({ bucket: "studio" }), normalizeMediaPath: (value: string) => value }));
mock.module("@/lib/h3JobStore", () => ({
  claimH3GenerationIntent: async () => {},
  pinH3JobReferences: async (job: H3GenerationJob) => job,
  createH3Job: async (job: H3GenerationJob) => { if (!stored) stored = job; return stored; },
  readH3Job: async () => stored,
  listH3Jobs: async () => stored ? [stored] : [],
  updateH3Job: async (_owner: string, _project: string, _id: string, change: (job: H3GenerationJob) => H3GenerationJob) => {
    stored = change(stored!); return stored;
  },
}));
mock.module("@/lib/triggerOrchestration", () => ({
  triggerH3Generation: async () => { dispatches++; return { id: `run-${dispatches}` }; },
  retrieveTriggerRun: async () => ({ isCompleted: true, isFailed: true }),
}));
const { POST, GET, PATCH } = await import("@/app/api/generate/h3/route");
function post(body: unknown) { return new Request("http://app.test/api/generate/h3", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); }
function reset() { signedIn = true; stored = null; dispatches = 0; }

describe("authenticated H3 dispatch and recovery route", () => {
  test("every method requires a session and dispatch creates no work anonymously", async () => {
    reset(); signedIn = false;
    expect((await POST(post(fixture.request))).status).toBe(401);
    expect((await GET(new Request("http://app.test/api/generate/h3?projectId=project-1"))).status).toBe(401);
    expect((await PATCH(post({ projectId: "project-1", jobId: "unknown", action: "cancel" }))).status).toBe(401);
    expect(dispatches).toBe(0);
  });

  test("persists intent then dispatches once and returns the existing durable job on replay", async () => {
    reset();
    const first = await POST(post({ ...fixture.request, draftRevision: 7 }));
    expect(first.status).toBe(202);
    const body = await first.json() as { job: H3GenerationJob; runId: string };
    expect(body.runId).toBe("run-1"); expect(body.job.request.draftRevision).toBe(7);
    expect((await POST(post({ ...fixture.request, draftRevision: 7 }))).status).toBe(202);
    expect(dispatches).toBe(1);
    const list = await GET(new Request("http://app.test/api/generate/h3?projectId=project-1"));
    expect(((await list.json()) as { jobs: H3GenerationJob[] }).jobs).toHaveLength(1);
  });

  test("rejects stale or foreign projects before storage or GPU dispatch", async () => {
    reset();
    expect((await POST(post({ ...fixture.request, planSignature: "old" }))).status).toBe(409);
    expect((await POST(post({ ...fixture.request, projectId: "foreign" }))).status).toBe(404);
    expect(dispatches).toBe(0); expect(stored).toBeNull();
  });

  test("resumes an existing submission after a terminal worker without changing provider identity", async () => {
    reset(); await POST(post(fixture.request));
    stored = { ...stored!, state: "submission_unknown", promptId: "provider-original" };
    const resumed = await PATCH(post({ projectId: "project-1", jobId: stored.id, action: "resume", requestIntentId: fixture.request.requestIntentId }));
    expect(resumed.status).toBe(202);
    expect(stored?.promptId).toBe("provider-original");
    expect(stored?.runId).toBe("run-2");
    expect(dispatches).toBe(2);
  });

  test("cancelling a queued job prevents it entering provider execution", async () => {
    reset(); await POST(post(fixture.request));
    const cancelled = await PATCH(post({ projectId: "project-1", jobId: stored!.id, action: "cancel" }));
    expect(cancelled.status).toBe(200);
    expect(stored?.state).toBe("cancelled");
    expect(dispatches).toBe(1);
  });

  test("reload exposes a terminated worker as reconciliation-needed rather than indefinitely rendering", async () => {
    reset(); await POST(post(fixture.request));
    stored = { ...stored!, state: "rendering", promptId: "provider-original" };
    const response = await GET(new Request(`http://app.test/api/generate/h3?projectId=project-1&jobId=${stored.id}`));
    const body = await response.json() as { job: H3GenerationJob };
    expect(body.job.state).toBe("submission_unknown");
    expect(body.job.promptId).toBe("provider-original");
    expect(dispatches).toBe(1);
  });

  test("cancel intent survives worker termination and remains resumable for cleanup", async () => {
    reset(); await POST(post(fixture.request));
    stored = { ...stored!, state: "rendering", promptId: "provider-original" };
    await PATCH(post({ projectId: "project-1", jobId: stored.id, action: "cancel" }));
    expect(Boolean(stored?.cancelRequestedAt)).toBe(true);
    await GET(new Request(`http://app.test/api/generate/h3?projectId=project-1&jobId=${stored!.id}`));
    expect(stored?.state).toBe("submission_unknown");
    expect(Boolean(stored?.cancelRequestedAt)).toBe(true);
    const resumed = await PATCH(post({ projectId: "project-1", jobId: stored!.id, action: "resume", requestIntentId: fixture.request.requestIntentId }));
    expect(resumed.status).toBe(202);
    expect(Boolean(stored?.cancelRequestedAt)).toBe(true);
    expect(stored?.promptId).toBe("provider-original");
  });
});
