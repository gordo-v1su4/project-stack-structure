import { NextRequest, NextResponse } from "next/server";
import {
  isDeepgramCoverageSparse,
  measureDeepgramWordCoverage,
  pickRicherDeepgramResponse,
} from "@/components/studio/deepgramUtils";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const apiKey = process.env.DEEPGRAM_API_KEY || process.env.DEEPGRAM_TOKEN;
  const filename = decodeURIComponent(request.headers.get("x-audio-filename") || "vocal-stem");
  const contentType = request.headers.get("content-type") || "application/octet-stream";

  console.info(`[Deepgram] Received vocal stem transcription request: ${filename}`);

  if (!apiKey) {
    console.warn("[Deepgram] Missing DEEPGRAM_API_KEY/DEEPGRAM_TOKEN; cannot transcribe vocal stem.");
    return NextResponse.json(
      {
        ok: false,
        error:
          "DEEPGRAM_API_KEY is not configured for this dev server. Add it to .env.local/.env and restart, then re-upload the vocal stem.",
      },
      { status: 200 },
    );
  }

  try {
    const body = new Blob([await request.arrayBuffer()], { type: contentType });
    if (!body.size) {
      console.warn("[Deepgram] Empty vocal stem upload body.");
      return NextResponse.json({ ok: false, error: "No audio bytes received." }, { status: 400 });
    }

    console.info(`[Deepgram] Forwarding ${body.size} bytes from ${filename} to Deepgram.`);

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

    const primary = await callDeepgram(query, apiKey, contentType, body);
    console.info(`[Deepgram] Response for ${filename}: ${primary.status} ${primary.statusText}`);

    let payload = primary.payload;

    // Speech models (nova-*) routinely stop recognizing sung vocals once the
    // mix gets denser, leaving the back half of a song without lyrics even
    // though the audio is fine. When word coverage stops well short of the
    // audio duration, retry with whisper (much stronger on singing) and keep
    // whichever transcription covers more of the song.
    const fallbackModel = process.env.DEEPGRAM_FALLBACK_MODEL || "whisper-large";
    if (primary.ok && isRecord(payload) && fallbackModel && fallbackModel !== model) {
      const coverage = measureDeepgramWordCoverage(payload);
      if (isDeepgramCoverageSparse(coverage)) {
        console.info(
          `[Deepgram] ${model} words end at ${coverage.lastWordEnd.toFixed(1)}s of ${coverage.duration.toFixed(1)}s audio for ${filename}; retrying with ${fallbackModel} for sung vocals.`,
        );
        // Whisper on Deepgram rejects the intelligence add-ons; keep it lean.
        const whisperQuery = new URLSearchParams({
          model: fallbackModel,
          smart_format: "true",
          punctuate: "true",
          utterances: "true",
          utt_split: "0.8",
          language,
        });
        try {
          const retry = await callDeepgram(whisperQuery, apiKey, contentType, body);
          if (retry.ok && isRecord(retry.payload)) {
            const retryCoverage = measureDeepgramWordCoverage(retry.payload);
            console.info(
              `[Deepgram] ${fallbackModel} words end at ${retryCoverage.lastWordEnd.toFixed(1)}s (${retryCoverage.wordCount} words) for ${filename}.`,
            );
            payload = pickRicherDeepgramResponse(payload, retry.payload);
          } else {
            console.warn(`[Deepgram] ${fallbackModel} retry failed (${retry.status}); keeping ${model} result.`);
          }
        } catch (retryError) {
          console.warn(`[Deepgram] ${fallbackModel} retry errored; keeping ${model} result.`, retryError);
        }
      }
    }

    return NextResponse.json(payload, { status: primary.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Deepgram proxy failed.";
    console.error("[Deepgram] Vocal stem transcription failed", error);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}

async function callDeepgram(query: URLSearchParams, apiKey: string, contentType: string, body: Blob) {
  const response = await fetch(`https://api.deepgram.com/v1/listen?${query}`, {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": contentType,
    },
    body,
  });

  const text = await response.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { ok: false, error: text || "Deepgram returned a non-JSON response." };
  }

  return { ok: response.ok, status: response.status, statusText: response.statusText, payload };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
