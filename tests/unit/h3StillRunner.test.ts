import { describe, expect, test } from "bun:test";
import { claimH3StillReconciliation, createH3StillJob, readH3StillJob, requestH3StillCancellation, updateH3StillJob, type H3StillJobInput, type H3StillJob, type H3StillResult } from "../../src/lib/h3StillJobStore";
import { freezeH3Still } from "../../src/lib/h3StillProfile";
import { H3StillSubmissionError, rebuildH3StillProvider } from "../../src/lib/h3StillProvider";
import { runH3Still, type H3StillRunnerDependencies } from "../../src/lib/h3StillRunner";
import { StudioProjectConflictError, type StudioJsonObjectStore } from "../../src/lib/studioProjectObjectStore";

async function fixture(raceOptions: { collideSubmissionWrites?: boolean } = {}) {
  const target = { timelineItemId: "arrival", sectionId: "intro", songStart: 0, songEnd: 2 };
  const descriptor = freezeH3Still({ ownerId: "github-owner", projectId: "project", planSignature: "plan", target,
    prompt: "Diego is <Picture 1>. Diego stands in CLUB_MAIN from <Picture 2>.", seed: 17,
    references: [
      { assetId: "diego", canonicalName: "Diego", role: "identity", bucket: "studio", objectKey: "media-uploads/github-owner/diego.png", etag: "diego-etag", version: "v1", rawSha256: "a".repeat(64) },
      { assetId: "club", canonicalName: "CLUB_MAIN", role: "environment", bucket: "studio", objectKey: "media-uploads/github-owner/club.png", etag: "club-etag", version: "v1", rawSha256: "b".repeat(64) },
    ] });
  const shotRequest = { ...target, projectId: "project", planSignature: "plan", prompt: "Diego advances inside CLUB_MAIN.", referenceAssetIds: ["diego", "club"], requestIntentId: "00000000-0000-4000-8000-000000000002", attempt: 0 };
  const input: H3StillJobInput = { ownerId: "github-owner", projectId: "project", requestIntentId: "00000000-0000-4000-8000-000000000001", attempt: 0,
    descriptor, shotRequest, template: { version: 1, id: `h3-${"6".repeat(64)}`, ownerId: "github-owner", projectId: "project", profile: "h3-ref2va-int8-v3", request: structuredClone(shotRequest),
      references: descriptor.body.references.map(({ rawSha256: _hash, ...r }) => { void _hash; return r; }),
      target: { ...target, planSignature: "plan", sectionLabel: "Intro" }, state: "queued", createdAt: "2026-11-08T00:00:00Z", updatedAt: "2026-11-08T00:00:00Z" } };
  const rows = new Map<string, { value: unknown; revision: string }>(); let writes = 0;
  const submissionWrites: H3StillJob[] = []; let releaseSubmission: () => void = () => undefined;
  const submissionBarrier = new Promise<void>(resolve => { releaseSubmission = resolve; });
  const objects: StudioJsonObjectStore = {
    async read<T>(key: string) { return structuredClone(rows.get(key) ?? null) as { value: T; revision: string } | null; },
    async write<T>(key: string, value: T, revision: string | null) {
      if (raceOptions.collideSubmissionWrites && (value as H3StillJob)?.state === "submitting") {
        submissionWrites.push(structuredClone(value) as H3StillJob);
        if (submissionWrites.length === 2) releaseSubmission();
        await submissionBarrier;
      }
      if ((rows.get(key)?.revision ?? null) !== revision) throw new StudioProjectConflictError();
      const next = `"${++writes}"`; rows.set(key, { value: structuredClone(value), revision: next }); return next;
    },
  };
  const job = await createH3StillJob(input, objects), ref = { ownerId: job.ownerId, projectId: job.projectId, jobId: job.id };
  if (raceOptions.collideSubmissionWrites) {
    // Store mutation uses max(Date.now(), current.updatedAt). A future pinned
    // timestamp forces both conflicting writes to identical millisecond times
    // without changing global timers or relying on scheduler luck.
    for (const row of rows.values()) if ((row.value as H3StillJob)?.id === job.id) (row.value as H3StillJob).updatedAt = "2099-01-01T00:00:00.000Z";
  }
  let now = 1000; const count = { validate: 0, prepare: 0, submit: 0, reconcile: 0, status: 0, download: 0, persist: 0 };
  const result = (j: H3StillJob): H3StillResult => {
    const prefix = `media-uploads/projects/${j.ownerId}/still-results/${j.projectId}/${j.id}/`;
    return { master: { bucket: "studio", objectKey: `${prefix}master.png`, sha256: "c".repeat(64), byteLength: 100, width: 2048, height: 1152 },
      native: { bucket: "studio", objectKey: `${prefix}native.png`, sha256: "d".repeat(64), byteLength: 100, width: 1344, height: 768 }, artifactId: `h3-frame-${"e".repeat(64)}`, artifactSha256: "e".repeat(64) };
  };
  const d: H3StillRunnerDependencies = {
    read: (o, p, id) => readH3StillJob(o, p, id, objects),
    update: (o, p, id, run, change) => updateH3StillJob(o, p, id, run, change, objects),
    claim: (o, p, id, previous, next) => claimH3StillReconciliation(o, p, id, previous, next, objects),
    validate: async j => { count.validate++; return j.template; },
    prepare: async j => { count.prepare++; return rebuildH3StillProvider(j.descriptor, j.id); },
    submit: async (p, id, o) => { const r = { jobId: id, descriptorSha256: p.descriptor.sha256, workflowSha256: p.workflowSha256, schemaSha256: "f".repeat(64) }; await o.beforeSubmit(r); count.submit++; return { ...r, promptId: "prompt-1" }; },
    reconcile: async () => { count.reconcile++; return "prompt-1"; },
    status: async (_p, id) => { count.status++; return { status: "completed", output: { filename: "master_00001_.png", subfolder: `stack-stills/${descriptor.sha256}/${id}`, type: "output" } }; },
    download: async () => { count.download++; return { bytes: new Uint8Array(33), pngSha256: "c".repeat(64), byteCount: 33, width: 2048, height: 1152 }; },
    // Pixel correctness is tested in its own adapter. This fixture isolates durable orchestration.
    pixels: (async () => ({})) as unknown as H3StillRunnerDependencies["pixels"],
    persist: async (j, template) => { count.persist++; expect(template).toEqual(j.template); return result(j); },
    now: () => now, baseUrl: () => "http://swarm.test:7861",
  };
  const options = { wait: async (seconds: number) => { now += seconds * 1000; }, stage: () => undefined, timeoutSeconds: 30 };
  const read = () => readH3StillJob(job.ownerId, job.projectId, job.id, objects);
  const cancel = () => requestH3StillCancellation(job.ownerId, job.projectId, job.id, objects);
  const existing = async (state: "submission_unknown" | "rendering" = "rendering") => {
    const p = rebuildH3StillProvider(job.descriptor, job.id);
    await d.update(job.ownerId, job.projectId, job.id, "run-1", j => ({ ...j, state: "preparing" }));
    await d.update(job.ownerId, job.projectId, job.id, "run-1", j => ({ ...j, state: "submitting", workflowSha256: p.workflowSha256, providerSchemaSha256: "f".repeat(64) }));
    await d.update(job.ownerId, job.projectId, job.id, "run-1", j => ({ ...j, state, ...(state === "rendering" ? { promptId: "prompt-1" } : {}) }));
  };
  return { job, ref, d, count, options, read, cancel, existing, submissionWrites };
}

