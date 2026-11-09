import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { AbortTaskRunError, logger, task } from "@trigger.dev/sdk";

import {
  generateMusicVideoExport,
  generateShaderCaptureMp4Export,
} from "@/components/studio/exportGeneration";
import { probeMediaFile } from "@/components/studio/mediaProbe";
import { downloadMediaGatewayFile, getMediaGatewayConfig, normalizeMediaPath, resolveMediaGatewayUploadFolder, type uploadFileToMediaGateway, type MediaGatewayUploadResult } from "@/lib/mediaGateway";
import { mediaUploadBelongsToOwner, scopeMediaUploadFolder } from "@/lib/essentiaUpload";
import { uploadWorkerFileToStorage } from "@/lib/workerStorageUpload";
import { verifyExportMediaIntegrity } from "@/lib/exportMediaIntegrity";

import { MEDIA_ASSEMBLY_MACHINE, mediaAssemblyQueue } from "./queues";
import { markWorkCompleted, markWorkRunning } from "./workMetadata";

export type StoredExportInput = {
  bucket: string;
  objectKey: string;
  fileName: string;
  mimeType?: string;
  /** Ordered gateway-stored parts; present when the input traveled chunked. */
  chunks?: Array<{ bucket: string; objectKey: string }>;
  expectedSha256?: string;
};

export type FinalExportPayload = {
  /** Set only by authenticated server dispatch, checked against the worker run tag. */
  ownerId: string;
  projectSnapshot?: { ownerId: string; projectId: string; planSignature: string; placementRevision: number; draftRevision: number;
    currentIdentityContextSha256?:string;currentIdentityMigrationSha256?:string;
    generationScope?: { signature: string; receiptSha256: string };
    acceptedSnapshotSha256: string; h3: Array<{ jobId: string; assetId: string; mediaSha256: string; proofSha256: string; trimStart: number; trimEnd: number; identityAssessmentId?: string;currentIdentityAssessmentId?:string;currentIdentityProofSha256?:string }> };
  requestKey: string;
  audio: StoredExportInput;
  videos: StoredExportInput[];
  segments: Array<{
    useClipAudio?: boolean;
    sourceIndex?: number;
    startTime: number;
    endTime: number;
    musicStart?: number;
    musicEnd?: number;
    label?: string;
    /** Reconstructed by server reconciliation; never accepted from browser input. */
    sourceFrameWindow?: import("@/components/studio/previewGeneration").ConcatPreviewSegment["sourceFrameWindow"];
  }>;
  effectCues?: unknown[];
  accentKinds?: { beat?: string; section?: string; lyric?: string };
  beats?: number[];
  lyricChunks?: Array<{ id?: string; index?: number; start: number; end: number; text?: string }>;
  shaderPresetId?: string;
};

export type ShaderCaptureExportPayload = {
  /** Set only by authenticated server dispatch, checked against the worker run tag. */
  ownerId: string;
  requestKey: string;
  audio: StoredExportInput;
  shaderCapture: StoredExportInput;
  videos?: StoredExportInput[];
  segments?: FinalExportPayload["segments"];
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
    validateExportDispatchOwner(payload, ctx.run.tags);
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
        accentKinds: payload.accentKinds as import("@/components/studio/shaderEffectPlan").ShaderAccentKinds | undefined,
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
      }, payload.ownerId);
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
    validateExportDispatchOwner(payload, ctx.run.tags);
    if (!payload.requestKey?.trim()) throw new AbortTaskRunError("Shader export requestKey is required.");
    markWorkRunning("rendering", "Muxing WebGPU shader capture", { progressMode: "indeterminate" });
    const workspace = await mkdtemp(path.join(os.tmpdir(), "stack-structure-shader-export-"));
    try {
      const audioPath = await materializeStoredInput(payload.audio, workspace, "audio");
      const capturePath = await materializeStoredInput(payload.shaderCapture, workspace, "capture");
      const videoPaths: string[] = [];
      for (const [index, input] of (payload.videos ?? []).entries()) videoPaths.push(await materializeStoredInput(input, workspace, `clip-${index}`));
      const result = await generateShaderCaptureMp4Export({
        segments: payload.segments ? resolveExportSegments(payload.segments, videoPaths) : undefined,
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
      }, payload.ownerId);
      logger.info("Shader capture export persisted", { triggerRunId: ctx.run.id, requestKey: payload.requestKey, objectKey: durable.storage.objectKey });
      markWorkCompleted("Shader capture export persisted", { completedItems: 1, totalItems: 1 });
      return durable;
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  },
});

