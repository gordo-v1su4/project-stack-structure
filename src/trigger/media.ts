import { createHash } from "node:crypto";
import { logger, metadata, task, tasks, wait } from "@trigger.dev/sdk";

import {
  createMediaGatewayVideoJob,
  downloadJsonFromMediaGateway,
  downloadMediaGatewayFile,
  getMediaGatewayVideoJob,
  getMediaGatewayVideoJobResult,
  uploadFileToMediaGateway,
  uploadJsonToMediaGateway,
  type MediaGatewayUploadResult,
} from "@/lib/mediaGateway";
import { createTriggerIdempotencyKey } from "@/lib/triggerIdempotency";
import { sceneCaptionBatchTask, type SceneCaptionBatchPayload } from "./caption";
import { mediaFinalizationQueue, sceneDetectionQueue } from "./queues";

export const CAPTION_BATCH_SIZE = 6;
export const MEDIA_PIPELINE_VERSION = "stack-structure-media-pipeline-v2";

export type MediaSceneDetectionPayload = {
  bucket: string;
  objectKey: string;
  applicationUserId?: string;
  mode?: string;
  profile?: string;
  metadata?: Record<string, unknown>;
  timeoutSeconds?: number;
  /** Present when the source traveled as ordered gateway chunks (Vercel body cap). */
  uploadChunks?: { size: number; chunks: Array<{ bucket: string; objectKey: string }> };
};

type StorageReference = Pick<MediaGatewayUploadResult, "bucket" | "objectKey" | "storagePath" | "publicUrl" | "mediaUrl" | "mime">;

type SceneDetectionOutput = {
  job: Record<string, unknown>;
  manifestStorage: StorageReference;
  sourceContentHash: string;
  sceneCount: number;
};

type CaptionBatchReference = {
  batchIndex: number;
  sceneCount: number;
  batchStorage: StorageReference;
};

type FinalizationPayload = {
  bucket: string;
  objectKey: string;
  sourceContentHash: string;
  sceneManifestStorage: StorageReference;
  captionBatches: CaptionBatchReference[];
};

export const mediaSceneDetectionTask = task({
  id: "media-video-scene-detect",
  queue: sceneDetectionQueue,
  maxDuration: 900,
  retry: { maxAttempts: 1 },
  run: async (rawPayload: MediaSceneDetectionPayload, { ctx }): Promise<SceneDetectionOutput> => {
    const payload = rawPayload.uploadChunks?.chunks?.length
      ? await assembleChunkedSource(rawPayload, ctx.run.id)
      : rawPayload;
    metadata
      .set("stage", "scene-detection")
      .set("stageLabel", "Detecting scenes")
      .set("providerStatus", "running");
    const directWorkerUrl = process.env.MEDIA_WORKER_URL?.trim().replace(/\/+$/, "");
    const workerOutput = directWorkerUrl
      ? await runDirectMediaWorker(payload, ctx.run.id, directWorkerUrl)
      : await runQueuedMediaWorker(payload, ctx.run.id);
    const manifest = workerOutput.result;
    const sourceContentHash = readString(manifest, "sourceContentHash")
      || createHash("sha256").update(`${payload.bucket}:${payload.objectKey}`).digest("hex");
    const sceneCount = readSegments(manifest).length;
    const manifestStorage = await uploadJsonToMediaGateway({
      data: {
        ...manifest,
        schema: "stack-structure.video-analysis.v2",
        pipelineVersion: MEDIA_PIPELINE_VERSION,
      },
      fileName: durableManifestName(payload.objectKey, sourceContentHash, "scenes"),
      folder: "media-uploads/analysis/v2/scene-manifests",
    });

    logger.info("Scene detection completed", {
      triggerRunId: ctx.run.id,
      sourceContentHash,
      sceneCount,
      manifestObjectKey: manifestStorage.objectKey,
    });
    metadata
      .set("stage", "completed")
      .set("stageLabel", "Scene manifest persisted")
      .set("completedItems", sceneCount)
      .set("totalItems", sceneCount)
      .set("providerStatus", "completed");
    return {
      job: workerOutput.job,
      manifestStorage,
      sourceContentHash,
      sceneCount,
    };
  },
});

