import { queue, task, tasks } from "@trigger.dev/sdk";
import type { reviewVideoTask } from "./reviewVideo";
import { runReviewBackfill } from "@/lib/runReviewBackfill";
import { createTriggerIdempotencyKey } from "@/lib/triggerIdempotency";
import { markWorkCompleted, markWorkRunning } from "./workMetadata";

const reviewBackfillQueue = queue({ name: "review-project-preparation", concurrencyLimit: 1 });
export const reviewBackfillTask = task({
  id: "prepare-project-review-videos", queue: reviewBackfillQueue, machine: "small-1x", maxDuration: 3600,
  retry: { maxAttempts: 2, minTimeoutInMs: 5000, maxTimeoutInMs: 30_000 },
  run: async (reference: { ownerId: string; projectId: string; jobId: string }, { ctx }) => {
    const job = await runReviewBackfill(reference, ctx.run.id, {
      stage: (label, finished, total, failed) => markWorkRunning("preparing-review", `Preparing review copies · ${label}`,
        { completedItems: finished, totalItems: total, failedItems: failed, progressMode: "exact" }),
      execute: (source, rowId) => tasks.triggerAndWait<typeof reviewVideoTask>("prepare-review-video", { applicationUserId: reference.ownerId, source, projectId: reference.projectId }, {
        idempotencyKey: createTriggerIdempotencyKey("review-backfill-source-v1", [reference.ownerId, reference.jobId, rowId, source.etag]),
        idempotencyKeyTTL: "30d", tags: [`user:${reference.ownerId}`, "stack-structure", "review-preparation", `project:${reference.projectId}`],
        metadata: { stage: "queued", stageLabel: "Waiting to prepare review copy", progressMode: "indeterminate", providerStatus: "queued" },
      }).then(result => ({ id: result.id, ok: result.ok })),
    });
    const ready = job.rows.filter(row => row.state === "ready").length, failed = job.rows.filter(row => row.state === "failed").length;
    markWorkCompleted(job.status === "ready" ? "Review copies stored" : "Review preparation finished with unavailable copies", { completedItems: ready + failed, totalItems: job.rows.length, readyItems: ready, failedItems: failed });
    return { jobId: job.id, projectId: job.projectId, status: job.status, ready, failed, total: job.rows.length };
  },
});
