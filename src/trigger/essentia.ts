import { createHash } from "node:crypto";
import { logger, task } from "@trigger.dev/sdk";

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
  maxDuration: 600,
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
    const form = new FormData();
    form.set("file", new File([source.bytes], source.fileName, { type: source.mime }));

    const response = await fetch(`${apiUrl}/analyze/${payload.mode === "full" ? "full" : "fast"}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "X-API-Key": apiKey,
      },
      body: form,
      signal: AbortSignal.timeout(540_000),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Essentia failed (${response.status}): ${text.slice(0, 500)}`);
    }

    const raw = JSON.parse(text) as Record<string, unknown>;
    const normalized = normalizeEssentiaResult(raw, payload.sourceLabel);
    const analysisStorage = await uploadJsonToMediaGateway({
      data: normalized,
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
      // Trigger.dev run outputs have a bounded payload size. Keep the full
      // analysis in RustFS, but return enough energy points for the browser's
      // interactive timeline without overflowing the run result.
      energy: downsampleSeries(normalized.energy, 1_200),
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

function normalizeEssentiaResult(payload: Record<string, unknown>, sourceLabel: string) {
  const energy = isRecord(payload.energy) ? numberArray(payload.energy.curve) : [];
  const structure = isRecord(payload.structure) ? payload.structure : {};

  return {
    sourceLabel,
    bpm: numberValue(payload.bpm),
    duration: numberValue(payload.duration),
    beats: numberArray(payload.beats),
    onsets: numberArray(payload.onsets),
    energy,
    boundaries: numberArray(structure.boundaries),
    sections: Array.isArray(structure.sections) ? structure.sections : [],
  };
}

function requireEnv(...keys: string[]) {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  throw new Error(`Missing required environment variable: ${keys.join(" or ")}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function numberArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map(numberValue).filter((entry): entry is number => entry !== null);
}

function numberValue(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function downsampleSeries(values: number[], maxPoints: number) {
  if (values.length <= maxPoints) return values;

  return Array.from({ length: maxPoints }, (_, index) => {
    const start = Math.floor((index * values.length) / maxPoints);
    const end = Math.max(start + 1, Math.floor(((index + 1) * values.length) / maxPoints));
    let peak = 0;
    for (let cursor = start; cursor < end; cursor += 1) {
      peak = Math.max(peak, values[cursor] ?? 0);
    }
    return peak;
  });
}
