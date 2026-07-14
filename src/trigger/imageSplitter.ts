import { AbortTaskRunError, logger, task } from "@trigger.dev/sdk";

import {
  splitImageWithGateway,
  uploadImageSplitPanelsToMediaGateway,
  type ImageSplitPersistedResponse,
  type ImageSplitRequestOptions,
} from "@/lib/imageSplitterGateway";
import { downloadMediaGatewayFile } from "@/lib/mediaGateway";

import { externalProviderQueue } from "./queues";
import { markWorkCompleted, markWorkRunning } from "./workMetadata";

export type ImageSplitterPayload = {
  bucket: string;
  objectKey: string;
  fileName: string;
  mimeType?: string;
  options: ImageSplitRequestOptions;
};

export const imageSplitterTask = task({
  id: "image-split-grid",
  queue: externalProviderQueue,
  maxDuration: 600,
  retry: { maxAttempts: 1 },
  run: async (payload: ImageSplitterPayload, { ctx }): Promise<ImageSplitPersistedResponse> => {
    if (!payload.bucket?.trim() || !payload.objectKey?.trim()) {
      throw new AbortTaskRunError("Image splitter requires a durable source object.");
    }
    markWorkRunning("splitting", "Splitting image grid", {
      progressMode: "exact",
      completedItems: 0,
      totalItems: Math.max(1, payload.options.rows ?? 1) * Math.max(1, payload.options.cols ?? 1),
    });

    const source = await downloadMediaGatewayFile({
      bucket: payload.bucket,
      objectKey: payload.objectKey,
      fileName: payload.fileName,
    });
    const file = new File([source.bytes], payload.fileName, {
      type: payload.mimeType || source.mime || "image/png",
    });
    const split = await splitImageWithGateway({ file, options: payload.options });
    const persisted = await uploadImageSplitPanelsToMediaGateway({ split });

    logger.info("Image split completed", {
      triggerRunId: ctx.run.id,
      sourceObjectKey: payload.objectKey,
      splitId: persisted.manifest.splitId,
      panelCount: persisted.manifest.panels.length,
    });
    markWorkCompleted("Split panels persisted", {
      completedItems: persisted.manifest.panels.length,
      totalItems: persisted.manifest.panels.length,
    });
    return persisted;
  },
});
