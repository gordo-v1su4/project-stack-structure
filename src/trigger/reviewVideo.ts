import { AbortTaskRunError, queue, task } from "@trigger.dev/sdk";
import { prepareStoredReviewVideo } from "@/lib/prepareStoredReviewVideo";
import { ReviewVideoPreparationError } from "@/lib/prepareReviewVideo";
import type { ReviewVideoSource } from "@/lib/preparedReviewVideoStore";
import { markWorkCompleted, markWorkRunning } from "./workMetadata";

const reviewVideoQueue = queue({ name: "review-video-preparation", concurrencyLimit: 1 });
export const reviewVideoTask = task({
  id: "prepare-review-video",
  queue: reviewVideoQueue,
  machine: "large-1x",
  maxDuration: 900,
  retry: { maxAttempts: 2, minTimeoutInMs: 5000, maxTimeoutInMs: 30_000 },
  run: async (payload: { applicationUserId: string; source: ReviewVideoSource }) => {
    if (!payload.applicationUserId || payload.applicationUserId !== payload.source?.ownerId) throw new AbortTaskRunError("Invalid review-video owner.");
    try {
      const result = await prepareStoredReviewVideo(payload.source, { onStage: stage => markWorkRunning("preparing-review", stage, { progressMode: "indeterminate" }) });
      markWorkCompleted("Review proxy and scrub sheet stored", { completedItems: 1, totalItems: 1 });
      return result;
    } catch (error) {
      if (error instanceof ReviewVideoPreparationError && ["source-changed", "unsupported"].includes(error.code)) throw new AbortTaskRunError(error.message);
      // No paths, source bytes or storage diagnostics in user-visible run errors.
      throw new Error("Review media preparation failed; the original video and project are unchanged.");
    }
  },
});