export const mediaPipelineFinalizationTask = task({
  id: "media-video-finalize",
  queue: mediaFinalizationQueue,
  maxDuration: 300,
  retry: { maxAttempts: 2, minTimeoutInMs: 2_000, maxTimeoutInMs: 10_000, factor: 2 },
  run: async (payload: FinalizationPayload, { ctx }) => {
    metadata
      .set("stage", "finalizing")
      .set("stageLabel", "Merging caption batches")
      .set("providerStatus", "running");
    const manifest = await downloadJsonFromMediaGateway<Record<string, unknown>>({
      bucket: payload.sceneManifestStorage.bucket,
      objectKey: payload.sceneManifestStorage.objectKey,
    });
    const storedCaptionBatches: Record<string, unknown>[] = [];

    for (const batch of payload.captionBatches) {
      const stored = await downloadJsonFromMediaGateway<Record<string, unknown>>({
        bucket: batch.batchStorage.bucket,
        objectKey: batch.batchStorage.objectKey,
      });
      storedCaptionBatches.push(stored);
    }

    const { segments, captionedSceneCount } = mergeCaptionBatchResults(manifest, storedCaptionBatches);
    const finalManifest = {
      ...manifest,
      schema: "stack-structure.video-analysis.v2",
      pipelineVersion: MEDIA_PIPELINE_VERSION,
      captionedAt: new Date().toISOString(),
      captionBatchCount: payload.captionBatches.length,
      captionedSceneCount,
      segments,
    };
    const manifestStorage = await uploadJsonToMediaGateway({
      data: finalManifest,
      fileName: durableManifestName(payload.objectKey, payload.sourceContentHash, "final"),
      folder: "media-uploads/analysis/v2/final-manifests",
    });

    logger.info("Media pipeline finalized", {
      triggerRunId: ctx.run.id,
      sceneCount: segments.length,
      captionedSceneCount,
      manifestObjectKey: manifestStorage.objectKey,
    });
    metadata
      .set("stage", "completed")
      .set("stageLabel", "Final media manifest persisted")
      .set("completedItems", segments.length)
      .set("totalItems", segments.length)
      .set("providerStatus", "completed");
    return {
      manifestStorage,
      sceneCount: segments.length,
      captionedSceneCount,
    };
  },
});

