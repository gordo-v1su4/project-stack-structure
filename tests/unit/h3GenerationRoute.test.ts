import { describe, expect, mock, test } from "bun:test";
import { H3_LEGACY_PROFILE, H3_PROFILE, H3_V2_PROFILE, H3_V2_CONDITIONING_PREPARATION_VERSION, type H3GenerationJob } from "@/components/studio/h3Generation";
import { h3ProjectFixture } from "../helpers/h3Project";
import { H3_FIRST_FRAME_PROFILE, type H3FirstFrameArtifact } from "@/components/studio/h3FirstFrame";
import { firstFrameArtifactFixture } from "../helpers/h3FirstFrame";

const fixture = h3ProjectFixture();
let signedIn = true, dispatches = 0;
let workerTerminal = true;
let dispatchFailure: "before" | "after" | undefined;
let dispatchHook: ((runId: string) => void) | undefined;
let failNextJobUpdate = false;
let beforeNextJobUpdate: (() => void) | undefined;
const generationHandles = new Map<string, string>();
const dispatchKeys: string[] = [];
let stored: H3GenerationJob | null = null;
let firstFrameArtifact:H3FirstFrameArtifact|null=null;
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
const {assertH3FirstFrameMatchesJob}=await import("@/lib/h3FirstFrameStore");
mock.module("@/lib/h3FirstFrameStore",()=>({assertH3FirstFrameMatchesJob,readH3FirstFrame:async()=>firstFrameArtifact}));
mock.module("@/lib/h3JobStore", () => ({
  claimH3GenerationIntent: async (job: H3GenerationJob) => {
    if (stored && stored.request.requestIntentId === job.request.requestIntentId
      && stored.request.attempt === job.request.attempt && stored.id !== job.id) throw new H3RequestError("Intent conflict", 409);
  },
  pinH3JobReferences: async (job: H3GenerationJob) => job.firstFrame?{...job,references:job.firstFrame.body.references,id:h3GenerationJobId(job.ownerId,job.request,job.firstFrame.body.references,job)}:job,
  createH3Job: async (job: H3GenerationJob) => { if (!stored) stored = job; return stored; },
  readH3Job: async (_owner: string, _project: string, id: string) => stored?.id === id ? stored : null,
  listH3Jobs: async () => stored ? [stored] : [],
  updateH3Job: async (_owner: string, _project: string, _id: string, change: (job: H3GenerationJob) => H3GenerationJob) => {
    if (failNextJobUpdate) { failNextJobUpdate = false; throw new Error("Storage acknowledgement unavailable"); }
    const hook = beforeNextJobUpdate; beforeNextJobUpdate = undefined; hook?.();
    stored = change(stored!); return stored;
  },
}));
mock.module("@/lib/triggerOrchestration", () => ({
  triggerH3Generation: async (job: H3GenerationJob, intent?: string) => {
    const key = `${job.id}:${intent ?? "initial"}`; dispatchKeys.push(key);
    if (dispatchFailure === "before") { dispatchFailure = undefined; throw new Error("Dispatch unavailable before enqueue"); }
    let id = generationHandles.get(key);
    if (!id) { id = `run-${++dispatches}`; generationHandles.set(key, id); }
    const hook = dispatchHook; dispatchHook = undefined; hook?.(id);
    if (dispatchFailure === "after") { dispatchFailure = undefined; throw new Error("Dispatch response lost after enqueue"); }
    return { id };
  },
  triggerH3IdentityRecheck: async () => { dispatches++; return { id: "cpu-recheck-run" }; },
  retrieveTriggerRun: async () => ({ isCompleted: workerTerminal, isFailed: workerTerminal, isCancelled: false }),
}));
const { POST, GET, PATCH } = await import("@/app/api/generate/h3/route");
const { H3RequestError, h3GenerationJobId, materializeH3Job, parseH3Request } = await import("@/lib/h3GenerationServer");
function post(body: unknown) { return new Request("http://app.test/api/generate/h3", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); }
function reset() { signedIn = true; stored = null; dispatches = 0; workerTerminal = true; firstFrameArtifact=null; fixture.saved.draft.generatedAssets = [];
  delete fixture.saved.draft.storyState.sceneProofPlan;
  dispatchFailure = undefined; dispatchHook = undefined; failNextJobUpdate = false; beforeNextJobUpdate = undefined; generationHandles.clear(); dispatchKeys.length = 0;
}
const recoveryIntent = "44556677-1234-4123-8123-123456789abc";
const anotherRecoveryIntent = "55667788-1234-4123-8123-123456789abc";
const resumeBody = (intent = recoveryIntent) => ({ projectId: "project-1", jobId: stored!.id, action: "resume", requestIntentId: intent });