async function materializeStoredInput(input: StoredExportInput, workspace: string, stem: string) {
  const extension = path.extname(input.fileName) || ".bin";
  const target = path.join(workspace, `${stem}${extension}`);

  if (input.chunks?.length) {
    // Chunked inputs store ordered byte-slice parts; concatenate them into the
    // original single file before handing media to ffmpeg.
    const buffers: Buffer[] = [];
    for (const part of input.chunks) {
      const partData = await downloadMediaGatewayFile({
        bucket: part.bucket,
        objectKey: part.objectKey,
        fileName: part.objectKey.split("/").pop() || "part",
      });
      buffers.push(Buffer.from(partData.bytes));
    }
    const bytes = Buffer.concat(buffers);
    verifyExportMediaIntegrity(input, bytes);
    await writeFile(target, bytes);
    return target;
  }

  const source = await downloadMediaGatewayFile({ bucket: input.bucket, objectKey: input.objectKey, fileName: input.fileName });
  verifyExportMediaIntegrity(input, new Uint8Array(source.bytes));
  await writeFile(target, Buffer.from(source.bytes));
  return target;
}

export async function persistExport(
  outputPath: string,
  requestKey: string,
  fileName: string,
  metadata: Pick<DurableExportAsset, "duration" | "hasAudio" | "hasVideo" | "effectCues" | "effectFilter" | "shaderPresetId" | "shaderRenderSource">,
  ownerId: string,
  upload?: typeof uploadFileToMediaGateway,
  env: Record<string, string | undefined> = process.env,
): Promise<DurableExportAsset> {
  // Worker-local files are not a downloadable final product. Upload failures
  // must remain failed jobs so the project can retry persistence explicitly.
  assertExportOwnerId(ownerId);
  const folder = scopeMediaUploadFolder(`media-uploads/generated/exports/${sanitize(requestKey)}`, ownerId);
  const config = getMediaGatewayConfig(env);
  // The authenticated media reader recognizes this canonical namespace. A
  // custom gateway prefix must not silently move the output outside it.
  if (!config || resolveMediaGatewayUploadFolder(config, folder) !== folder) {
    throw new Error("Final export requires durable storage with its canonical owner-scoped upload prefix.");
  }
  const storage = upload
    ? await upload({ file: new File([await readFile(outputPath)], fileName, { type: "video/mp4" }), folder, env })
    : await uploadWorkerFileToStorage({ filePath: outputPath, fileName, folder, env });
  const videoUrl = storage.mediaUrl || storage.publicUrl;
  const configuredBucket = config.bucket;
  let downloadable = false;
  try {
    const parsedUrl = new URL(videoUrl);
    downloadable = parsedUrl.protocol === "https:" && Boolean(parsedUrl.hostname) && !parsedUrl.username && !parsedUrl.password;
  } catch { /* An invalid URL is not a downloadable export. */ }
  const key = storage.objectKey;
  const canonicalKey = typeof key === "string" && key === normalizeMediaPath(key)
    && !/[\\\u0000-\u001f\u007f%?#]/.test(key) && key.split("/").every(part => part !== "." && part !== "..");
  if (!configuredBucket || storage.bucket !== configuredBucket || !canonicalKey || !key.startsWith(`${folder}/`)
    || !mediaUploadBelongsToOwner(key, ownerId) || (storage.storagePath !== undefined && storage.storagePath !== key) || !downloadable) {
    throw new Error("Final export was rendered but durable storage did not return a downloadable HTTPS asset.");
  }

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

function assertExportOwnerId(ownerId: unknown): asserts ownerId is string {
  if (typeof ownerId !== "string" || !ownerId.trim() || ownerId !== ownerId.trim() || ownerId.length > 200 || /[\u0000-\u001f\u007f]/.test(ownerId)) {
    throw new AbortTaskRunError("Export requires its authenticated dispatch owner.");
  }
}

/** Validate before downloading inputs, creating a workspace, or rendering. */
export function validateExportDispatchOwner(payload: { ownerId: string; projectSnapshot?: FinalExportPayload["projectSnapshot"] }, tags: string[]) {
  assertExportOwnerId(payload.ownerId);
  const owners = tags.filter(tag => tag.startsWith("user:"));
  if (owners.length !== 1 || owners[0] !== `user:${payload.ownerId}`
    || (payload.projectSnapshot && payload.projectSnapshot.ownerId !== payload.ownerId)) {
    throw new AbortTaskRunError("Export requires one matching authenticated owner and project snapshot.");
  }
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
  const segment = value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 128);
  return !segment || segment === "." || segment === ".." ? "export" : segment;
}