export const mediaVideoPipelineTask = task({
  id: "media-video-pipeline",
  maxDuration: 3_600,
  retry: { maxAttempts: 1 },
  run: async (payload: MediaSceneDetectionPayload, { ctx }) => {
    const userTag = `user:${payload.applicationUserId?.trim() || "system"}`;
    metadata
      .set("stage", "scene-detection")
      .set("stageLabel", "Detecting scenes")
      .set("progressMode", "indeterminate")
      .set("providerStatus", "running")
      .set("completedItems", 0);
    const sceneRun = await tasks.triggerAndWait<typeof mediaSceneDetectionTask>(
      "media-video-scene-detect",
      payload,
      {
        idempotencyKey: createTriggerIdempotencyKey("media-scenes-v2", [
          payload.bucket,
          payload.objectKey,
          payload.profile ?? "pyscenedetect-adaptive",
          MEDIA_PIPELINE_VERSION,
        ]),
        tags: [userTag, "stack-structure", "media", "scene-detection"],
        metadata: {
          parentRunId: ctx.run.id,
          stage: "scene-detection",
          stageLabel: "Detecting scenes",
          progressMode: "indeterminate",
          providerStatus: "queued",
        },
      },
    );
    if (!sceneRun.ok) throw new Error(`Scene detection failed: ${errorMessage(sceneRun.error)}`);

    const sceneOutput = sceneRun.output;
    const manifest = await downloadJsonFromMediaGateway<Record<string, unknown>>({
      bucket: sceneOutput.manifestStorage.bucket,
      objectKey: sceneOutput.manifestStorage.objectKey,
    });
    const segments = readSegments(manifest);
    const model = process.env.QWEN_GGUF_MODEL || "Qwen/Qwen3-VL-4B-Instruct-GGUF:Q4_K_M";
    const prompt = process.env.SCENE_CAPTION_PROMPT ||
      "Analyze this three-panel video scene storyboard. Describe what changes from the first frame to the middle frame to the last frame, and return JSON with caption, shotType, subjects, action, setting, lighting, timeOfDay, and weather.";
    const batches = chunk(segments, CAPTION_BATCH_SIZE);
    metadata
      .set("stage", "captioning")
      .set("stageLabel", "Captioning scene batches")
      .set("progressMode", "exact")
      .set("completedItems", 1)
      .set("totalItems", batches.length + 2)
      .set("providerStatus", "running");
    const captionBatches: CaptionBatchReference[] = [];
    for (const [batchIndex, batch] of batches.entries()) {
      const run = await sceneCaptionBatchTask.triggerAndWait(
        buildCaptionBatchPayload({
          batch,
          batchIndex,
          bucket: payload.bucket,
          sourceContentHash: sceneOutput.sourceContentHash,
          sourceName: payload.objectKey.split("/").pop() || payload.objectKey,
          prompt,
          model,
        }),
        {
          idempotencyKey: createTriggerIdempotencyKey("qwen-caption-batch-v2", [
            sceneOutput.sourceContentHash,
            model,
            hashText(prompt),
            String(batchIndex),
            ...batch.map((segment) => String(segment.index ?? "")),
          ]),
          tags: [userTag, "stack-structure", "media", "qwen-caption"],
          metadata: {
            parentRunId: ctx.run.id,
            itemIndex: batchIndex,
            stage: "captioning",
            stageLabel: `Captioning batch ${batchIndex + 1} of ${batches.length}`,
            progressMode: "exact",
            completedItems: 0,
            totalItems: batch.length,
            providerStatus: "queued",
          },
        },
      );
      if (!run.ok) throw new Error(`Qwen caption batch failed: ${errorMessage(run.error)}`);
      captionBatches.push(run.output);
      metadata.set("completedItems", batchIndex + 2);
    }

    metadata
      .set("stage", "finalizing")
      .set("stageLabel", "Persisting final media manifest")
      .set("providerStatus", "running");
    const finalized = await tasks.triggerAndWait<typeof mediaPipelineFinalizationTask>(
      "media-video-finalize",
      {
        bucket: payload.bucket,
        objectKey: payload.objectKey,
        sourceContentHash: sceneOutput.sourceContentHash,
        sceneManifestStorage: sceneOutput.manifestStorage,
        captionBatches,
      },
      {
        idempotencyKey: createTriggerIdempotencyKey("media-finalize-v2", [
          sceneOutput.sourceContentHash,
          ...captionBatches.map((batch) => batch.batchStorage.objectKey),
        ]),
        tags: [userTag, "stack-structure", "media", "finalization"],
        metadata: {
          parentRunId: ctx.run.id,
          stage: "finalizing",
          stageLabel: "Persisting final media manifest",
          progressMode: "indeterminate",
          providerStatus: "queued",
        },
      },
    );
    if (!finalized.ok) throw new Error(`Media finalization failed: ${errorMessage(finalized.error)}`);

    metadata
      .set("stage", "completed")
      .set("stageLabel", "Media analysis persisted")
      .set("completedItems", batches.length + 2)
      .set("providerStatus", "completed");
    return {
      ...finalized.output,
      job: {
        job_id: ctx.run.id,
        status: "completed",
        stage: "pipeline-completed",
        bucket: payload.bucket,
        objectKey: payload.objectKey,
      },
      childRuns: {
        sceneDetection: sceneRun.id,
        captionBatchCount: captionBatches.length,
        finalization: finalized.id,
      },
    };
  },
});

