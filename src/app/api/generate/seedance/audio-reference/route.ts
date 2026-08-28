import { getMediaGatewayConfig, normalizeMediaPath } from "@/lib/mediaGateway";
import { getSessionUser, unauthorizedResponse } from "@/lib/session";
import { canReadMediaObject } from "@/lib/studioMediaAccess";
import { triggerSeedanceAudioReference } from "@/lib/triggerOrchestration";
import { resolveSeedanceAudioReferenceWindow } from "@/components/studio/seedanceAudioReference";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RequestBody = {
  requestKey?: unknown;
  audio?: unknown;
  songStart?: unknown;
  songEnd?: unknown;
  songDuration?: unknown;
  handleSeconds?: unknown;
};

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return unauthorizedResponse("Sign in with GitHub to prepare a Seedance timing reference.");

  try {
    const body = await request.json() as RequestBody;
    const config = getMediaGatewayConfig();
    if (!config) throw new Error("RustFS media gateway env is not configured.");
    if (!body.audio || typeof body.audio !== "object" || Array.isArray(body.audio)) {
      return Response.json({ success: false, error: "A durable master-audio reference is required." }, { status: 400 });
    }
    const audio = body.audio as Record<string, unknown>;
    const bucket = typeof audio.bucket === "string" ? audio.bucket.trim() : "";
    const objectKey = normalizeMediaPath(typeof audio.objectKey === "string" ? audio.objectKey : "");
    const fileName = typeof audio.fileName === "string" && audio.fileName.trim()
      ? audio.fileName.trim()
      : objectKey.split("/").pop() || "master-audio.wav";
    if (bucket !== config.bucket) {
      return Response.json({ success: false, error: `Master audio bucket must be ${config.bucket}.` }, { status: 400 });
    }
    if (!objectKey || objectKey.length > 512 || !objectKey.startsWith("media-uploads/")) {
      return Response.json({ success: false, error: "Master audio must be a durable media-uploads object." }, { status: 400 });
    }
    if (!await canReadMediaObject({ userId: user.id, bucket, objectKey })) {
      return Response.json({ success: false, error: "The master-audio object does not belong to this signed-in user." }, { status: 403 });
    }
    const requestKey = typeof body.requestKey === "string" ? body.requestKey.trim() : "";
    if (!requestKey || requestKey.length > 160) {
      return Response.json({ success: false, error: "A valid Seedance request key is required." }, { status: 400 });
    }
    const songStart = Number(body.songStart);
    const songEnd = Number(body.songEnd);
    const songDuration = Number(body.songDuration);
    const handleSeconds = body.handleSeconds === undefined ? 2 : Number(body.handleSeconds);
    const window = resolveSeedanceAudioReferenceWindow({ songStart, songEnd, songDuration, handleSeconds });

    const handle = await triggerSeedanceAudioReference({
      requestKey,
      audio: { bucket, objectKey, fileName, mimeType: typeof audio.mimeType === "string" ? audio.mimeType : undefined },
      songStart,
      songEnd,
      songDuration,
      handleSeconds,
    });
    return Response.json({
      success: true,
      queued: true,
      orchestration: "trigger.dev",
      runId: handle.id,
      requestKey,
      window,
    }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Seedance timing reference preparation failed.";
    const status = /timing|duration|section|handle|json/i.test(message) ? 400 : /not configured/i.test(message) ? 503 : 500;
    return Response.json({ success: false, error: message }, { status });
  }
}
