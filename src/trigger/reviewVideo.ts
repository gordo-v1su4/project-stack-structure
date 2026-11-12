import { AbortTaskRunError, queue, task } from "@trigger.dev/sdk";
import { prepareStoredReviewVideo } from "@/lib/prepareStoredReviewVideo";
import { ReviewVideoPreparationError } from "@/lib/prepareReviewVideo";
import { pinReviewVideoSource, type ReviewVideoSource } from "@/lib/preparedReviewVideoStore";
import { canReadMediaObject } from "@/lib/studioMediaAccess";
import { markWorkCompleted, markWorkRunning } from "./workMetadata";

const reviewVideoQueue = queue({ name: "review-video-preparation", concurrencyLimit: 1 });
export const reviewVideoTask = task({
  id: "prepare-review-video",
  queue: reviewVideoQueue,
  machine: "large-1x",
  maxDuration: 900,
  retry: { maxAttempts: 2, minTimeoutInMs: 5000, maxTimeoutInMs: 30_000 },
  run: async (payload: { applicationUserId: string; projectId?: string } & ({ source: ReviewVideoSource; input?: never } | { source?: never; input: { bucket: string; objectKey: string } })) => {
    if (!payload.applicationUserId || payload.source && payload.applicationUserId !== payload.source.ownerId) throw new AbortTaskRunError("Invalid review-video owner.");
    try {
      let source = payload.source;
      if (!source) {
        if (!payload.input || !await canReadMediaObject({ userId: payload.applicationUserId, bucket: payload.input.bucket, objectKey: payload.input.objectKey })) throw new AbortTaskRunError("Review video does not belong to the current user.");
        source = await pinReviewVideoSource(payload.applicationUserId, payload.input.bucket, payload.input.objectKey);
      }
      const result = await prepareStoredReviewVideo(source, { ...(payload.projectId ? { authorize: args => canReadMediaObject({ ...args, projectId: payload.projectId }) } : {}),
        onStage: stage => markWorkRunning("preparing-review", stage, { progressMode: "indeterminate" }) });
      markWorkCompleted("Review proxy and scrub sheet stored", { completedItems: 1, totalItems: 1 });
      return result;
    } catch (error) {
      if (error instanceof AbortTaskRunError) throw error;
      if (error instanceof ReviewVideoPreparationError && ["source-changed", "unsupported"].includes(error.code)) throw new AbortTaskRunError(error.message);
      // No paths, source bytes or storage diagnostics in user-visible run errors.
      throw new Error("Review media preparation failed; the original video and project are unchanged.");
    }
  },
});
