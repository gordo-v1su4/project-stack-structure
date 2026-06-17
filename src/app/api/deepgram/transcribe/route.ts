import { NextRequest, NextResponse } from "next/server";

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
    const body = Buffer.from(await request.arrayBuffer());
    if (!body.length) {
      console.warn("[Deepgram] Empty vocal stem upload body.");
      return NextResponse.json({ ok: false, error: "No audio bytes received." }, { status: 400 });
    }

    console.info(`[Deepgram] Forwarding ${body.length} bytes from ${filename} to Deepgram.`);

    const model = process.env.DEEPGRAM_MODEL || "nova-3";
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
      language: process.env.DEEPGRAM_LANGUAGE || "en",
    });

    const deepgramResponse = await fetch(`https://api.deepgram.com/v1/listen?${query}`, {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": contentType,
      },
      body,
    });

    const text = await deepgramResponse.text();
    console.info(`[Deepgram] Response for ${filename}: ${deepgramResponse.status} ${deepgramResponse.statusText}`);

    let payload: unknown;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { ok: false, error: text || "Deepgram returned a non-JSON response." };
    }

    return NextResponse.json(payload, { status: deepgramResponse.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Deepgram proxy failed.";
    console.error("[Deepgram] Vocal stem transcription failed", error);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
