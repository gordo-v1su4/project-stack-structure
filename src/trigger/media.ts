import { logger, task, wait } from "@trigger.dev/sdk/v3";

import {
  createMediaGatewayVideoJob,
  getMediaGatewayVideoJob,
  getMediaGatewayVideoJobResult,
} from "@/lib/mediaGateway";

import { vm100HeavyQueue } from "./queues";

export type MediaSceneDetectionPayload = {
  bucket: string;
  objectKey: string;
  mode?: string;
  profile?: string;
  metadata?: Record<string, unknown>;
  timeoutSeconds?: number;
};

export const mediaSceneDetectionTask = task({
  id: "media-video-scene-detect",
  queue: vm100HeavyQueue,
  maxDuration: 900,
  // Creating a second upstream job on an automatic retry is not safe. Replays
  // are explicit, while trigger idempotency prevents duplicate initial runs.
  retry: { maxAttempts: 1 },
  run: async (payload: MediaSceneDetectionPayload, { ctx }) => {
    const job = await createMediaGatewayVideoJob({
      bucket: payload.bucket,
      objectKey: payload.objectKey,
      mode: payload.mode,
      profile: payload.profile,
      metadata: {
        ...payload.metadata,
        triggerRunId: ctx.run.id,
      },
    });

    logger.info("Media job created", {
      triggerRunId: ctx.run.id,
      mediaJobId: job.job_id,
      bucket: payload.bucket,
      objectKey: payload.objectKey,
    });

    const timeoutMs = Math.max(30, Math.min(payload.timeoutSeconds ?? 840, 840)) * 1_000;
    const startedAt = Date.now();
    let current = job;

    while (current.status !== "completed") {
      if (current.status === "failed") {
        throw new Error(current.error || `Media job ${current.job_id} failed during ${current.stage || "processing"}`);
      }
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(`Media job ${current.job_id} timed out after ${Math.round(timeoutMs / 1_000)}s`);
      }

      await wait.for({ seconds: 3 });
      current = await getMediaGatewayVideoJob({ jobId: current.job_id });
    }

    const result = await getMediaGatewayVideoJobResult({ jobId: current.job_id });
    logger.info("Media job completed", {
      triggerRunId: ctx.run.id,
      mediaJobId: current.job_id,
    });

    return { job: current, result };
  },
});