async function assembleChunkedSource(payload: MediaSceneDetectionPayload, triggerRunId: string) {
  const chunkRefs = payload.uploadChunks?.chunks ?? [];
  if (!chunkRefs.length) return payload;
  metadata.set("stageLabel", "Reassembling chunked upload");
  const parts: Buffer[] = [];
  for (const [index, ref] of chunkRefs.entries()) {
    const part = await downloadMediaGatewayFile({
      bucket: ref.bucket,
      objectKey: ref.objectKey,
      fileName: `part-${String(index).padStart(5, "0")}.part`,
    });
    parts.push(Buffer.from(part.bytes));
  }
  // Parts are contiguous byte-slices of one original file — binary concat
  // reproduces it exactly. No container-level concat is possible here.
  const assembled = Buffer.concat(parts);
  const storage = await uploadFileToMediaGateway({
    file: new File([assembled], "assembled.mp4", { type: "video/mp4" }),
    folder: "media-uploads/video-source/assembled",
  });
  logger.info("Assembled chunked video source", {
    triggerRunId,
    parts: chunkRefs.length,
    bytes: assembled.byteLength,
    objectKey: storage.objectKey,
  });
  return { ...payload, bucket: storage.bucket, objectKey: storage.objectKey, uploadChunks: undefined };
}

async function runQueuedMediaWorker(payload: MediaSceneDetectionPayload, triggerRunId: string) {
  const job = await createMediaGatewayVideoJob({
    bucket: payload.bucket,
    objectKey: payload.objectKey,
    mode: payload.mode,
    profile: payload.profile,
    metadata: { ...payload.metadata, triggerRunId, pipelineVersion: MEDIA_PIPELINE_VERSION },
  });
  const timeoutMs = Math.max(30, Math.min(payload.timeoutSeconds ?? 840, 840)) * 1_000;
  const startedAt = Date.now();
  let current = job;
  while (current.status !== "completed") {
    if (current.status === "failed") throw new Error(current.error || `Media job ${current.job_id} failed`);
    if (Date.now() - startedAt > timeoutMs) throw new Error(`Media job ${current.job_id} timed out`);
    await wait.for({ seconds: 3 });
    current = await getMediaGatewayVideoJob({ jobId: current.job_id });
  }
  const result = await getMediaGatewayVideoJobResult({ jobId: current.job_id });
  return {
    job: current as unknown as Record<string, unknown>,
    result: unwrapMediaWorkerManifest(result),
  };
}

async function runDirectMediaWorker(payload: MediaSceneDetectionPayload, triggerRunId: string, workerUrl: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const workerToken = process.env.MEDIA_WORKER_API_TOKEN?.trim();
  if (workerToken) headers.Authorization = `Bearer ${workerToken}`;
  const response = await fetch(`${workerUrl}/video/analyze`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      bucket: payload.bucket,
      objectKey: payload.objectKey,
      mode: payload.mode,
      profile: payload.profile,
      metadata: { ...payload.metadata, triggerRunId, pipelineVersion: MEDIA_PIPELINE_VERSION },
    }),
    signal: AbortSignal.timeout(Math.max(30, Math.min(payload.timeoutSeconds ?? 840, 840)) * 1_000),
  });
  const result = await readJson(response);
  if (!response.ok || !isRecord(result.manifest) || result.error) {
    const detail = readString(result, "detail") || readString(result, "error") || response.statusText || "unknown media-worker error";
    throw new Error(`Direct media worker failed (${response.status}): ${detail}`);
  }
  return {
    job: { job_id: triggerRunId, status: "completed", stage: "scene-detection-completed", bucket: payload.bucket, objectKey: payload.objectKey },
    result: result.manifest,
  };
}

