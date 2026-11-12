import { readReviewBackfill, updateReviewBackfill, type ReviewBackfillJob } from "./reviewBackfillStore";
import { studioProjectObjects, type StudioJsonObjectStore } from "./studioProjectObjectStore";
import { pinReviewVideoSource, readPreparedReviewVideo, type ReviewVideoSource } from "./preparedReviewVideoStore";
import { canReadMediaObject } from "./studioMediaAccess";

type Reference = { ownerId: string; projectId: string; jobId: string };
type Options = { objects?: StudioJsonObjectStore; pin?: typeof pinReviewVideoSource; ready?: typeof readPreparedReviewVideo; authorize?: typeof canReadMediaObject;
  execute: (source: ReviewVideoSource, rowId: string) => Promise<{ id: string; ok: boolean }>;
  stage?: (label: string, finished: number, total: number, failed: number) => void };
export async function runReviewBackfill(reference: Reference, runId: string, options: Options) {
  const { ownerId, projectId, jobId } = reference, objects = options.objects ?? studioProjectObjects;
  const change = (update: (job: ReviewBackfillJob) => ReviewBackfillJob) => updateReviewBackfill(ownerId, projectId, jobId, update, objects);
  let record = await readReviewBackfill(ownerId, projectId, jobId, objects);
  if (!record) throw new Error("Review preparation was not found.");
  if (!["queued", "dispatch_unknown", "running"].includes(record.job.status)) return record.job;
  record = await change(job => ({ ...job, parentRunId: runId, status: "running" }));
  const running = (job: ReviewBackfillJob) => {
    if (job.parentRunId !== runId || job.status !== "running") throw new Error("This review preparation is no longer executing.");
    return job;
  };
  for (const requested of record.job.rows) {
    const current = await readReviewBackfill(ownerId, projectId, jobId, objects);
    if (!current) throw new Error("Review preparation was removed.");
    running(current.job);
    if (current.job.rows.find(row => row.id === requested.id)?.state === "ready") continue;
    const finished = current.job.rows.filter(row => ["ready", "failed"].includes(row.state)).length;
    options.stage?.(requested.source.label, finished, current.job.rows.length, current.job.rows.filter(row => row.state === "failed").length);
    await change(job => ({ ...running(job), rows: job.rows.map(row => row.id === requested.id ? { ...row, state: "preparing" as const } : row) }));
    let childRunId: string | undefined;
    try {
      const source = requested.source;
      if (!await (options.authorize ?? canReadMediaObject)({ userId: ownerId, projectId, bucket: source.bucket, objectKey: source.objectKey })) throw new Error("Source is not owned.");
      const pinned = await (options.pin ?? pinReviewVideoSource)(ownerId, source.bucket, source.objectKey);
      let ready = await (options.ready ?? readPreparedReviewVideo)(pinned);
      if (!ready) {
        const child = await options.execute(pinned, requested.id); childRunId = child.id;
        if (!child.ok) throw new Error("Review preparation failed.");
        ready = await (options.ready ?? readPreparedReviewVideo)(pinned);
      }
      if (!ready || ready.source.ownerId !== ownerId || ready.source.bucket !== source.bucket || ready.source.objectKey !== source.objectKey
        || ready.source.etag !== pinned.etag || ready.source.bytes !== pinned.bytes) throw new Error("No matching durable review receipt.");
      await change(job => ({ ...running(job), rows: job.rows.map(row => row.id === requested.id
        && row.state !== "ready" ? { ...row, pinned, childRunId, state: "ready" as const, posterKey: ready!.artifacts.poster } : row) }));
    } catch {
      await change(job => ({ ...running(job), rows: job.rows.map(row => row.id === requested.id && row.state !== "ready" ? { ...row, state: "failed" as const, childRunId } : row) }));
    }
  }
  return (await change(job => ({ ...running(job), status: job.rows.every(row => row.state === "ready") ? "ready" : "partial" }))).job;
}
