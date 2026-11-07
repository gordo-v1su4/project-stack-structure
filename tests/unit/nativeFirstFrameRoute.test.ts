import { beforeEach, expect, mock, test } from "bun:test";
import { h3ProjectFixture } from "../helpers/h3Project";
let fixture = h3ProjectFixture(), signedIn = true, reads = 0, enrollments = 0, receiptReads = 0, drift = false, scopeRejected = false;
mock.module("@/lib/session", () => ({ getSessionUser: async () => signedIn ? { id: "github-test" } : null, unauthorizedResponse: () => Response.json({}, { status: 401 }) }));
mock.module("@/lib/studioProjectStore", () => ({ readStudioProject: async (owner: string, id: string) => {
  reads++; if (owner !== "github-test" || id !== fixture.saved.project.id) return null;
  return { ...fixture.saved, revision: drift && reads > 1 ? '"other"' : fixture.saved.revision };
} }));
mock.module("@/lib/mediaGateway", () => ({ getMediaGatewayConfig: () => ({ bucket: "studio" }), normalizeMediaPath: (v: string) => v }));
mock.module("@/lib/h3JobStore", () => ({ pinH3JobReferences: async (job: unknown) => job }));
mock.module("@/lib/generationScopeServer", () => ({ validateSavedGenerationScope: async () => { if (scopeRejected) throw new Error("private raw evidence failure"); }, assertMaterializationGenerationScope: () => fixture.request.planSignature }));
mock.module("@/lib/nativeFirstFrameSource", () => ({
  registerNativeFirstFrame: async (params: { isCurrent: () => Promise<boolean> }) => {
    if (!await params.isCurrent()) throw new Error("private baseline changed"); enrollments++;
    return { artifact: { id: "artifact" }, sourceReceipt: { id: "source" } };
  }, readNativeFirstFrameReceipt: async () => { receiptReads++; return { id: "source" }; },
  readNativeFirstFrameReceiptForJob: async () => { receiptReads++; return { id: "source" }; },
}));
const route = await import("@/app/api/generate/h3/native-first-frame/route");
beforeEach(() => { fixture = h3ProjectFixture(); fixture.saved.revision = '"revision-1"'; signedIn = true; reads = enrollments = receiptReads = 0; drift = scopeRejected = false; });
const body = () => ({ shot: { ...fixture.request, identityPolicyFamily: "sface-yunet-foreground-frontal-v2" }, source: { frameIndex: 54 }, upload: { bucket: "studio", objectKey: "owned" }, expectedSha256: "a".repeat(64) });
const post = (input: unknown) => route.POST(new Request("https://app.test/api/generate/h3/native-first-frame", { method: "POST", body: JSON.stringify(input) }));

test("anonymous methods short-circuit every source/project read and enrollment", async () => {
  signedIn = false; expect((await post(body())).status).toBe(401);
  expect((await route.GET(new Request("https://app.test?projectId=project-1&receiptId=x"))).status).toBe(401);
  expect(reads).toBe(0); expect(enrollments).toBe(0); expect(receiptReads).toBe(0);
});
test("a current owned target prepares source evidence without changing the saved project", async () => {
  const before = JSON.stringify(fixture.saved), response = await post(body());
  expect(response.status).toBe(200); expect((await response.json()).sourceReceipt.id).toBe("source"); expect(enrollments).toBe(1);
  expect(JSON.stringify(fixture.saved)).toBe(before);
});
test("wrong owner/project, changed plan, bad policy and conditioned input cannot enroll", async () => {
  for (const shot of [{ ...body().shot, projectId: "foreign" }, { ...body().shot, planSignature: "stale" },
    { ...body().shot, identityPolicyFamily: "sface-yunet-foreground-frontal-v1" }, { ...body().shot, conditioning: { kind: "first-frame", artifactId: "invalid", expectedSha256: "a".repeat(64) } }]) {
    expect((await post({ ...body(), shot })).status).toBeGreaterThanOrEqual(400);
  } expect(enrollments).toBe(0);
});
test("canonical source context failure and late baseline drift never enroll and do not leak raw errors", async () => {
  for (const cause of ["scope", "drift"]) {
    reads = 0; scopeRejected = cause === "scope"; drift = cause === "drift";
    const response = await post(body()); expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private");
  } expect(enrollments).toBe(0);
});
test("GET checks ownership before retrieving a source receipt", async () => {
  expect((await route.GET(new Request("https://app.test?projectId=foreign&receiptId=x"))).status).toBe(404); expect(receiptReads).toBe(0);
  expect((await route.GET(new Request("https://app.test?projectId=project-1&receiptId=x"))).status).toBe(200); expect(receiptReads).toBe(1);
  expect((await route.GET(new Request("https://app.test?projectId=project-1&jobId=x"))).status).toBe(200); expect(receiptReads).toBe(2);
});
