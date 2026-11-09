import { expect, test } from "bun:test";
import { h3ProjectFixture } from "../helpers/h3Project";
import { acknowledgeStillClientRecord, buildStillContinuation, buildStillVideoRequest, assertStillClientJob, canCreateStill, parseStillClientRecord, restoreStillShotForm, sameStillFutureCreative, stillCanonicalContext, stillClientRequest, stillClientStorageKey, type StillClientRecord } from "@/components/studio/h3StillClient";
import type { H3GenerationJob } from "@/components/studio/h3Generation";
import type { H3StillJob } from "@/lib/h3StillJobStore";

function fixture() {
  const { request } = h3ProjectFixture(); request.identityPolicyFamily = "sface-yunet-foreground-frontal-v2";
  const record: StillClientRecord = { version: 1, projectId: request.projectId, context: "c".repeat(64), request: {
    shot: request, creativePrompt: "[Static] Medium shot. Diego stands in CLUB_MAIN.", seed: 123,
    requestIntentId: "a0c4aba6-2c57-4cc8-a510-2cb7f9bf5fae", attempt: 1 } };
  const job = { id: `h3-still-${"a".repeat(64)}`, projectId: request.projectId,
    requestIntentId: record.request.requestIntentId, attempt: 1, state: "ready", shotRequest: structuredClone(request),
    descriptor: { body: { seed: 123, planSignature: request.planSignature, target: { songStart: request.songStart, songEnd: request.songEnd } } },
    result: { artifactId: `h3-frame-${"b".repeat(64)}`, native: { sha256: "d".repeat(64) } } } as unknown as H3StillJob;
  return { record, job };
}
test("saved still record replays frozen video intent and keeps image counter separate", () => {
  const { record, job } = fixture();
  const saved = JSON.parse(JSON.stringify(record));
  const restored = parseStillClientRecord(saved, record.projectId)!;
  expect(restored).toEqual(record); expect(stillClientStorageKey(record.projectId)).toContain(record.projectId);
  const continuation = buildStillContinuation(restored, job, record.context);
  expect(continuation.shot).toEqual(record.request.shot);
  expect(continuation.shot.attempt).toBe(0); expect(restored.request.attempt).toBe(1);
  expect(continuation.conditioning).toEqual({ kind: "first-frame", artifactId: job.result!.artifactId, expectedSha256: "d".repeat(64) });
  continuation.shot.prompt = "changed"; expect(record.request.shot.prompt).not.toBe("changed");
  expect(parseStillClientRecord(record, "another-project")).toBe(null);
});
test("changed context, mismatched job/future request, incomplete results and stale counter cannot be used", () => {
  const { record, job } = fixture();
  expect(() => buildStillContinuation(record, job, "e".repeat(64))).toThrow("current ready still");
  for (const mutate of [(value: H3StillJob) => { value.id = `h3-still-${"f".repeat(64)}`; },
    (value: H3StillJob) => { value.shotRequest.prompt = "Different frozen motion"; },
    (value: H3StillJob) => { value.attempt = 2; }]) {
    const changed = structuredClone(job); mutate(changed);
    expect(() => assertStillClientJob(changed, { ...record, jobId: job.id })).toThrow("another frozen request");
  }
  expect(() => buildStillContinuation(record, { ...job, state: "rendering" }, record.context)).toThrow();
  expect(parseStillClientRecord({ ...record, request: { ...record.request, attempt: 3 } }, record.projectId)).toBe(null);
});
test("ACK loss preserves one POST; reload recovers by GET intent without resubmitting", async () => {
  const { record, job } = fixture(); const calls: { method: string; url: string }[] = [];
  const fetcher: typeof fetch = (async (input, init) => {
    calls.push({ method: init!.method!, url: String(input) });
    if (init!.method === "POST") throw new Error("Lost acknowledgement");
    return Response.json({ job });
  }) as typeof fetch;
  await expect(stillClientRequest("POST", record, fetcher)).rejects.toThrow("Lost acknowledgement");
  const recovered = await stillClientRequest("GET", record, fetcher);
  expect(recovered.id).toBe(job.id);
  expect(calls.map(call => call.method)).toEqual(["POST", "GET"]);
  expect(calls[1].url).toContain(`requestIntentId=${record.request.requestIntentId}`);
  expect(calls[1].url).toContain("attempt=1");
});
test("an uncertain new attempt cannot reuse the prior ready preview to enable another submission", () => {
  const { record, job } = fixture();
  expect(canCreateStill(record, job)).toBe(true);
  const next = { ...record, request: { ...record.request, attempt: 2 } };
  expect(canCreateStill(next, job)).toBe(false);
  expect(canCreateStill(next, null)).toBe(false);
  expect(canCreateStill(next, { ...job, attempt: 2, state: "submission_unknown" })).toBe(false);
  expect(canCreateStill(next, { ...job, attempt: 2, state: "ready" })).toBe(true);
});
test("reload recovery ignores preview URLs and explicit Use restores the exact frozen motion and duration", () => {
  const f = h3ProjectFixture(), { record, job } = fixture();
  const contextInput = { projectId: record.projectId, windowKey: "current-missing-window", references: f.saved.draft.referenceAssets!,
    plan: f.saved.draft.musicVideoProject!.placementPlan, currentIdentity: null, storyApproved: true };
  const before = stillCanonicalContext(contextInput);
  const reloaded = structuredClone(contextInput);
  reloaded.references[0].previewUrl = "blob:new-browser-preview"; reloaded.references[0].storageUrl = "https://media.example/new-signed-url";
  expect(stillCanonicalContext(reloaded)).toBe(before);
  record.context = before;
  const ready = buildStillContinuation(parseStillClientRecord(JSON.parse(JSON.stringify(record)), record.projectId)!, job, stillCanonicalContext(reloaded));
  const defaultForm = { direction: "Default story prose after reload", duration: "3" };
  const restored = { ...defaultForm, ...restoreStillShotForm(ready.shot) };
  expect(restored.direction).toBe(record.request.shot.prompt);
  expect(Number(restored.duration)).toBe(record.request.shot.songEnd - record.request.shot.songStart);
  expect(ready.shot.requestIntentId).toBe(record.request.shot.requestIntentId);
  reloaded.references[0].storagePath += "-new-original";
  expect(stillCanonicalContext(reloaded)).not.toBe(before);
});
test("only an unchanged future creative request can revise the same still intent", () => {
  const { record } = fixture(), shot = record.request.shot;
  expect(sameStillFutureCreative(shot, { ...shot, requestIntentId: "a0c4aba6-2c57-4cc8-a510-2cb7f9bf5fae", draftRevision: 9 })).toBe(true);
  expect(sameStillFutureCreative(shot, { ...shot, prompt: "Diego rests beside the door." })).toBe(false);
  expect(sameStillFutureCreative(shot, { ...shot, songEnd: shot.songEnd - 1 })).toBe(false);
  expect(sameStillFutureCreative(shot, { ...shot, referenceAssetIds: [...shot.referenceAssetIds].reverse() })).toBe(false);
});
test("a deferred old acknowledgement cannot overwrite a newer intent after returning to the same project", async () => {
  const { record, job } = fixture(), rows = new Map<string, string>();
  const storage = { getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, value); } };
  const key = stillClientStorageKey(record.projectId);
  storage.setItem(key, JSON.stringify(record));
  let resolve!: (value: StillClientRecord) => void;
  const deferred = new Promise<StillClientRecord>(done => { resolve = done; }).then(ack => acknowledgeStillClientRecord(storage, ack));
  const newer = { ...record, request: { ...record.request, requestIntentId: "b0c4aba6-2c57-4cc8-a510-2cb7f9bf5fae", attempt: 0 } };
  storage.setItem(key, JSON.stringify(newer));
  resolve({ ...record, jobId: job.id });
  expect(await deferred).toBe(false);
  expect(JSON.parse(storage.getItem(key)!)).toEqual(newer);
  // Leaving the project does not discard a matching late ACK needed for reload recovery.
  expect(acknowledgeStillClientRecord(storage, { ...newer, jobId: job.id })).toBe(true);
  expect(JSON.parse(storage.getItem(key)!).jobId).toBe(job.id);
  const changedContext = { ...newer, context: "f".repeat(64), jobId: job.id };
  expect(acknowledgeStillClientRecord(storage, changedContext)).toBe(false);
});
test("a deferred old poll cannot install its ready preview beneath a new intent in the same project", async () => {
  const { record, job } = fixture(), rows = new Map<string, string>();
  const storage = { getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, value); } };
  const key = stillClientStorageKey(record.projectId);
  storage.setItem(key, JSON.stringify({ ...record, jobId: job.id }));
  let resolve!: (job: H3StillJob) => void, installed: H3StillJob | null = null;
  const poll = new Promise<H3StillJob>(done => { resolve = done; }).then(oldJob => {
    if (acknowledgeStillClientRecord(storage, { ...record, jobId: oldJob.id })) installed = oldJob;
  });
  const next = { ...record, request: { ...record.request, attempt: 2 } };
  storage.setItem(key, JSON.stringify(next));
  resolve(job); await poll;
  expect(installed).toBe(null);
  expect(JSON.parse(storage.getItem(key)!)).toEqual(next);
});
test("explicit video creation retries the same frame at most three times and gives a revised frame its own used-video intent", () => {
  const { record, job } = fixture(), before = structuredClone(record.request.shot);
  const selection = buildStillContinuation(record, job, record.context);
  const first = buildStillVideoRequest(selection, []);
  expect(first.requestIntentId).toBe(before.requestIntentId); expect(first.attempt).toBe(0);
  const history: H3GenerationJob[] = [];
  const completed = (request: typeof first, state: H3GenerationJob["state"] = "failed"): H3GenerationJob => ({
    projectId: request.projectId, request, state, createdAt: `2026-11-09T00:00:0${request.attempt ?? 0}Z`,
  }) as H3GenerationJob;
  history.push(completed(first));
  const second = buildStillVideoRequest(selection, history); expect(second.requestIntentId).toBe(first.requestIntentId); expect(second.attempt).toBe(1);
  history.push(completed(second));
  const third = buildStillVideoRequest(selection, history); expect(third.attempt).toBe(2);
  history.push(completed(third));
  expect(() => buildStillVideoRequest(selection, history)).toThrow("two revisions");
  const revised = { ...selection, conditioning: { ...selection.conditioning, artifactId: `h3-frame-${"e".repeat(64)}`, expectedSha256: "f".repeat(64) } };
  const fresh = buildStillVideoRequest(revised, history, () => "b0c4aba6-2c57-4cc8-a510-2cb7f9bf5fae");
  expect(fresh.requestIntentId).not.toBe(first.requestIntentId); expect(fresh.attempt).toBe(0);
  expect({ ...fresh, requestIntentId: first.requestIntentId, conditioning: undefined }).toEqual({ ...before, conditioning: undefined });
  expect(record.request.shot).toEqual(before);
  expect(() => buildStillVideoRequest(revised, [completed(first, "rendering")])).toThrow("active video submission");
});
