import { AbortTaskRunError, logger, task } from "@trigger.dev/sdk";

import {
  createNanoBananaProGrid,
  type HiggsfieldGeneratedAsset,
  type HiggsfieldInputImage,
  type HiggsfieldResolution,
} from "@/lib/higgsfieldGateway";

import { paidGenerationQueue } from "./queues";
import { markWorkCompleted, markWorkRunning } from "./workMetadata";

export type HiggsfieldGenerationPayload = {
  prompt: string;
  inputImages: HiggsfieldInputImage[];
  characterName?: string;
  title?: string;
  aspectRatio?: string;
  resolution?: HiggsfieldResolution;
  splitRows: number;
  splitCols: number;
};

export const higgsfieldGenerationTask = task({
  id: "higgsfield-nano-banana-pro-grid",
  queue: paidGenerationQueue,
  maxDuration: 900,
  // A paid provider request must never be duplicated by an automatic retry.
  retry: { maxAttempts: 1 },
  run: async (payload: HiggsfieldGenerationPayload, { ctx }): Promise<HiggsfieldGeneratedAsset> => {
    if (!payload.prompt?.trim()) throw new AbortTaskRunError("Higgsfield prompt is required.");
    if (!payload.inputImages?.length) throw new AbortTaskRunError("Higgsfield requires at least one input image.");
    markWorkRunning("generating", "Generating provider grid", { progressMode: "provider" });

    const asset = await createNanoBananaProGrid({
      ...payload,
      prompt: payload.prompt.trim(),
    });
    logger.info("Higgsfield generation completed", {
      triggerRunId: ctx.run.id,
      providerJobId: asset.jobId,
      splitPanels: asset.split?.panels.length ?? 0,
    });
    markWorkCompleted("Generated grid persisted", {
      completedItems: asset.split?.panels.length ?? 1,
      totalItems: asset.split?.panels.length ?? 1,
    });
    return asset;
  },
});