describe("durable H3 still runner", () => {
  test("submits once, stores native artifact ready for review, and never modifies the video intent", async () => {
    const f = await fixture(), output = await runH3Still(f.ref, "run-1", f.options, f.d), saved = (await f.read())!;
    expect(output.state).toBe("ready"); expect(f.count.submit).toBe(1); expect(f.count.validate).toBe(2); expect(f.count.persist).toBe(1);
    expect(saved.shotRequest).toEqual(f.job.shotRequest); expect(saved.result!.artifactId.startsWith("h3-frame-")).toBe(true);
    expect((await runH3Still(f.ref, "run-1", f.options, f.d)).state).toBe("ready"); expect(f.count.submit).toBe(1);
  });
  test("lost submission ACK reconciles the exact existing attempt without uploading or submitting twice", async () => {
    const f = await fixture(), submit = f.d.submit;
    f.d.submit = async (...args) => { await submit(...args); throw new H3StillSubmissionError("unknown"); };
    expect((await runH3Still(f.ref, "run-1", f.options, f.d)).state).toBe("ready");
    expect(f.count.submit).toBe(1); expect(f.count.prepare).toBe(1); expect(f.count.reconcile).toBe(1);
  });
  test("existing prompt recovery ignores later project changes and reuses the original frozen template", async () => {
    const f = await fixture(); await f.existing(); f.d.validate = async () => { throw new Error("Project changed since original submission"); };
    expect((await runH3Still(f.ref, "run-1", f.options, f.d)).state).toBe("ready");
    expect(f.count.prepare).toBe(0); expect(f.count.submit).toBe(0); expect(f.count.persist).toBe(1);
  });
  test("provider restart and empty history remain uncertain at the deadline without resubmission", async () => {
    const f = await fixture(); await f.existing("submission_unknown");
    f.d.reconcile = async () => { f.count.reconcile++; return undefined; };
    expect((await runH3Still(f.ref, "run-1", f.options, f.d)).state).toBe("submission_unknown");
    expect(f.count.reconcile > 0).toBe(true); expect(f.count.submit).toBe(0); expect(f.count.prepare).toBe(0);
  });
  test("cancellation before POST safely ends without any submission", async () => {
    const f = await fixture(); await f.cancel();
    expect((await runH3Still(f.ref, "run-1", f.options, f.d)).state).toBe("cancelled"); expect(f.count.submit).toBe(0);
    const g = await fixture(), prepare = g.d.prepare;
    g.d.prepare = async (...args) => { const p = await prepare(...args); await g.cancel(); return p; };
    expect((await runH3Still(g.ref, "run-1", g.options, g.d)).state).toBe("cancelled");
    expect((await g.read())!.promptId).toBe(undefined); expect(g.count.persist).toBe(0);
  });
  test("cancellation racing a submitted prompt observes its terminal state and discards the output", async () => {
    const f = await fixture(), submit = f.d.submit;
    f.d.submit = async (...args) => { const response = await submit(...args); await f.cancel(); return response; };
    expect((await runH3Still(f.ref, "run-1", f.options, f.d)).state).toBe("cancelled");
    expect((await f.read())!.promptId).toBe("prompt-1"); expect(f.count.persist).toBe(0); expect(f.count.download).toBe(0);
  });
  test("cancelled unknown ACK never becomes cancelled merely because history vanished", async () => {
    const f = await fixture(); await f.existing("submission_unknown"); await f.cancel();
    f.d.reconcile = async () => undefined;
    expect((await runH3Still(f.ref, "run-1", f.options, f.d)).state).toBe("cancel_requested");
    expect(f.count.prepare).toBe(0); expect(f.count.submit).toBe(0); expect(f.count.persist).toBe(0);
  });
  test("five transient observation failures preserve uncertainty and retain the original prompt", async () => {
    const f = await fixture(); await f.existing(); f.d.status = async () => { f.count.status++; throw new Error("Backend unavailable"); };
    expect((await runH3Still(f.ref, "run-1", { ...f.options, timeoutSeconds: 120 }, f.d)).state).toBe("submission_unknown");
    expect(f.count.status).toBe(5); expect((await f.read())!.promptId).toBe("prompt-1"); expect(f.count.submit).toBe(0);
  });
  test("current scope failure before submission fails safely, while another worker cannot touch the job", async () => {
    const f = await fixture(); f.d.validate = async () => { throw new Error("Stale plan"); };
    expect((await runH3Still(f.ref, "run-1", f.options, f.d)).state).toBe("failed"); expect(f.count.prepare).toBe(0); expect(f.count.submit).toBe(0);
    const g = await fixture(); await g.existing(); let rejected = false;
    try { await runH3Still(g.ref, "run-other", g.options, g.d); } catch { rejected = true; }
    expect(rejected).toBe(true); expect(g.count.submit).toBe(0); expect((await g.read())!.runId).toBe("run-1");
  });
  test("only explicit reconciliation with the exact previous run can claim an existing submission", async () => {
    const f = await fixture(); await f.existing("submission_unknown");
    f.d.validate = async () => { throw new Error("Must not revalidate a submitted scope"); };
    expect((await runH3Still({ ...f.ref, mode: "reconcile", previousRunId: "run-1" }, "run-2", f.options, f.d)).state).toBe("ready");
    const saved = (await f.read())!; expect(saved.runId).toBe("run-2"); expect(f.count.prepare).toBe(0); expect(f.count.submit).toBe(0); expect(f.count.reconcile).toBe(1);
    const g = await fixture(); await g.existing(); let failed = false;
    try { await runH3Still({ ...g.ref, mode: "reconcile", previousRunId: "wrong" }, "run-2", g.options, g.d); } catch { failed = true; }
    expect(failed).toBe(true); expect((await g.read())!.runId).toBe("run-1");
    const fresh = await fixture(); failed = false;
    try { await runH3Still({ ...fresh.ref, mode: "reconcile", previousRunId: "run-old" }, "run-2", fresh.options, fresh.d); } catch { failed = true; }
    expect(failed).toBe(true); expect(fresh.count.submit).toBe(0);
  });
  test("concurrent same-run execution can claim the submission boundary only once", async () => {
    const f = await fixture({ collideSubmissionWrites: true }); let arrivals = 0; let release: () => void = () => undefined;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    f.d.prepare = async job => { arrivals++; if (arrivals === 2) release(); await barrier; return rebuildH3StillProvider(job.descriptor, job.id); };
    const outcomes = await Promise.allSettled([runH3Still(f.ref, "run-1", f.options, f.d), runH3Still(f.ref, "run-1", f.options, f.d)]);
    expect(outcomes.some(o => o.status === "fulfilled")).toBe(true); expect(f.count.submit).toBe(1);
    expect((await f.read())!.promptId).toBe("prompt-1");
    expect(f.submissionWrites.length).toBe(2);
    expect(f.submissionWrites[0].updatedAt).toBe(f.submissionWrites[1].updatedAt);
    expect(f.submissionWrites[0].submissionClaimId).not.toBe(f.submissionWrites[1].submissionClaimId);
    expect((await f.read())!.submissionClaimId).toBe(f.submissionWrites[0].submissionClaimId);
  });
});