export function buildCaptionBatchPayload(args: {
  batch: Record<string, unknown>[];
  batchIndex: number;
  bucket: string;
  sourceContentHash: string;
  sourceName: string;
  prompt: string;
  model: string;
}): SceneCaptionBatchPayload {
  return {
    batchIndex: args.batchIndex,
    sourceContentHash: args.sourceContentHash,
    prompt: args.prompt,
    model: args.model,
    scenes: args.batch.map((segment, arrayIndex) => {
      const sceneIndex = typeof segment.index === "number" ? segment.index : args.batchIndex * CAPTION_BATCH_SIZE + arrayIndex + 1;
      const sampleTimes = isRecord(segment.sample_times) ? segment.sample_times : {};
      return {
        sceneIndex,
        bucket: args.bucket,
        objectKey: readString(segment, "storyboard_path") || readString(segment, "storyboardPath") || "",
        fileName: `scene-${String(sceneIndex).padStart(3, "0")}-storyboard.jpg`,
        sceneId: String(sceneIndex),
        sourceName: args.sourceName,
        sampleTime: String(sampleTimes.middle ?? ""),
        sceneStart: String(segment.start_seconds ?? ""),
        sceneEnd: String(segment.end_seconds ?? ""),
        sceneDuration: String(segment.duration_seconds ?? ""),
        captionContext: JSON.stringify({ sampleTimes, instruction: "Caption motion and change across the three panels." }),
      };
    }),
  };
}

export function mergeCaptionBatchResults(
  manifest: Record<string, unknown>,
  storedBatches: Record<string, unknown>[],
) {
  const captionsByScene = new Map<number, Record<string, unknown>>();
  for (const stored of storedBatches) {
    const captions = Array.isArray(stored.captions) ? stored.captions : [];
    for (const item of captions) {
      if (!isRecord(item) || typeof item.sceneIndex !== "number" || !isRecord(item.result)) continue;
      captionsByScene.set(item.sceneIndex, item.result);
    }
  }
  const segments = readSegments(manifest).map((segment, arrayIndex) => {
    const sceneIndex = typeof segment.index === "number" ? segment.index : arrayIndex + 1;
    const result = captionsByScene.get(sceneIndex);
    return result ? applyCaptionResult(segment, result) : segment;
  });
  return { segments, captionedSceneCount: captionsByScene.size };
}

export function applyCaptionResult(segment: Record<string, unknown>, result: Record<string, unknown>) {
  const text = readString(result, "text") || readString(result, "caption");
  const parsed = parseCaptionText(text);
  const caption = readString(parsed, "caption") || readString(parsed, "text") || text;
  return {
    ...segment,
    caption,
    sceneData: Object.keys(parsed).length ? parsed : undefined,
    captionSource: readString(result, "source") || readString(result, "captionSource") || "qwen3-vl-server",
    captionMode: "smart",
    captionModel: readString(result, "model"),
    captionSampleStrategy: "three-frame-storyboard",
  };
}

function parseCaptionText(text: string | undefined) {
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function durableManifestName(objectKey: string, sourceContentHash: string, stage: string) {
  const name = objectKey.split("/").pop()?.replace(/[^a-zA-Z0-9._-]+/g, "-") || "video";
  return `${name}-${sourceContentHash.slice(0, 16)}.${stage}.v2.json`;
}

function readSegments(manifest: Record<string, unknown>) {
  return Array.isArray(manifest.segments) ? manifest.segments.filter(isRecord) : [];
}

export function unwrapMediaWorkerManifest(payload: Record<string, unknown>) {
  if (isRecord(payload.manifest)) return payload.manifest;
  if (isRecord(payload.result) && isRecord(payload.result.manifest)) return payload.result.manifest;
  return payload;
}

export function chunk<T>(items: T[], size: number) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
}

function hashText(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text().catch(() => "");
  if (!text.trim()) return {};
  try {
    const value = JSON.parse(text) as unknown;
    return isRecord(value) ? value : { value };
  } catch {
    return { error: text.slice(0, 500) };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: Record<string, unknown>, key: string) {
  const item = value[key];
  return typeof item === "string" && item.trim() ? item.trim() : undefined;
}

function errorMessage(value: unknown) {
  return value instanceof Error
    ? value.message
    : isRecord(value) && typeof value.message === "string"
      ? value.message
      : String(value);
}
