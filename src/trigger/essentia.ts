import { createHash } from "node:crypto";
import { logger, task } from "@trigger.dev/sdk";
import { analyzeStudioAudio, normalizeStudioAudio } from "@/lib/essentiaStudio";

import { ESSENTIA_AUDIO_CHUNK_SIZE_BYTES, type EssentiaAudioChunkReference } from "@/lib/essentiaUpload";
import { deleteMediaGatewayFiles, downloadMediaGatewayFile, uploadFileToMediaGateway, uploadJsonToMediaGateway } from "@/lib/mediaGateway";

import { vm100HeavyQueue } from "./queues";
import { markWorkCompleted, markWorkRunning } from "./workMetadata";

type EssentiaBasePayload = {
  sourceLabel: string;
  mode?: "fast" | "full";
};

export type EssentiaStoredAudioPayload = EssentiaBasePayload & ({
  bucket: string;
  objectKey: string;
  chunks?: never;
  mimeType?: never;
  size?: never;
} | {
  bucket?: never;
  objectKey?: never;
  chunks: EssentiaAudioChunkReference[];
  mimeType: string;
  size: number;
});

export const essentiaStoredAudioTask = task({
  id: "essentia-analyze-stored-audio",
  queue: vm100HeavyQueue,
  maxDuration: 1800,
  retry: {
    maxAttempts: 2,
    factor: 2,
    minTimeoutInMs: 2_000,
    maxTimeoutInMs: 15_000,
    randomize: true,
  },
  run: async (payload: EssentiaStoredAudioPayload, { ctx }) => {
    markWorkRunning("analyzing", "Analyzing master audio", { progressMode: "indeterminate" });
    const { source, sourceStorage, sourceIdentity } = await loadAudioSource(payload);

    const apiUrl = (process.env.ESSENTIA_API_URL || "http://192.168.8.222:18000").replace(/\/+$/, "");
    const apiKey = requireEnv("ESSENTIA_API_KEY", "VITE_ESSENTIA_API_KEY");
    const raw = await analyzeStudioAudio({
      apiUrl, apiKey,
      file: new File([source.bytes], source.fileName, { type: source.mime }),
      idempotencyKey: `studio-${ctx.run.id}`,
      onStage: (stage) => markWorkRunning(stage, audioStageLabel(stage), { progressMode: "indeterminate" }),
    });
    const normalized = normalizeStudioAudio(raw, payload.sourceLabel);
    const analysisStorage = await uploadJsonToMediaGateway({
      data: { ...normalized, rawAnalysis: raw },
      fileName: durableFileName(payload.sourceLabel, sourceIdentity, "essentia"),
      folder: "media-uploads/analysis/essentia",
    });
    await cleanupTemporaryChunks(payload);

    logger.info("Essentia analysis completed", {
      triggerRunId: ctx.run.id,
      sourceLabel: payload.sourceLabel,
      duration: normalized.duration,
      bpm: normalized.bpm,
      analysisObjectKey: analysisStorage.objectKey,
    });
    markWorkCompleted("Audio analysis persisted", { completedItems: 1, totalItems: 1 });
    return {
      ...normalized,
      analysisStorage,
      sourceStorage,
    };
  },
});

async function cleanupTemporaryChunks(payload: EssentiaStoredAudioPayload) {
  if (!payload.chunks?.length) return;

  const chunksByBucket = new Map<string, string[]>();
  for (const chunk of payload.chunks) {
    const objectKeys = chunksByBucket.get(chunk.bucket) ?? [];
    objectKeys.push(chunk.objectKey);
    chunksByBucket.set(chunk.bucket, objectKeys);
  }

  for (const [bucket, objectKeys] of chunksByBucket) {
    try {
      await deleteMediaGatewayFiles({ bucket, objectKeys });
    } catch (error) {
      logger.warn("Essentia temporary chunk cleanup failed", {
        bucket,
        objectCount: objectKeys.length,
        error: error instanceof Error ? error.message : "Unknown cleanup failure",
      });
    }
  }
}

export function copyAudioChunk(target: Uint8Array, chunk: ArrayBuffer, offset: number) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset + chunk.byteLength > target.byteLength) {
    throw new Error("Audio chunk exceeds declared audio size.");
  }
  target.set(new Uint8Array(chunk), offset);
  return offset + chunk.byteLength;
}

async function loadAudioSource(payload: EssentiaStoredAudioPayload) {
  if ("bucket" in payload && payload.bucket && payload.objectKey) {
    return {
      source: await downloadMediaGatewayFile({
        bucket: payload.bucket,
        objectKey: payload.objectKey,
        fileName: payload.sourceLabel,
      }),
      sourceIdentity: `${payload.bucket}:${payload.objectKey}`,
      sourceStorage: undefined,
    };
  }

  const { chunks, mimeType, size } = payload;
  if (!chunks?.length || !mimeType || !size) {
    throw new Error("Essentia requires stored audio or a complete chunk manifest.");
  }

  const output = new Uint8Array(size);
  let offset = 0;
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    if (!chunk) throw new Error(`Missing audio chunk ${index}.`);
    const downloaded = await downloadMediaGatewayFile({
      bucket: chunk.bucket,
      objectKey: chunk.objectKey,
    });
    const expectedSize = Math.min(ESSENTIA_AUDIO_CHUNK_SIZE_BYTES, size - offset);
    if (downloaded.bytes.byteLength !== expectedSize) {
      throw new Error(`Audio chunk ${index} size mismatch: expected ${expectedSize}, received ${downloaded.bytes.byteLength}.`);
    }
    offset = copyAudioChunk(output, downloaded.bytes, offset);
  }
  if (offset !== size) throw new Error(`Reassembled audio size mismatch: expected ${size}, received ${offset}.`);

  const bytes = output.buffer;
  const uploaded = await uploadFileToMediaGateway({
    file: new File([bytes], payload.sourceLabel, { type: mimeType }),
    folder: "media-uploads/source-audio",
  });
  return {
    source: { bytes, fileName: payload.sourceLabel, mime: mimeType },
    sourceIdentity: chunks.map((chunk) => `${chunk.bucket}:${chunk.objectKey}`).join("|"),
    sourceStorage: {
      storageProvider: "rustfs",
      storageBucket: uploaded.bucket,
      storagePath: uploaded.objectKey,
      storageUrl: uploaded.mediaUrl || uploaded.publicUrl,
      storageStatus: "uploaded",
      storageError: null,
    },
  };
}

function safeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "audio";
}

function durableFileName(label: string, identity: string, suffix: string) {
  const digest = createHash("sha256").update(identity).digest("hex").slice(0, 16);
  return `${safeFileName(label)}-${digest}.${suffix}.json`;
}

function requireEnv(...keys: string[]) {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  throw new Error(`Missing required environment variable: ${keys.join(" or ")}`);
}

function audioStageLabel(stage: string) {
  const labels: Record<string, string> = {
    queued: "Waiting for audio analysis", loading: "Reading master audio", decoding: "Reading master audio",
    rhythm: "Detecting beats, onsets and energy", structure: "Detecting song sections",
    validating: "Checking audio analysis", completed: "Audio analysis complete",
  };
  return labels[stage] ?? "Analyzing master audio";
}
