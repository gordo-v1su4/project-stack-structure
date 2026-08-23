import { runs, tasks } from "@trigger.dev/sdk";

import { auth as applicationAuth } from "@/auth";
import type { LocalGenerationPayload, localGenerationTask } from "@/trigger/localGeneration";
import type { HiggsfieldGenerationPayload, higgsfieldGenerationTask } from "@/trigger/higgsfield";
import type { DeepgramStoredAudioPayload, deepgramTranscriptionTask } from "@/trigger/deepgram";
import type { FfmpegPreviewPayload, ffmpegPreviewTask } from "@/trigger/ffmpeg";
import type { FinalExportPayload, ShaderCaptureExportPayload, finalExportTask, shaderCaptureExportTask } from "@/trigger/export";
import type { SmartSceneCaptionPayload, smartSceneCaptionTask } from "@/trigger/caption";
import type { EssentiaStoredAudioPayload, essentiaStoredAudioTask } from "@/trigger/essentia";
import type { MediaSceneDetectionPayload, mediaVideoPipelineTask } from "@/trigger/media";
import type { FfglitchPayload, ffglitchTask } from "@/trigger/ffglitch";
import type { ImageSplitterPayload, imageSplitterTask } from "@/trigger/imageSplitter";
import { createTriggerIdempotencyKey } from "@/lib/triggerIdempotency";

export const STACK_STRUCTURE_TRIGGER_TASKS = {
  mediaVideoPipeline: "media-video-pipeline",
  mediaSceneDetection: "media-video-scene-detect",
  mediaSceneCaptionBatch: "qwen-scene-caption-batch",
  mediaFinalization: "media-video-finalize",
  essentiaAnalysis: "essentia-analyze-stored-audio",
  smartSceneCaption: "qwen-smart-scene-caption",
  localGeneration: "local-ai-generation",
  higgsfieldGeneration: "higgsfield-nano-banana-pro-grid",
  deepgramTranscription: "deepgram-transcribe-stored-audio",
  ffmpegPreview: "ffmpeg-preview-or-concat",
  finalExport: "ffmpeg-final-music-video-export",
  shaderCaptureExport: "ffmpeg-shader-capture-export",
  ffglitch: "ffglitch-transform",
  imageSplitter: "image-split-grid",
} as const;

export async function triggerMediaSceneDetection(payload: MediaSceneDetectionPayload) {
  assertTriggerConfigured();
  const dispatch = await buildDispatchContext(["stack-structure", "media", "pipeline-v2"], {
    stageLabel: "Waiting for media pipeline capacity",
    progressMode: "exact",
  });
  return tasks.trigger<typeof mediaVideoPipelineTask>(STACK_STRUCTURE_TRIGGER_TASKS.mediaVideoPipeline, {
    ...payload,
    applicationUserId: dispatch.userId,
  }, {
    idempotencyKey: createTriggerIdempotencyKey("media-video-pipeline-v2", [
      payload.bucket,
      payload.objectKey,
      payload.mode ?? "scene-detect",
      payload.profile ?? "pyscenedetect-adaptive",
      "stack-structure-media-pipeline-v2",
    ]),
    idempotencyKeyTTL: "24h",
    maxAttempts: 1,
    tags: dispatch.tags,
    metadata: dispatch.metadata,
  });
}

export async function triggerEssentiaAnalysis(payload: EssentiaStoredAudioPayload) {
  assertTriggerConfigured();
  const dispatch = await buildDispatchContext(["stack-structure", "essentia", "vm100-heavy"], {
    stageLabel: "Waiting for VM100 audio analysis",
    progressMode: "indeterminate",
  });
  return tasks.trigger<typeof essentiaStoredAudioTask>(STACK_STRUCTURE_TRIGGER_TASKS.essentiaAnalysis, payload, {
    idempotencyKey: createTriggerIdempotencyKey("essentia", [
      ...(payload.chunks
        ? payload.chunks.map((chunk) => `${chunk.bucket}:${chunk.objectKey}`)
        : [`${payload.bucket}:${payload.objectKey}`]),
      payload.size ?? "",
      payload.mode ?? "fast",
      "chunked-source-v1",
    ]),
    idempotencyKeyTTL: "24h",
    maxAttempts: 2,
    tags: dispatch.tags,
    metadata: dispatch.metadata,
  });
}

export async function triggerSmartSceneCaption(payload: SmartSceneCaptionPayload, imageDigest: string) {
  assertTriggerConfigured();
  const dispatch = await buildDispatchContext(["stack-structure", "caption", "qwen", "vm100-heavy"], {
    stageLabel: "Waiting for VM100 caption capacity",
    progressMode: "indeterminate",
  });
  return tasks.trigger<typeof smartSceneCaptionTask>(STACK_STRUCTURE_TRIGGER_TASKS.smartSceneCaption, payload, {
    idempotencyKey: createTriggerIdempotencyKey("smart-caption", [
      payload.sourceName ?? "unknown-source",
      payload.sceneId ?? "unknown-scene",
      payload.sampleTime ?? "unknown-time",
      payload.prompt,
      payload.model,
      payload.sceneStart ?? "",
      payload.sceneEnd ?? "",
      payload.sceneDuration ?? "",
      payload.captionContext ?? "",
      imageDigest,
    ]),
    idempotencyKeyTTL: "24h",
    maxAttempts: 2,
    tags: dispatch.tags,
    metadata: dispatch.metadata,
  });
}

