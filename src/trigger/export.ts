import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { AbortTaskRunError, logger, task } from "@trigger.dev/sdk";

import {
  generateMusicVideoExport,
  generateShaderCaptureMp4Export,
} from "@/components/studio/exportGeneration";
import { probeMediaFile } from "@/components/studio/mediaProbe";
import { downloadMediaGatewayFile, uploadFileToMediaGateway, type MediaGatewayUploadResult } from "@/lib/mediaGateway";

import { MEDIA_ASSEMBLY_MACHINE, mediaAssemblyQueue } from "./queues";
import { markWorkCompleted, markWorkRunning } from "./workMetadata";

export type StoredExportInput = {
  bucket: string;
  objectKey: string;
  fileName: string;
  mimeType?: string;
};

export type FinalExportPayload = {
  requestKey: string;
  audio: StoredExportInput;
  videos: StoredExportInput[];
  segments: Array<{
    sourceIndex?: number;
    startTime: number;
    endTime: number;
    musicStart?: number;
    musicEnd?: number;
    label?: string;
  }>;
  effectCues?: unknown[];
  beats?: number[];
  lyricChunks?: Array<{ id?: string; index?: number; start: number; end: number; text?: string }>;
  shaderPresetId?: string;
};

export type ShaderCaptureExportPayload = {
  requestKey: string;
  audio: StoredExportInput;
  shaderCapture: StoredExportInput;
};

type DurableExportAsset = {
  requestKey: string;
  assetKey: string;
  duration: number;
  generatedAt: string;
  videoUrl: string;
  downloadFileName: string;
  hasAudio: boolean;
  hasVideo: boolean;
  effectCues?: unknown[];
  effectFilter?: string | null;
  shaderPresetId?: string;
  shaderRenderSource?: string;
  storage: MediaGatewayUploadResult;
};

