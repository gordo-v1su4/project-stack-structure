import { NextRequest, NextResponse } from "next/server";
import { uploadFileToMediaGateway } from "@/lib/mediaGateway";
import { getSessionUser, unauthorizedResponse } from "@/lib/session";
import { triggerDeepgramTranscription } from "@/lib/triggerOrchestration";

export const runtime = "nodejs";

const MAX_AUDIO_BYTES = 500 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorizedResponse("Sign in with GitHub to transcribe audio.");
  const filename = decodeURIComponent(request.headers.get("x-audio-filename") || "vocal-stem").slice(0, 255);
  const contentType = request.headers.get("content-type") || "application/octet-stream";

  try {
    const bytes = await request.arrayBuffer();
    if (!bytes.byteLength) {
      console.warn("[Deepgram] Empty vocal stem upload body.");
      return NextResponse.json({ ok: false, error: "No audio bytes received." }, { status: 400 });
    }
    if (bytes.byteLength > MAX_AUDIO_BYTES) {
      return NextResponse.json({ ok: false, error: "Audio exceeds the maximum allowed size." }, { status: 413 });
    }

    const uploaded = await uploadFileToMediaGateway({
      file: new File([bytes], filename, { type: contentType }),
      folder: "media-uploads/source-audio/deepgram",
    });
    const handle = await triggerDeepgramTranscription({
      bucket: uploaded.bucket,
      objectKey: uploaded.objectKey,
      sourceLabel: filename,
      contentType,
    });
    return NextResponse.json({
      ok: true,
      queued: true,
      orchestration: "trigger.dev",
      runId: handle.id,
      storage: uploaded,
    }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Deepgram proxy failed.";
    console.error("[Deepgram] Vocal stem transcription failed", error);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