describe("authenticated H3 dispatch and recovery route", () => {
  test("unapproved scene plans create no video job while submitted history remains recoverable", async () => {
    reset();
    fixture.saved.draft.storyState.sceneProofPlan = { version: 1, projectId: "project-1", contextSha256: "0".repeat(64), scenes: [] };
    expect((await POST(post(fixture.request))).status).toBe(409);
    expect(stored).toBeNull(); expect(dispatches).toBe(0);
    reset();
    await POST(post(fixture.request));
    stored = { ...stored!, state: "rendering", promptId: "already-submitted" };
    fixture.saved.draft.storyState.sceneProofPlan = { version: 1, projectId: "project-1", contextSha256: "0".repeat(64), scenes: [] };
    expect((await POST(post(fixture.request))).status).toBe(202);
    expect(stored.promptId).toBe("already-submitted"); expect(dispatches).toBe(1);
    delete fixture.saved.draft.storyState.sceneProofPlan;
  });
  test("explicit first-frame requests resolve an owned immutable artifact and never silently dispatch Ref2VA",async()=>{
    reset();const shot={...fixture.request,identityPolicyFamily:"sface-yunet-foreground-frontal-v2" as const};
    firstFrameArtifact=firstFrameArtifactFixture(materializeH3Job("github-test",fixture.saved,shot,"studio"));
    const input={...shot,conditioning:{kind:"first-frame",artifactId:firstFrameArtifact.id,expectedSha256:firstFrameArtifact.body.pngSha256}};
    const response=await POST(post(input));expect(response.status).toBe(202);expect(stored!.profile).toBe(H3_FIRST_FRAME_PROFILE);expect(stored!.firstFrame).toEqual(firstFrameArtifact);expect(dispatches).toBe(1);
    await POST(post(input));expect(dispatches).toBe(1);
    reset();expect((await POST(post(input))).status).toBe(409);expect(dispatches).toBe(0);
  });
  test("a new no-range identity recheck cannot dispatch legacy overwrite work and still respects rejection", async () => {
    reset(); await POST(post(fixture.request));
    stored = { ...stored!, state: "ready", result: { asset: { id: stored!.id, jobId: stored!.id,
      provider: "swarmui", model: stored!.profile, prompt: "fixture", createdAt: stored!.createdAt,
      status: "completed", reviewStatus: "pending" } } };
    const body = { projectId: "project-1", jobId: stored.id, action: "recheck_identity", requestIntentId: fixture.request.requestIntentId };
    const response = await PATCH(new Request("http://app.test/api/generate/h3", { method: "PATCH", body: JSON.stringify(body) }));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("choose a source handle");
    expect(stored.runId).toBe("run-1"); expect(dispatches).toBe(1);
    fixture.saved.draft.generatedAssets = [{ ...stored.result!.asset, reviewStatus: "rejected" }];
    expect((await PATCH(new Request("http://app.test/api/generate/h3", { method: "PATCH", body: JSON.stringify(body) }))).status).toBe(409);
    expect(dispatches).toBe(1);
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

  test("new intents use v3 and a changed legacy prompt or reference cannot claim the old intent", async () => {
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

  test("recovers a saved v2 intent without changing its conditioning version or dispatching twice", async () => {
    reset();
    stored = materializeH3Job("github-test", fixture.saved, parseH3Request(fixture.request), "studio", {
      profile: H3_V2_PROFILE, conditioningPreparationVersion: H3_V2_CONDITIONING_PREPARATION_VERSION,
    });
    const originalId = stored.id;
    const response = await POST(post(fixture.request));
    expect(response.status).toBe(202);
    const body = await response.json() as { job: H3GenerationJob };
    expect(body.job.id).toBe(originalId);
    expect(body.job.profile).toBe("h3-ref2va-int8-v2");
    expect(body.job.conditioningPreparationVersion).toBe("canonical-front-crop-v1");
    expect(body.job.runId).toBe("run-1");
    expect((await POST(post(fixture.request))).status).toBe(202);
    expect(dispatches).toBe(1);
    const snapshot = JSON.stringify(stored);
    expect((await POST(post({ ...fixture.request, prompt: "Diego looks toward the passage." }))).status).toBe(409);
    expect((await POST(post({ ...fixture.request, referenceAssetIds: ["club", "diego"] }))).status).toBe(409);
    expect(JSON.stringify(stored)).toBe(snapshot);
    expect(dispatches).toBe(1);
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

  test("resumes a terminated pre-submission worker with the same first frame and creative intent", async () => {
    reset();
    const shot={...fixture.request,attempt:0,identityPolicyFamily:"sface-yunet-foreground-frontal-v2" as const};
    firstFrameArtifact=firstFrameArtifactFixture(materializeH3Job("github-test",fixture.saved,shot,"studio"));
    await POST(post({...shot,conditioning:{kind:"first-frame",artifactId:firstFrameArtifact.id,expectedSha256:firstFrameArtifact.body.pngSha256}}));
    const originalId=stored!.id,originalRequest=JSON.stringify(stored!.request),originalArtifact=JSON.stringify(stored!.firstFrame);
    await GET(new Request(`http://app.test/api/generate/h3?projectId=project-1&jobId=${originalId}`));
    expect(stored!.state).toBe("failed");expect(stored!.compiledPrompt).toBe(undefined);
    const resume={projectId:"project-1",jobId:originalId,action:"resume",requestIntentId:"44556677-1234-4123-8123-123456789abc"};
    expect((await PATCH(post(resume))).status).toBe(202);
    expect(stored!.id).toBe(originalId);expect(stored!.state).toBe("queued");expect(stored!.runId).toBe("run-2");
    expect(JSON.stringify(stored!.request)).toBe(originalRequest);expect(JSON.stringify(stored!.firstFrame)).toBe(originalArtifact);
    expect((await PATCH(post(resume))).status).toBe(202);expect(dispatches).toBe(2);
  });

  test("persists a recovery claim before known dispatch failure and resumes the same UUID after reload", async () => {
    reset(); await POST(post(fixture.request)); stored = { ...stored!, state: "failed" };
    const originalRequest = JSON.stringify(stored.request);
    dispatchFailure = "before";
    expect((await PATCH(post(resumeBody()))).status).toBe(503);
    expect(stored!.state).toBe("queued"); expect(stored!.runId).toBe(undefined);
    expect(stored!.workerRecoveries?.[0].requestIntentId).toBe(recoveryIntent);
    const reload = await GET(new Request(`http://app.test/api/generate/h3?projectId=project-1&jobId=${stored!.id}`));
    const restored = (await reload.json()).job as H3GenerationJob;
    expect(restored.workerRecoveries?.[0].requestIntentId).toBe(recoveryIntent);
    expect((await PATCH(post(resumeBody(anotherRecoveryIntent)))).status).toBe(409);
    const calls = dispatchKeys.length;
    expect((await POST(post(fixture.request))).status).toBe(202);
    expect(dispatchKeys.length).toBe(calls); // Never fall back to the initial dispatch key.
    expect((await PATCH(post(resumeBody(restored.workerRecoveries![0].requestIntentId)))).status).toBe(202);
    expect(stored!.runId).toBe("run-2"); expect(dispatches).toBe(2);
    expect(stored!.workerRecoveries?.[0].runId).toBe("run-2");
    expect(dispatchKeys[dispatchKeys.length - 1]).toBe(dispatchKeys[dispatchKeys.length - 2]);
    expect(JSON.stringify(stored!.request)).toBe(originalRequest);
  });

  test("uncertain Trigger acknowledgement replays one logical run and preserves existing provider identity", async () => {
    reset(); await POST(post(fixture.request));
    stored = { ...stored!, state: "submission_unknown", promptId: "provider-original", compiledPrompt: "immutable compiled input" };
    dispatchFailure = "after";
    expect((await PATCH(post(resumeBody()))).status).toBe(503);
    expect(stored!.workerRecoveries?.[0].runId).toBe(undefined);
    expect((await PATCH(post(resumeBody()))).status).toBe(202);
    expect(dispatches).toBe(2); expect(stored!.runId).toBe("run-2");
    expect(stored!.promptId).toBe("provider-original"); expect(stored!.compiledPrompt).toBe("immutable compiled input");
    expect(dispatchKeys[1]).toBe(dispatchKeys[2]);
  });

  test("lost storage ACK can reconcile after the new worker claims ownership or finishes", async () => {
    for (const completed of [false, true]) {
      reset(); await POST(post(fixture.request)); stored = { ...stored!, state: "failed" };
      dispatchHook = runId => {
        stored = { ...stored!, runId, state: completed ? "ready" : "preparing" };
        if (completed) stored.result = { asset: { id: stored.id, provider: "swarmui", model: stored.profile, prompt: "saved output", createdAt: stored.createdAt, status: "completed" } };
        failNextJobUpdate = true;
      };
      expect((await PATCH(post(resumeBody()))).status).toBe(503);
      expect(stored!.runId).toBe("run-2"); expect(stored!.workerRecoveries?.[0].runId).toBe(undefined);
      workerTerminal = false; // Replay does not require the new, already claimed worker to terminate.
      const result = JSON.stringify(stored!.result);
      expect((await PATCH(post(resumeBody()))).status).toBe(202);
      expect(dispatches).toBe(2); expect(stored!.workerRecoveries?.[0].runId).toBe("run-2");
      expect(stored!.state).toBe(completed ? "ready" : "preparing"); expect(JSON.stringify(stored!.result)).toBe(result);
    }
  });

  test("historical recovery UUID replay never reattaches an old run to a newer owner", async () => {
    reset(); await POST(post(fixture.request)); stored = { ...stored!, state: "failed" };
    expect((await PATCH(post(resumeBody()))).status).toBe(202);
    stored = { ...stored!, state: "failed" };
    expect((await PATCH(post(resumeBody(anotherRecoveryIntent)))).status).toBe(202);
    expect(stored!.runId).toBe("run-3");
    const snapshot = JSON.stringify(stored);
    const response = await PATCH(post(resumeBody()));
    expect(response.status).toBe(202); expect((await response.json()).runId).toBe("run-2");
    expect(JSON.stringify(stored)).toBe(snapshot); expect(dispatches).toBe(3);
  });

  test("concurrent recovery claims share one same-UUID worker and exclude a competing UUID", async () => {
    for (const competing of [false, true]) {
      reset(); await POST(post(fixture.request)); stored = { ...stored!, state: "failed" };
      const responses = await Promise.all([PATCH(post(resumeBody())), PATCH(post(resumeBody(competing ? anotherRecoveryIntent : recoveryIntent)))]);
      expect(responses.map(response => response.status).sort()).toEqual(competing ? [202,409] : [202,202]);
      expect(dispatches).toBe(2); expect(stored!.workerRecoveries).toHaveLength(1); expect(stored!.runId).toBe("run-2");
    }
  });

  test("cancellation after dispatch remains terminal when its matching worker receipt arrives", async () => {
    reset(); await POST(post(fixture.request)); stored = { ...stored!, state: "failed" };
    dispatchHook = () => { stored = { ...stored!, state: "cancelled", cancelRequestedAt: "2026-11-06T15:00:00.000Z" }; };
    expect((await PATCH(post(resumeBody()))).status).toBe(202);
    expect(stored!.state).toBe("cancelled"); expect(stored!.cancelRequestedAt).toBe("2026-11-06T15:00:00.000Z");
    expect(stored!.workerRecoveries?.[0].runId).toBe("run-2"); expect(dispatches).toBe(2);
  });

  test("pending recovery preserves cancellation and rejects a mismatched worker receipt", async () => {
    reset(); await POST(post(fixture.request)); stored = { ...stored!, state: "failed" }; dispatchFailure = "before";
    await PATCH(post(resumeBody()));
    await PATCH(post({ projectId: "project-1", jobId: stored!.id, action: "cancel" }));
    const cancelled = JSON.stringify(stored), calls = dispatchKeys.length;
    expect((await PATCH(post(resumeBody()))).status).toBe(409);
    expect(JSON.stringify(stored)).toBe(cancelled); expect(dispatchKeys.length).toBe(calls);
    reset(); await POST(post(fixture.request)); stored = { ...stored!, state: "failed" };
    dispatchHook = () => { stored = { ...stored!, runId: "different-worker" }; };
    expect((await PATCH(post(resumeBody()))).status).toBe(409);
    expect(stored!.runId).toBe("different-worker"); expect(stored!.workerRecoveries?.[0].runId).toBe(undefined);
  });

  test("a changed submission marker at the recovery claim boundary cannot be cleared", async () => {
    reset(); await POST(post(fixture.request)); stored = { ...stored!, state: "failed" };
    beforeNextJobUpdate = () => { stored = { ...stored!, promptId: "provider-arrived", state: "rendering" }; };
    expect((await PATCH(post(resumeBody()))).status).toBe(409);
    expect(stored!.promptId).toBe("provider-arrived"); expect(stored!.runId).toBe("run-1");
    expect(stored!.workerRecoveries).toBe(undefined); expect(dispatches).toBe(1);
  });

  test("an uncertain receipt cannot dispatch after the existing Trigger idempotency TTL", async () => {
    reset(); await POST(post(fixture.request)); stored = { ...stored!, state: "failed" }; dispatchFailure = "before";
    await PATCH(post(resumeBody()));
    stored!.workerRecoveries![0].createdAt = new Date(Date.now() - 31 * 86_400_000).toISOString();
    const calls = dispatchKeys.length;
    expect((await PATCH(post(resumeBody()))).status).toBe(409); expect(dispatchKeys.length).toBe(calls);
  });

  test("pre-submission recovery refuses active workers and every persisted submission or cancellation marker",async()=>{
    reset();await POST(post(fixture.request));stored={...stored!,state:"failed"};workerTerminal=false;
    const resume=()=>PATCH(post({projectId:"project-1",jobId:stored!.id,action:"resume",requestIntentId:fixture.request.requestIntentId}));
    expect((await resume()).status).toBe(409);expect(dispatches).toBe(1);
    for(const marker of ["compiledPrompt","promptId","cancelRequestedAt","missingWorker"]){
      reset();await POST(post(fixture.request));stored={...stored!,state:"failed"};
      if(marker==="compiledPrompt")stored.compiledPrompt="[Shot 1] Persisted before POST";
      if(marker==="promptId")stored.promptId="provider-existing";
      if(marker==="cancelRequestedAt")stored.cancelRequestedAt=new Date().toISOString();
      if(marker==="missingWorker")delete stored.runId;
      expect((await resume()).status).toBe(409);expect(dispatches).toBe(1);
    }
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