export async function triggerLocalGeneration(payload: LocalGenerationPayload) {
  assertTriggerConfigured();
  const request = payload.request;
  const dispatch = await buildDispatchContext(["stack-structure", "local-generation", request.provider, "vm100-heavy"], {
    stageLabel: "Waiting for VM100 generation capacity",
    progressMode: "provider",
  });
  return tasks.trigger<typeof localGenerationTask>(STACK_STRUCTURE_TRIGGER_TASKS.localGeneration, payload, {
    idempotencyKey: createTriggerIdempotencyKey("local-generation", [
      request.provider,
      request.kind ?? "image",
      request.prompt,
      request.negativePrompt ?? "",
      request.model ?? "default",
      typeof request.seed === "number" ? String(request.seed) : "random",
      request.width ?? "",
      request.height ?? "",
      request.steps ?? "",
      request.cfg ?? "",
      request.action ?? "",
      request.batchSize ?? "",
      JSON.stringify(request.swarmParams ?? {}),
      request.workflow ? JSON.stringify(request.workflow) : "swarm-api",
      payload.outputFolder ?? "",
      payload.timeoutSeconds ?? "",
    ]),
    idempotencyKeyTTL: "24h",
    maxAttempts: 1,
    tags: dispatch.tags,
    metadata: dispatch.metadata,
  }) as Promise<{ id: string }>;
}

export async function triggerHiggsfieldGeneration(payload: HiggsfieldGenerationPayload) {
  assertTriggerConfigured();
  const dispatch = await buildDispatchContext(["stack-structure", "higgsfield", "external-paid"], {
    stageLabel: "Waiting for paid generation capacity",
    progressMode: "provider",
  });
  return tasks.trigger<typeof higgsfieldGenerationTask>(STACK_STRUCTURE_TRIGGER_TASKS.higgsfieldGeneration, payload, {
    idempotencyKey: createTriggerIdempotencyKey("higgsfield", [
      payload.prompt,
      payload.title ?? "",
      payload.characterName ?? "",
      payload.aspectRatio ?? "16:9",
      payload.resolution ?? "2k",
      String(payload.splitRows),
      String(payload.splitCols),
      ...payload.inputImages.map((image) => `${image.id ?? ""}:${image.url}`),
    ]),
    idempotencyKeyTTL: "24h",
    maxAttempts: 1,
    tags: dispatch.tags,
    metadata: dispatch.metadata,
  });
}

export async function triggerDeepgramTranscription(payload: DeepgramStoredAudioPayload) {
  assertTriggerConfigured();
  const dispatch = await buildDispatchContext(["stack-structure", "deepgram", "external-provider"], {
    stageLabel: "Waiting for transcription capacity",
    progressMode: "provider",
  });
  return tasks.trigger<typeof deepgramTranscriptionTask>(STACK_STRUCTURE_TRIGGER_TASKS.deepgramTranscription, payload, {
    idempotencyKey: createTriggerIdempotencyKey("deepgram", [payload.bucket, payload.objectKey, payload.sourceLabel]),
    idempotencyKeyTTL: "24h",
    maxAttempts: 1,
    tags: dispatch.tags,
    metadata: dispatch.metadata,
  });
}

export async function triggerFfmpegPreview(payload: FfmpegPreviewPayload) {
  assertTriggerConfigured();
  const dispatch = await buildDispatchContext(["stack-structure", "ffmpeg", "preview", "media-assembly"], {
    stageLabel: "Waiting for media assembly capacity",
    progressMode: "indeterminate",
  });
  return tasks.trigger<typeof ffmpegPreviewTask>(STACK_STRUCTURE_TRIGGER_TASKS.ffmpegPreview, payload, {
    idempotencyKey: createTriggerIdempotencyKey("ffmpeg-preview", [
      payload.operation,
      payload.requestKey,
      ...payload.inputFiles.map((file) => `${file.bucket}:${file.objectKey}`),
      JSON.stringify(payload.segments ?? []),
      String(payload.startTime ?? 0),
      String(payload.endTime ?? 1),
    ]),
    idempotencyKeyTTL: "24h",
    maxAttempts: 1,
    tags: dispatch.tags,
    metadata: dispatch.metadata,
  });
}

