import { logger, task } from "@trigger.dev/sdk/v3";

import { downloadMediaGatewayFile } from "@/lib/mediaGateway";

import { vm100HeavyQueue } from "./queues";

export type EssentiaStoredAudioPayload = {
  bucket: string;
  objectKey: string;
  sourceLabel: string;
  mode?: "fast" | "full";
};

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
    const source = await downloadMediaGatewayFile({
      bucket: payload.bucket,
      objectKey: payload.objectKey,
      fileName: payload.sourceLabel,
    });

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
    logger.info("Essentia analysis completed", {
      triggerRunId: ctx.run.id,
      sourceLabel: payload.sourceLabel,
      duration: normalized.duration,
      bpm: normalized.bpm,
    });
    return normalized;
  },
});

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
