import { describe, expect, test } from "bun:test";
import { claimH3StillReconciliation, createH3StillJob, readH3StillJob, readH3StillJobByIntent, requestH3StillCancellation, updateH3StillJob, type H3StillJob, type H3StillResult } from "@/lib/h3StillJobStore";
import { freezeH3Still } from "@/lib/h3StillProfile";
import { StudioProjectConflictError, type StudioJsonObjectStore } from "@/lib/studioProjectObjectStore";

import { h3StillJobFixture as fixture, h3StillResultFixture as result } from "../helpers/h3StillJob";
async function submitting(f: ReturnType<typeof fixture>) {
  const job = await createH3StillJob(f.input, f.objects);
  await updateH3StillJob(job.ownerId, job.projectId, job.id, "run-1", current => ({ ...current, state: "preparing" }), f.objects);
  return updateH3StillJob(job.ownerId, job.projectId, job.id, "run-1", current => ({ ...current, state: "submitting", workflowSha256: "f".repeat(64), providerSchemaSha256: "9".repeat(64) }), f.objects);
}

describe("owned frozen H3 still jobs", () => {
  test("lost creation ACK restores the same intent after project edits without materialization or writes", async () => {
    const f = fixture(), job = await createH3StillJob(f.input, f.objects), writes = f.writes();
    // Caller retained its intent but lost the response/job ID, then edited its local project context.
    f.input.shotRequest.planSignature = "edited-plan"; f.input.template.references[0].etag = "edited-reference";
    expect(await readH3StillJobByIntent(job.ownerId, job.projectId, job.requestIntentId, job.attempt, f.objects)).toEqual(job);
    expect(f.writes()).toBe(writes);
    expect(await readH3StillJobByIntent("other-owner", job.projectId, job.requestIntentId, job.attempt, f.objects)).toBe(null);
    expect(await readH3StillJobByIntent(job.ownerId, "other-project", job.requestIntentId, job.attempt, f.objects)).toBe(null);
    expect(await readH3StillJobByIntent(job.ownerId, job.projectId, job.requestIntentId, 1, f.objects)).toBe(null);
  });
  test("intent lookup rejects malformed or mismatched bindings and distinguishes a reserved incomplete claim", async () => {
    const f = fixture(), job = await createH3StillJob(f.input, f.objects);
    await expect(readH3StillJobByIntent(job.ownerId, job.projectId, "../intent", 0, f.objects)).rejects.toThrow("valid original");
    await expect(readH3StillJobByIntent(job.ownerId, job.projectId, job.requestIntentId, 3, f.objects)).rejects.toThrow("valid original");
    const claimRow = [...f.rows.values()].find(row => Object.hasOwn(row.value as object, "jobId"))!;
    (claimRow.value as { ownerId: string }).ownerId = "other";
    await expect(readH3StillJobByIntent(job.ownerId, job.projectId, job.requestIntentId, 0, f.objects)).rejects.toThrow("ownership differs");
    (claimRow.value as { ownerId: string }).ownerId = job.ownerId;
    const second = await createH3StillJob({ ...f.input, requestIntentId: "00000000-0000-4000-8000-000000000003" }, f.objects);
    (claimRow.value as { jobId: string }).jobId = second.id;
    await expect(readH3StillJobByIntent(job.ownerId, job.projectId, job.requestIntentId, 0, f.objects)).rejects.toThrow("differs from its original intent");
    (claimRow.value as { jobId: string }).jobId = job.id;
    const jobKey = [...f.rows.entries()].find(([, row]) => (row.value as H3StillJob).id === job.id)![0]; f.rows.delete(jobKey);
    await expect(readH3StillJobByIntent(job.ownerId, job.projectId, job.requestIntentId, 0, f.objects)).rejects.toThrow("reserved but its durable job is not confirmed");
  });
  test("identical replay/reload preserves one job and independent image/video intents", async () => {
    const f = fixture(), first = await createH3StillJob(f.input, f.objects);
    expect(await createH3StillJob(f.input, f.objects)).toEqual(first); expect(f.writes()).toBe(2);
    expect(await readH3StillJob(first.ownerId, first.projectId, first.id, f.objects)).toEqual(first);
    expect(await readH3StillJob("other-owner", first.projectId, first.id, f.objects)).toBe(null);
    expect(first.requestIntentId).not.toBe(first.shotRequest.requestIntentId);
    expect(first.shotRequest).toEqual(f.input.shotRequest);
    const refreshedTemplate = structuredClone(f.input); refreshedTemplate.template.createdAt = refreshedTemplate.template.updatedAt = "2026-11-09T00:00:00Z";
    expect(await createH3StillJob(refreshedTemplate, f.objects)).toEqual(first); expect(f.writes()).toBe(2);
    f.input.descriptor.body.references[0].rawSha256 = "0".repeat(64);
    expect((await readH3StillJob(first.ownerId, first.projectId, first.id, f.objects))!.descriptor.body.references[0].rawSha256).toBe("a".repeat(64));
  });
  test("claim and job lost acknowledgments reconcile without any second conditional write", async () => {
    const f = fixture();
    const uncertain: StudioJsonObjectStore = { ...f.objects, async write(key, value, revision) { await f.objects.write(key, value, revision); throw new Error("Acknowledgment lost"); } };
    const job = await createH3StillJob(f.input, uncertain);
    expect(job.state).toBe("queued"); expect(f.writes()).toBe(2); expect(f.rows.size).toBe(2);
  });
  test("racing creates converge, while one still intent cannot change descriptor or future shot", async () => {
    const f = fixture();
    const jobs = await Promise.all([createH3StillJob(f.input, f.objects), createH3StillJob(f.input, f.objects)]);
    expect(jobs[0].id).toBe(jobs[1].id); expect(f.rows.size).toBe(2);
    const changed = structuredClone(f.input); changed.descriptor = freezeH3Still({ ...changed.descriptor.body, seed: 18 });
    await expect(createH3StillJob(changed, f.objects)).rejects.toThrow("intent already");
    changed.descriptor = f.input.descriptor; changed.shotRequest.prompt = "Diego waits inside CLUB_MAIN."; changed.template.request = structuredClone(changed.shotRequest);
    await expect(createH3StillJob(changed, f.objects)).rejects.toThrow("intent already");
    expect(f.rows.size).toBe(2);
  });
  test("only terminal previous still attempt permits bounded explicit revision; video attempt never increments", async () => {
    const f = fixture(), job = await createH3StillJob(f.input, f.objects), next = { ...f.input, attempt: 1 };
    await expect(createH3StillJob(next, f.objects)).rejects.toThrow("preceding still");
    await updateH3StillJob(job.ownerId, job.projectId, job.id, "run-1", current => ({ ...current, state: "failed" }), f.objects);
    const revised = await createH3StillJob(next, f.objects);
    expect(revised.id === job.id).toBe(false); expect(revised.attempt).toBe(1); expect(revised.shotRequest.attempt).toBe(0);
    await expect(createH3StillJob({ ...f.input, attempt: 3 }, f.objects)).rejects.toThrow();
  });
  test("submission uncertainty preserves correlation and forbids moving back to new GPU eligibility", async () => {
    const f = fixture(), job = await submitting(f);
    await updateH3StillJob(job.ownerId, job.projectId, job.id, "run-1", current => ({ ...current, state: "submission_unknown" }), f.objects);
    await expect(updateH3StillJob(job.ownerId, job.projectId, job.id, "run-1", current => ({ ...current, state: "preparing" }), f.objects)).rejects.toThrow("state transition");
    const rendering = await updateH3StillJob(job.ownerId, job.projectId, job.id, "run-1", current => ({ ...current, state: "rendering", promptId: "provider-prompt" }), f.objects);
    expect(rendering.workflowSha256).toBe("f".repeat(64));
    await expect(updateH3StillJob(job.ownerId, job.projectId, job.id, "run-1", current => ({ ...current, promptId: "replacement" }), f.objects)).rejects.toThrow("cannot change");
    await expect(updateH3StillJob(job.ownerId, job.projectId, job.id, "run-1", current => ({ ...current, descriptor: freezeH3Still({ ...current.descriptor.body, seed: 42 }) }), f.objects)).rejects.toThrow("cannot change");
  });
  test("racing worker claims admit exactly one owner and reject stale mutations", async () => {
    const f = fixture(), job = await createH3StillJob(f.input, f.objects);
    const claims = await Promise.allSettled(["run-a", "run-b"].map(run => updateH3StillJob(job.ownerId, job.projectId, job.id, run, current => ({ ...current, state: "preparing" }), f.objects)));
    expect(claims.filter(value => value.status === "fulfilled")).toHaveLength(1);
    const owned = (await readH3StillJob(job.ownerId, job.projectId, job.id, f.objects))!;
    await expect(updateH3StillJob(job.ownerId, job.projectId, job.id, owned.runId === "run-a" ? "run-b" : "run-a", current => ({ ...current, state: "failed" }), f.objects)).rejects.toThrow("different worker");
    expect((await readH3StillJob(job.ownerId, job.projectId, job.id, f.objects))!.state).toBe("preparing");
  });
  test("same-run same-timestamp submit writers have exactly one nonce winner even after a lost ACK", async () => {
    const f = fixture(), job = await createH3StillJob(f.input, f.objects);
    const preparing = await updateH3StillJob(job.ownerId, job.projectId, job.id, "run-1", current => ({ ...current, state: "preparing" }), f.objects);
    const originalNow = Date.now; Date.now = () => Date.parse(preparing.updatedAt);
    try {
      let initialReads = 0, openGate: () => void = () => {};
      const gate = new Promise<void>(resolve => { openGate = resolve; });
      const racing: StudioJsonObjectStore = {
        async read<T>(key: string) {
          const snapshot = await f.objects.read<T>(key);
          if (key.endsWith(`${job.id}.json`) && ++initialReads <= 2) { if (initialReads === 2) openGate(); await gate; }
          return snapshot;
        },
        async write(key, value, revision) { await f.objects.write(key, value, revision); throw new Error("Accepted submit claim ACK lost"); },
      };
      const claims = ["00000000-0000-4000-8000-000000000011", "00000000-0000-4000-8000-000000000012"];
      const outcomes = await Promise.allSettled(claims.map(submissionClaimId => updateH3StillJob(job.ownerId, job.projectId, job.id, "run-1",
        current => ({ ...current, state: "submitting", workflowSha256: "f".repeat(64), submissionClaimId }), racing)));
      const winners = outcomes.flatMap((outcome, index) => outcome.status === "fulfilled" ? [{ nonce: claims[index], job: outcome.value }] : []);
      expect(winners).toHaveLength(1); expect(winners[0].job.updatedAt).toBe(preparing.updatedAt);
      const restored = (await readH3StillJob(job.ownerId, job.projectId, job.id, f.objects))!;
      expect(restored.submissionClaimId).toBe(winners[0].nonce); expect(restored.state).toBe("submitting");
      // Two attempts at the conditional write, one accepted; no blind repeat after the lost ACK.
      expect(f.writes()).toBe(5);
      await expect(updateH3StillJob(job.ownerId, job.projectId, job.id, "run-1", current => ({ ...current, submissionClaimId: undefined }), f.objects)).rejects.toThrow("cannot change");
      const recovered = await claimH3StillReconciliation(job.ownerId, job.projectId, job.id, "run-1", "run-recovery", f.objects);
      expect(recovered.submissionClaimId).toBe(winners[0].nonce);
    } finally { Date.now = originalNow; }
  });
  test("submission execution claim must be a UUID bound to a worker and frozen workflow", async () => {
    const f = fixture(), job = await createH3StillJob(f.input, f.objects);
    await expect(updateH3StillJob(job.ownerId, job.projectId, job.id, "run-1", current => ({ ...current, state: "preparing", submissionClaimId: "invalid", workflowSha256: "f".repeat(64) }), f.objects)).rejects.toThrow("malformed");
    await expect(updateH3StillJob(job.ownerId, job.projectId, job.id, "run-1", current => ({ ...current, state: "preparing", submissionClaimId: "00000000-0000-4000-8000-000000000011" }), f.objects)).rejects.toThrow("malformed");
    expect((await readH3StillJob(job.ownerId, job.projectId, job.id, f.objects))!.state).toBe("queued");
  });
  test("update lost ACK reconciles once and cancellation prevents stale submission", async () => {
    const f = fixture(), job = await createH3StillJob(f.input, f.objects);
    const uncertain: StudioJsonObjectStore = { ...f.objects, async write(key, value, revision) { await f.objects.write(key, value, revision); throw new Error("Acknowledgment lost"); } };
    await updateH3StillJob(job.ownerId, job.projectId, job.id, "run-1", current => ({ ...current, state: "preparing" }), uncertain);
    expect(f.writes()).toBe(3);
    const cancelled = await requestH3StillCancellation(job.ownerId, job.projectId, job.id, f.objects);
    expect(cancelled.runId).toBe("run-1"); expect(cancelled.state).toBe("cancel_requested");
    await expect(updateH3StillJob(job.ownerId, job.projectId, job.id, "run-1", current => ({ ...current, state: "submitting", workflowSha256: "f".repeat(64) }), f.objects)).rejects.toThrow("state transition");
    expect((await readH3StillJob(job.ownerId, job.projectId, job.id, f.objects))!.state).toBe("cancel_requested");
  });
  test("ready binds both immutable owned image objects and first-frame artifact; no approval is invented", async () => {
    const f = fixture(), job = await submitting(f);
    await updateH3StillJob(job.ownerId, job.projectId, job.id, "run-1", current => ({ ...current, state: "rendering", promptId: "provider-prompt" }), f.objects);
    await updateH3StillJob(job.ownerId, job.projectId, job.id, "run-1", current => ({ ...current, state: "persisting" }), f.objects);
    const ready = await updateH3StillJob(job.ownerId, job.projectId, job.id, "run-1", current => ({ ...current, state: "ready", result: result(job) }), f.objects);
    expect(ready.result!.native.width).toBe(1344); expect(Object.hasOwn(ready.result!, "approved")).toBe(false);
    await expect(updateH3StillJob(job.ownerId, job.projectId, job.id, "run-1", current => ({ ...current, result: { ...current.result!, artifactSha256: "0".repeat(64) } }), f.objects)).rejects.toThrow("cannot change");
  });
  test("a cancellation winning CAS cannot be overwritten by the stale submit transition", async () => {
    const f = fixture(), job = await createH3StillJob(f.input, f.objects);
    await updateH3StillJob(job.ownerId, job.projectId, job.id, "run-1", current => ({ ...current, state: "preparing" }), f.objects);
    let raced = false;
    const competing: StudioJsonObjectStore = { ...f.objects, async write(key, value, revision) {
      if (!raced) { raced = true; await requestH3StillCancellation(job.ownerId, job.projectId, job.id, f.objects); }
      return f.objects.write(key, value, revision);
    } };
    await expect(updateH3StillJob(job.ownerId, job.projectId, job.id, "run-1", current => ({ ...current, state: "submitting", workflowSha256: "f".repeat(64) }), competing)).rejects.toThrow("state transition");
    const restored = (await readH3StillJob(job.ownerId, job.projectId, job.id, f.objects))!;
    expect(restored.state).toBe("cancel_requested"); expect(restored.workflowSha256).toBe(undefined);
  });
  test("CAS contention is bounded and a generic uncertain failure never causes blind retry", async () => {
    const f = fixture(), job = await createH3StillJob(f.input, f.objects); let calls = 0;
    const contended: StudioJsonObjectStore = { ...f.objects, async write() { calls++; throw new StudioProjectConflictError(); } };
    await expect(updateH3StillJob(job.ownerId, job.projectId, job.id, "run-1", current => ({ ...current, state: "preparing" }), contended)).rejects.toThrow("changed concurrently");
    expect(calls).toBe(5); calls = 0;
    const uncertain: StudioJsonObjectStore = { ...f.objects, async write() { calls++; throw new Error("Unknown storage acknowledgment"); } };
    await expect(updateH3StillJob(job.ownerId, job.projectId, job.id, "run-1", current => ({ ...current, state: "preparing" }), uncertain)).rejects.toThrow("Unknown storage acknowledgment");
    expect(calls).toBe(1); expect((await readH3StillJob(job.ownerId, job.projectId, job.id, f.objects))!.state).toBe("queued");
  });
  test("malformed ready image paths/dimensions/hashes and premature ready cannot be persisted", async () => {
    const f = fixture(), job = await submitting(f);
    await expect(updateH3StillJob(job.ownerId, job.projectId, job.id, "run-1", current => ({ ...current, state: "ready", result: result(job) }), f.objects)).rejects.toThrow("state transition");
    await updateH3StillJob(job.ownerId, job.projectId, job.id, "run-1", current => ({ ...current, state: "rendering", promptId: "provider-prompt" }), f.objects);
    await updateH3StillJob(job.ownerId, job.projectId, job.id, "run-1", current => ({ ...current, state: "persisting" }), f.objects);
    const mutations: Array<(value: H3StillResult) => void> = [value => { value.native.objectKey = "media-uploads/projects/other/native.png"; }, value => { value.master.width = 512; }, value => { value.native.sha256 = "invalid"; }, value => { value.artifactId = `h3-frame-${"0".repeat(64)}`; }];
    for (const change of mutations) {
      const malformed = result(job); change(malformed);
      await expect(updateH3StillJob(job.ownerId, job.projectId, job.id, "run-1", current => ({ ...current, state: "ready", result: malformed }), f.objects)).rejects.toThrow();
    }
    expect((await readH3StillJob(job.ownerId, job.projectId, job.id, f.objects))!.state).toBe("persisting");
  });
  test("unowned, mismatched descriptor/ref order, conditioned future shot and malformed stored bodies fail closed", async () => {
    const f = fixture(), wrong = structuredClone(f.input); wrong.shotRequest.referenceAssetIds.reverse();
    await expect(createH3StillJob(wrong, f.objects)).rejects.toThrow("frozen shot");
    await expect(createH3StillJob({ ...f.input, ownerId: "../escape" }, f.objects)).rejects.toThrow("owned H3 still scope");
    const conditioned = structuredClone(f.input); conditioned.shotRequest.conditioning = { kind: "first-frame", artifactId: `h3-frame-${"a".repeat(64)}`, expectedSha256: "b".repeat(64) };
    await expect(createH3StillJob(conditioned, f.objects)).rejects.toThrow(); expect(f.writes()).toBe(0);
    const job = await createH3StillJob(f.input, f.objects), record = [...f.rows.values()].find(row => (row.value as H3StillJob).id === job.id)!;
    (record.value as H3StillJob).descriptor.body.references[0].etag = "changed";
    await expect(readH3StillJob(job.ownerId, job.projectId, job.id, f.objects)).rejects.toThrow();
  });
  test("explicit recovery transfers only existing provider observation and replay never appends twice", async () => {
    const f = fixture(), job = await submitting(f), snapshot = structuredClone(job);
    const recovered = await claimH3StillReconciliation(job.ownerId, job.projectId, job.id, "run-1", "run-2", f.objects), writes = f.writes();
    expect(recovered.runId).toBe("run-2"); expect(recovered.state).toBe("submitting"); expect(recovered.workflowSha256).toBe(snapshot.workflowSha256);
    expect(recovered.descriptor).toEqual(snapshot.descriptor); expect(recovered.shotRequest).toEqual(snapshot.shotRequest); expect(recovered.template).toEqual(snapshot.template);
    expect(recovered.workerRecoveries).toHaveLength(1);
    expect(await claimH3StillReconciliation(job.ownerId, job.projectId, job.id, "run-1", "run-2", f.objects)).toEqual(recovered); expect(f.writes()).toBe(writes);
    await expect(updateH3StillJob(job.ownerId, job.projectId, job.id, "run-1", current => ({ ...current, state: "failed" }), f.objects)).rejects.toThrow("different worker");
    await expect(updateH3StillJob(job.ownerId, job.projectId, job.id, "run-2", current => ({ ...current, state: "preparing" }), f.objects)).rejects.toThrow("state transition");
    await expect(updateH3StillJob(job.ownerId, job.projectId, job.id, "run-2", current => ({ ...current, workerRecoveries: undefined }), f.objects)).rejects.toThrow("cannot change");
  });
  test("recovery race has one winner; history is bounded and pre-provider/terminal jobs cannot transfer", async () => {
    const f = fixture(), job = await submitting(f);
    const attempts = await Promise.allSettled(["run-a", "run-b"].map(run => claimH3StillReconciliation(job.ownerId, job.projectId, job.id, "run-1", run, f.objects)));
    expect(attempts.filter(attempt => attempt.status === "fulfilled")).toHaveLength(1);
    let current = (await readH3StillJob(job.ownerId, job.projectId, job.id, f.objects))!;
    for (let index = 1; index < 8; index++) current = await claimH3StillReconciliation(job.ownerId, job.projectId, job.id, current.runId!, `run-recovery-${index}`, f.objects);
    expect(current.workerRecoveries).toHaveLength(8);
    await expect(claimH3StillReconciliation(job.ownerId, job.projectId, job.id, current.runId!, "run-too-many", f.objects)).rejects.toThrow("provider boundary");
    const g = fixture(), queued = await createH3StillJob(g.input, g.objects);
    await expect(claimH3StillReconciliation(queued.ownerId, queued.projectId, queued.id, "run-1", "run-2", g.objects)).rejects.toThrow("provider boundary");
    await updateH3StillJob(queued.ownerId, queued.projectId, queued.id, "run-1", value => ({ ...value, state: "preparing" }), g.objects);
    await expect(claimH3StillReconciliation(queued.ownerId, queued.projectId, queued.id, "run-1", "run-2", g.objects)).rejects.toThrow("provider boundary");
    await updateH3StillJob(queued.ownerId, queued.projectId, queued.id, "run-1", value => ({ ...value, state: "failed" }), g.objects);
    await expect(claimH3StillReconciliation(queued.ownerId, queued.projectId, queued.id, "run-1", "run-2", g.objects)).rejects.toThrow("provider boundary");
  });
});
