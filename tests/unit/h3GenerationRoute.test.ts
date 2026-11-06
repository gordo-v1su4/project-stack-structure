import { describe, expect, mock, test } from "bun:test";
import { H3_LEGACY_PROFILE, H3_PROFILE, type H3GenerationJob } from "@/components/studio/h3Generation";
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
  claimH3GenerationIntent: async (job: H3GenerationJob) => {
    if (stored && stored.request.requestIntentId === job.request.requestIntentId
      && stored.request.attempt === job.request.attempt && stored.id !== job.id) throw new H3RequestError("Intent conflict", 409);
  },
  pinH3JobReferences: async (job: H3GenerationJob) => job,
  createH3Job: async (job: H3GenerationJob) => { if (!stored) stored = job; return stored; },
  readH3Job: async (_owner: string, _project: string, id: string) => stored?.id === id ? stored : null,
  listH3Jobs: async () => stored ? [stored] : [],
  updateH3Job: async (_owner: string, _project: string, _id: string, change: (job: H3GenerationJob) => H3GenerationJob) => {
    stored = change(stored!); return stored;
  },
}));
mock.module("@/lib/triggerOrchestration", () => ({
  triggerH3Generation: async () => { dispatches++; return { id: `run-${dispatches}` }; },
  triggerH3IdentityRecheck: async () => { dispatches++; return { id: "cpu-recheck-run" }; },
  retrieveTriggerRun: async () => ({ isCompleted: true, isFailed: true }),
}));
const { POST, GET, PATCH } = await import("@/app/api/generate/h3/route");
const { H3RequestError, materializeH3Job, parseH3Request } = await import("@/lib/h3GenerationServer");
function post(body: unknown) { return new Request("http://app.test/api/generate/h3", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); }
function reset() { signedIn = true; stored = null; dispatches = 0; fixture.saved.draft.generatedAssets = []; }

describe("authenticated H3 dispatch and recovery route", () => {
  test("identity recheck dispatches a CPU task without replacing the render run and respects user rejection", async () => {
    reset(); await POST(post(fixture.request));
    stored = { ...stored!, state: "ready", result: { asset: { id: stored!.id, jobId: stored!.id,
      provider: "swarmui", model: stored!.profile, prompt: "fixture", createdAt: stored!.createdAt,
      status: "completed", reviewStatus: "pending" } } };
    const body = { projectId: "project-1", jobId: stored.id, action: "recheck_identity", requestIntentId: fixture.request.requestIntentId };
    const response = await PATCH(new Request("http://app.test/api/generate/h3", { method: "PATCH", body: JSON.stringify(body) }));
    expect(response.status).toBe(202);
    expect((await response.json()).verificationRunId).toBe("cpu-recheck-run");
    expect(stored.runId).toBe("run-1"); expect(dispatches).toBe(2);
    fixture.saved.draft.generatedAssets = [{ ...stored.result!.asset, reviewStatus: "rejected" }];
    expect((await PATCH(new Request("http://app.test/api/generate/h3", { method: "PATCH", body: JSON.stringify(body) }))).status).toBe(409);
    expect(dispatches).toBe(2);
  });
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

  test("recovers an exact legacy intent whose durable job was saved before dispatch", async () => {
    reset();
    stored = materializeH3Job("github-test", fixture.saved, parseH3Request(fixture.request), "studio", { profile: H3_LEGACY_PROFILE });
    const originalId = stored.id;
    const response = await POST(post(fixture.request));
    expect(response.status).toBe(202);
    const body = await response.json() as { job: H3GenerationJob };
    expect(body.job.id).toBe(originalId);
    expect(body.job.profile).toBe(H3_LEGACY_PROFILE);
    expect(body.job.conditioningPreparationVersion).toBe(undefined);
    expect(body.job.runId).toBe("run-1");
    await POST(post(fixture.request));
    expect(dispatches).toBe(1);
  });

  test("new intents use v2 and a changed legacy prompt or reference cannot claim the old intent", async () => {
    reset();
    const fresh = await POST(post(fixture.request));
    expect(((await fresh.json()) as { job: H3GenerationJob }).job.profile).toBe(H3_PROFILE);
    reset();
    stored = materializeH3Job("github-test", fixture.saved, parseH3Request(fixture.request), "studio", { profile: H3_LEGACY_PROFILE });
    const snapshot = JSON.stringify(stored);
    expect((await POST(post({ ...fixture.request, prompt: "Diego waits beside the booths." }))).status).toBe(409);
    expect((await POST(post({ ...fixture.request, referenceAssetIds: ["club", "diego"] }))).status).toBe(409);
    expect((await POST(post({ ...fixture.request, planSignature: "stale" }))).status).toBe(409);
    expect(dispatches).toBe(0);
    expect(JSON.stringify(stored)).toBe(snapshot);
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
