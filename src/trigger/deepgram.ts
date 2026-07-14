import { createHash } from "node:crypto";
import { AbortTaskRunError, logger, task } from "@trigger.dev/sdk";

import {
  isDeepgramCoverageSparse,
  measureDeepgramWordCoverage,
  mergeDeepgramTailResponse,
  pickRicherDeepgramResponse,
} from "@/components/studio/deepgramUtils";
import { downloadMediaGatewayFile, uploadJsonToMediaGateway } from "@/lib/mediaGateway";
import { sliceWavFromSeconds } from "@/lib/wavSlice";

import { externalProviderQueue } from "./queues";
import { markWorkCompleted, markWorkRunning } from "./workMetadata";

export type DeepgramStoredAudioPayload = {
  bucket: string;
  objectKey: string;
  sourceLabel: string;
  contentType?: string;
};

export const deepgramTranscriptionTask = task({
  id: "deepgram-transcribe-stored-audio",
  queue: externalProviderQueue,
  maxDuration: 900,
  // Deepgram is billable and the task contains fallback/tail passes. Replay
  // must be explicit rather than automatically duplicating provider calls.
  retry: { maxAttempts: 1 },
  run: async (payload: DeepgramStoredAudioPayload, { ctx }) => {
    markWorkRunning("transcribing", "Transcribing master audio", { progressMode: "provider" });
    const apiKey = process.env.DEEPGRAM_API_KEY || process.env.DEEPGRAM_TOKEN;
    if (!apiKey) throw new AbortTaskRunError("DEEPGRAM_API_KEY/DEEPGRAM_TOKEN is not configured for the Trigger worker.");

    const source = await downloadMediaGatewayFile({
      bucket: payload.bucket,
      objectKey: payload.objectKey,
      fileName: payload.sourceLabel,
    });
    const rawBytes = new Uint8Array(source.bytes);
    const contentType = payload.contentType || source.mime || "application/octet-stream";
    const model = process.env.DEEPGRAM_MODEL || "nova-3";
    const language = process.env.DEEPGRAM_LANGUAGE || "en";
    const query = new URLSearchParams({
      model,
      summarize: "v2",
      topics: "true",
      intents: "true",
      smart_format: "true",
      punctuate: "true",
      utterances: "true",
      utt_split: "0.8",
      paragraphs: "true",
      detect_entities: "false",
      sentiment: "false",
      language,
    });

    const primary = await callDeepgram(query, apiKey, contentType, new Blob([rawBytes], { type: contentType }));
    if (!primary.ok || !isRecord(primary.payload)) {
      throw new Error(`Deepgram transcription failed (${primary.status}): ${JSON.stringify(primary.payload).slice(0, 500)}`);
    }

    let result: Record<string, unknown> = primary.payload;
    const fallbackModel = process.env.DEEPGRAM_FALLBACK_MODEL || "whisper-large";
    const primaryCoverage = measureDeepgramWordCoverage(result);
    if (fallbackModel && fallbackModel !== model && isDeepgramCoverageSparse(primaryCoverage)) {
      const fallbackQuery = new URLSearchParams({
        model: fallbackModel,
        smart_format: "true",
        punctuate: "true",
        utterances: "true",
        utt_split: "0.8",
        language,
      });
      const fallback = await callDeepgram(fallbackQuery, apiKey, contentType, new Blob([rawBytes], { type: contentType }));
      if (fallback.ok && isRecord(fallback.payload)) result = pickRicherDeepgramResponse(result, fallback.payload);
    }

    const coverage = measureDeepgramWordCoverage(result);
    if (coverage.duration > 45 && coverage.lastWordEnd > 0 && coverage.lastWordEnd < coverage.duration * 0.85) {
      const sliceStart = Math.max(0, coverage.lastWordEnd - 2);
      const tailBytes = sliceWavFromSeconds(rawBytes, sliceStart);
      if (tailBytes) {
        const tailQuery = new URLSearchParams({
          model: fallbackModel || model,
          smart_format: "true",
          punctuate: "true",
          utterances: "true",
          utt_split: "0.8",
          language,
        });
        const tailBuffer = new Uint8Array(tailBytes).buffer as ArrayBuffer;
        const tail = await callDeepgram(tailQuery, apiKey, contentType, new Blob([tailBuffer], { type: contentType }));
        if (tail.ok && isRecord(tail.payload)) result = mergeDeepgramTailResponse(result, tail.payload, sliceStart);
      }
    }

    const transcriptStorage = await uploadJsonToMediaGateway({
      data: result,
      fileName: durableFileName(payload.sourceLabel, `${payload.bucket}:${payload.objectKey}`, "deepgram"),
      folder: "media-uploads/analysis/deepgram",
    });

    logger.info("Deepgram transcription completed", {
      triggerRunId: ctx.run.id,
      sourceLabel: payload.sourceLabel,
      wordCount: measureDeepgramWordCoverage(result).wordCount,
      transcriptObjectKey: transcriptStorage.objectKey,
    });
    markWorkCompleted("Transcript persisted", { completedItems: 1, totalItems: 1 });
    return { ...result, transcriptStorage };
  },
});

function safeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "audio";
}

function durableFileName(label: string, identity: string, suffix: string) {
  const digest = createHash("sha256").update(identity).digest("hex").slice(0, 16);
  return `${safeFileName(label)}-${digest}.${suffix}.json`;
}

async function callDeepgram(query: URLSearchParams, apiKey: string, contentType: string, body: Blob) {
  const response = await fetch(`https://api.deepgram.com/v1/listen?${query}`, {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": contentType,
    },
    body,
    signal: AbortSignal.timeout(300_000),
  });
  const text = await response.text();
  let payload: unknown = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { error: text || "Deepgram returned a non-JSON response." };
  }
  return { ok: response.ok, status: response.status, payload };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