export const finalExportTask = task({
  id: "ffmpeg-final-music-video-export",
  queue: mediaAssemblyQueue,
  machine: MEDIA_ASSEMBLY_MACHINE,
  maxDuration: 1_800,
  retry: { maxAttempts: 1 },
  run: async (payload: FinalExportPayload, { ctx }): Promise<DurableExportAsset> => {
    validateExportPayload(payload);
    markWorkRunning("rendering", "Rendering final music video", { progressMode: "indeterminate" });
    const workspace = await mkdtemp(path.join(os.tmpdir(), "stack-structure-export-"));
    try {
      const audioPath = await materializeStoredInput(payload.audio, workspace, "audio");
      const videoPaths: string[] = [];
      for (const [index, input] of payload.videos.entries()) {
        videoPaths.push(await materializeStoredInput(input, workspace, `video-${index}`));
      }
      const probeFn = async (filePath: string) => {
        const result = await probeMediaFile(filePath);
        return { duration: result.duration, hasVideo: result.hasVideo, hasAudio: result.hasAudio };
      };
      const asset = await generateMusicVideoExport({
        requestKey: payload.requestKey,
        audioPath,
        segments: resolveExportSegments(payload.segments, videoPaths),
        effectCues: payload.effectCues as import("@/components/studio/shaderEffectPlan").ShaderEffectCue[] | undefined,
        beats: payload.beats,
        lyricChunks: payload.lyricChunks,
        shaderPresetId: payload.shaderPresetId,
        probeFn,
      });
      const durable = await persistExport(asset.outputPath, payload.requestKey, asset.downloadFileName, {
        duration: asset.duration,
        hasAudio: asset.hasAudio,
        hasVideo: asset.hasVideo,
        effectCues: asset.effectCues,
        effectFilter: asset.effectFilter,
        shaderPresetId: payload.shaderPresetId,
      });
      logger.info("Final export persisted", { triggerRunId: ctx.run.id, requestKey: payload.requestKey, objectKey: durable.storage.objectKey });
      markWorkCompleted("Final music video persisted", { completedItems: 1, totalItems: 1 });
      return durable;
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  },
});

export const shaderCaptureExportTask = task({
  id: "ffmpeg-shader-capture-export",
  queue: mediaAssemblyQueue,
  machine: MEDIA_ASSEMBLY_MACHINE,
  maxDuration: 1_200,
  retry: { maxAttempts: 1 },
  run: async (payload: ShaderCaptureExportPayload, { ctx }): Promise<DurableExportAsset> => {
    if (!payload.requestKey?.trim()) throw new AbortTaskRunError("Shader export requestKey is required.");
    markWorkRunning("rendering", "Muxing WebGPU shader capture", { progressMode: "indeterminate" });
    const workspace = await mkdtemp(path.join(os.tmpdir(), "stack-structure-shader-export-"));
    try {
      const audioPath = await materializeStoredInput(payload.audio, workspace, "audio");
      const capturePath = await materializeStoredInput(payload.shaderCapture, workspace, "capture");
      const result = await generateShaderCaptureMp4Export({
        requestKey: payload.requestKey,
        audioPath,
        shaderCapturePath: capturePath,
        probeFn: async (filePath) => {
          const probed = await probeMediaFile(filePath);
          return { duration: probed.duration, hasVideo: probed.hasVideo, hasAudio: probed.hasAudio };
        },
      });
      const durable = await persistExport(result.outputPath, payload.requestKey, result.downloadFileName, {
        duration: result.duration,
        hasAudio: result.hasAudio,
        hasVideo: result.hasVideo,
        shaderRenderSource: "browser-webgpu-capture",
      });
      logger.info("Shader capture export persisted", { triggerRunId: ctx.run.id, requestKey: payload.requestKey, objectKey: durable.storage.objectKey });
      markWorkCompleted("Shader capture export persisted", { completedItems: 1, totalItems: 1 });
      return durable;
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  },
});

async function materializeStoredInput(input: StoredExportInput, workspace: string, stem: string) {
  const source = await downloadMediaGatewayFile({ bucket: input.bucket, objectKey: input.objectKey, fileName: input.fileName });
  const extension = path.extname(input.fileName) || ".bin";
  const target = path.join(workspace, `${stem}${extension}`);
  await writeFile(target, Buffer.from(source.bytes));
  return target;
}

async function persistExport(
  outputPath: string,
  requestKey: string,
  fileName: string,
  metadata: Pick<DurableExportAsset, "duration" | "hasAudio" | "hasVideo" | "effectCues" | "effectFilter" | "shaderPresetId" | "shaderRenderSource">,
): Promise<DurableExportAsset> {
  const output = await readFile(outputPath);
  const storage = await uploadFileToMediaGateway({
    file: new File([output], fileName, { type: "video/mp4" }),
    folder: `media-uploads/generated/exports/${sanitize(requestKey)}`,
  });
  const videoUrl = storage.mediaUrl || storage.publicUrl;
  return {
    requestKey,
    assetKey: videoUrl,
    duration: metadata.duration,
    generatedAt: new Date().toISOString(),
    videoUrl,
    downloadFileName: fileName,
    hasAudio: metadata.hasAudio,
    hasVideo: metadata.hasVideo,
    effectCues: metadata.effectCues,
    effectFilter: metadata.effectFilter,
    shaderPresetId: metadata.shaderPresetId,
    shaderRenderSource: metadata.shaderRenderSource,
    storage,
  };
}

function validateExportPayload(payload: FinalExportPayload) {
  if (!payload.requestKey?.trim()) throw new AbortTaskRunError("Final export requestKey is required.");
  if (!payload.audio || !payload.videos?.length || !payload.segments?.length) {
    throw new AbortTaskRunError("Final export requires audio, videos, and segments.");
  }
}

export function resolveExportSegments(payloadSegments: FinalExportPayload["segments"], videoPaths: string[]) {
  if (!videoPaths.length) throw new AbortTaskRunError("Final export requires materialized video files.");
  return payloadSegments.map((segment, index) => {
    const sourceIndex = segment.sourceIndex ?? 0;
    if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= videoPaths.length) {
      throw new AbortTaskRunError(`Final export segment ${index + 1} has invalid sourceIndex ${sourceIndex}.`);
    }
    return { ...segment, inputPath: videoPaths[sourceIndex]! };
  });
}

function sanitize(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "export";
}