export async function triggerFinalExport(payload: FinalExportPayload) {
  assertTriggerConfigured();
  const dispatch = await buildDispatchContext(["stack-structure", "ffmpeg", "export", "media-assembly"], {
    stageLabel: "Waiting for media assembly capacity",
    progressMode: "indeterminate",
  });
  return tasks.trigger<typeof finalExportTask>(STACK_STRUCTURE_TRIGGER_TASKS.finalExport, payload, {
    idempotencyKey: createTriggerIdempotencyKey("final-export", [
      payload.requestKey,
      JSON.stringify(payload.segments),
      JSON.stringify(payload.effectCues ?? []),
      JSON.stringify(payload.beats ?? []),
      JSON.stringify(payload.lyricChunks ?? []),
      payload.shaderPresetId ?? "",
      ...payload.videos.map((video) => video.objectKey),
      payload.audio.objectKey,
    ]),
    idempotencyKeyTTL: "24h",
    maxAttempts: 1,
    tags: dispatch.tags,
    metadata: dispatch.metadata,
  });
}

export async function triggerShaderCaptureExport(payload: ShaderCaptureExportPayload) {
  assertTriggerConfigured();
  const dispatch = await buildDispatchContext(["stack-structure", "ffmpeg", "shader-capture", "media-assembly"], {
    stageLabel: "Waiting for media assembly capacity",
    progressMode: "indeterminate",
  });
  return tasks.trigger<typeof shaderCaptureExportTask>(STACK_STRUCTURE_TRIGGER_TASKS.shaderCaptureExport, payload, {
    idempotencyKey: createTriggerIdempotencyKey("shader-capture-export", [payload.requestKey, payload.audio.objectKey, payload.shaderCapture.objectKey]),
    idempotencyKeyTTL: "24h",
    maxAttempts: 1,
    tags: dispatch.tags,
    metadata: dispatch.metadata,
  });
}

export async function triggerFfglitch(payload: FfglitchPayload) {
  assertTriggerConfigured();
  const dispatch = await buildDispatchContext(["stack-structure", "ffglitch", "vm100-heavy"], {
    stageLabel: "Waiting for VM100 FFglitch capacity",
    progressMode: "indeterminate",
  });
  return tasks.trigger<typeof ffglitchTask>(STACK_STRUCTURE_TRIGGER_TASKS.ffglitch, payload, {
    idempotencyKey: createTriggerIdempotencyKey("ffglitch", [
      payload.action,
      payload.sourceIdentity ?? payload.inputPath,
      payload.outputPath ?? "",
      JSON.stringify(payload.glitchParams ?? {}),
    ]),
    idempotencyKeyTTL: "24h",
    maxAttempts: 1,
    tags: dispatch.tags,
    metadata: dispatch.metadata,
  });
}

export async function triggerImageSplitter(payload: ImageSplitterPayload) {
  assertTriggerConfigured();
  const dispatch = await buildDispatchContext(["stack-structure", "image-splitter", "external-provider"], {
    stageLabel: "Waiting for image processing capacity",
    progressMode: "exact",
    totalItems: Math.max(1, payload.options.rows ?? 1) * Math.max(1, payload.options.cols ?? 1),
    completedItems: 0,
  });
  return tasks.trigger<typeof imageSplitterTask>(STACK_STRUCTURE_TRIGGER_TASKS.imageSplitter, payload, {
    idempotencyKey: createTriggerIdempotencyKey("image-split", [
      payload.bucket,
      payload.objectKey,
      payload.fileName,
      JSON.stringify(payload.options),
    ]),
    idempotencyKeyTTL: "24h",
    maxAttempts: 1,
    tags: dispatch.tags,
    metadata: dispatch.metadata,
  });
}

export async function retrieveTriggerRun(runId: string) {
  assertTriggerConfigured();
  const userId = await currentApplicationUserId();
  const run = await runs.retrieve(runId);
  if (!run.tags.includes(`user:${userId}`)) {
    throw new Error("Trigger run is not visible to the current application user.");
  }
  return run;
}

export function assertTriggerConfigured(
  env?: { TRIGGER_API_URL?: string; TRIGGER_SECRET_KEY?: string },
) {
  const source = env ?? process.env as Record<string, string | undefined>;
  if (!source.TRIGGER_API_URL?.trim() || !source.TRIGGER_SECRET_KEY?.trim()) {
    throw new Error("Trigger.dev is not configured. Set TRIGGER_API_URL and TRIGGER_SECRET_KEY.");
  }
}

async function buildDispatchContext(
  tags: string[],
  metadata: Record<string, string | number>,
) {
  const userId = await currentApplicationUserId();
  return {
    userId,
    tags: [`user:${userId}`, ...tags.filter((tag) => !tag.startsWith("user:"))],
    metadata: {
      stage: "queued",
      providerStatus: "queued",
      ...metadata,
    },
  };
}

async function currentApplicationUserId() {
  const session = await applicationAuth();
  const userId = session?.user?.id?.trim();
  // SECURITY: never fall back to a shared identity. Anonymous jobs all share one
  // Trigger user-tag, which would let any caller read every other caller's runs.
  if (!userId) {
    throw new Error("Sign in with GitHub before dispatching Trigger tasks.");
  }
  return userId;
}
