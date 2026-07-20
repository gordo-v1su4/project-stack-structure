import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { AbortTaskRunError, logger, task } from "@trigger.dev/sdk";

import { generateConcatPreview, generateSectionPreview } from "@/components/studio/previewGeneration";
import { probeMediaFile } from "@/components/studio/mediaProbe";
import { downloadMediaGatewayFile, uploadFileToMediaGateway, type MediaGatewayUploadResult } from "@/lib/mediaGateway";

import { MEDIA_ASSEMBLY_MACHINE, mediaAssemblyQueue } from "./queues";
import { markWorkCompleted, markWorkRunning } from "./workMetadata";

export type FfmpegInputRef = {
  bucket: string;
  objectKey: string;
  fileName: string;
  mimeType?: string;
};

export type FfmpegPreviewPayload = {
  operation: "concat" | "preview";
  requestKey: string;
  inputFiles: FfmpegInputRef[];
  segments?: Array<{ startTime: number; endTime: number; sourceIndex?: number }>;
  startTime?: number;
  endTime?: number;
};

export type FfmpegPreviewOutput = {
  requestKey: string;
  assetKey: string;
  duration: number;
  generatedAt: string;
  videoUrl: string;
  storage: MediaGatewayUploadResult;
};

export const ffmpegPreviewTask = task({
  id: "ffmpeg-preview-or-concat",
  queue: mediaAssemblyQueue,
  machine: MEDIA_ASSEMBLY_MACHINE,
  maxDuration: 1_800,
  retry: { maxAttempts: 1 },
  run: async (payload: FfmpegPreviewPayload, { ctx }): Promise<FfmpegPreviewOutput> => {
    if (!payload.requestKey?.trim()) throw new AbortTaskRunError("FFmpeg preview requestKey is required.");
    if (!payload.inputFiles?.length) throw new AbortTaskRunError("FFmpeg preview requires at least one stored input file.");
    markWorkRunning("rendering", "Rendering preview", { progressMode: "indeterminate" });
    const workspace = await mkdtemp(path.join(os.tmpdir(), "stack-structure-preview-"));
    try {
      const inputPaths: string[] = [];
      for (const [index, input] of payload.inputFiles.entries()) {
        inputPaths.push(await materializeStoredInput(input, workspace, index));
      }
      const probeFn = async (filePath: string) => {
        const result = await probeMediaFile(filePath);
        return { duration: result.duration, hasVideo: result.hasVideo };
      };
      const outputPath = path.join(workspace, `${sanitize(payload.requestKey)}.mp4`);
      const asset = payload.operation === "concat"
        ? await generateConcatPreview({
            requestKey: payload.requestKey,
            outputPath,
            segments: resolvePreviewSegments(payload.segments ?? [], inputPaths),
            probeFn,
          })
        : await generateSectionPreview({
            requestKey: payload.requestKey,
            inputPath: inputPaths[0]!,
            outputPath,
            startTime: payload.startTime ?? 0,
            endTime: payload.endTime ?? 1,
            probeFn,
          });
      const output = await readFile(asset.outputPath);
      const storage = await uploadFileToMediaGateway({
        file: new File([output], `${sanitize(payload.requestKey)}.mp4`, { type: "video/mp4" }),
        folder: `media-uploads/generated/previews/${sanitize(payload.requestKey)}`,
      });

      logger.info("FFmpeg preview persisted", {
        triggerRunId: ctx.run.id,
        requestKey: payload.requestKey,
        objectKey: storage.objectKey,
      });
      markWorkCompleted("Preview persisted", { completedItems: 1, totalItems: 1 });
      return {
        requestKey: payload.requestKey,
        assetKey: storage.mediaUrl || storage.publicUrl,
        duration: asset.duration || requestedDuration(payload),
        generatedAt: new Date().toISOString(),
        videoUrl: storage.mediaUrl || storage.publicUrl,
        storage,
      };
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  },
});

export function resolvePreviewSegments(
  segments: NonNullable<FfmpegPreviewPayload["segments"]>,
  inputPaths: string[],
) {
  if (!inputPaths.length) throw new AbortTaskRunError("FFmpeg preview requires materialized input files.");
  return segments.map((segment, index) => {
    const sourceIndex = segment.sourceIndex ?? 0;
    if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= inputPaths.length) {
      throw new AbortTaskRunError(`FFmpeg preview segment ${index + 1} has invalid sourceIndex ${sourceIndex}.`);
    }
    return {
      startTime: segment.startTime,
      endTime: segment.endTime,
      inputPath: inputPaths[sourceIndex]!,
    };
  });
}

async function materializeStoredInput(input: FfmpegInputRef, workspace: string, index: number) {
  const source = await downloadMediaGatewayFile({
    bucket: input.bucket,
    objectKey: input.objectKey,
    fileName: input.fileName,
  });
  const extension = path.extname(input.fileName) || ".bin";
  const target = path.join(workspace, `input-${index}${extension}`);
  await writeFile(target, Buffer.from(source.bytes));
  return target;
}

function requestedDuration(payload: FfmpegPreviewPayload) {
  if (payload.operation === "preview") {
    return Math.max(0, (payload.endTime ?? 1) - (payload.startTime ?? 0));
  }
  return (payload.segments ?? []).reduce(
    (total, segment) => total + Math.max(0, segment.endTime - segment.startTime),
    0,
  );
}

function sanitize(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "preview";
}
