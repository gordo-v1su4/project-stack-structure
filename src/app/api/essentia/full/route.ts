import { auth } from "@/auth";
import { ESSENTIA_MAX_AUDIO_SIZE_BYTES, validateEssentiaAudioChunks } from "@/lib/essentiaUpload";
import { getMediaGatewayConfig, uploadFileToMediaGateway } from "@/lib/mediaGateway";
import { triggerEssentiaAnalysis } from "@/lib/triggerOrchestration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return Response.json({ error: "Sign in with GitHub to analyze audio." }, { status: 401 });
    }

    const mode = new URL(request.url).searchParams.get("mode") === "full" ? "full" : "fast";
    if (request.headers.get("content-type")?.includes("application/json")) {
      const payload = await readJsonObject(request);
      if (!payload) return Response.json({ error: "A valid JSON request body is required." }, { status: 400 });

      const sourceLabel = readRequiredString(payload.sourceLabel, 255);
      const mimeType = readRequiredString(payload.mimeType, 127);
      const size = typeof payload.size === "number" && Number.isSafeInteger(payload.size) && payload.size > 0
        ? payload.size
        : null;
      const config = getMediaGatewayConfig();
      if (!config) throw new Error("Missing RustFS media gateway env.");
      const chunks = size ? validateEssentiaAudioChunks({
        value: payload.chunks,
        size,
        bucket: config.bucket,
        uploadPrefix: config.uploadPrefix,
        ownerId: session.user.id,
      }) : null;
      if (!sourceLabel || !isAudioMimeType(mimeType) || !size || !chunks) {
        return Response.json({
          error: `Valid audio metadata and contiguous chunk references are required. Maximum audio size is ${ESSENTIA_MAX_AUDIO_SIZE_BYTES} bytes.`,
        }, { status: 400 });
      }

      const handle = await triggerEssentiaAnalysis({ sourceLabel, mimeType, size, mode, chunks });
      return queuedResponse(handle.id);
    }

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return Response.json({ error: "Audio file is required." }, { status: 400 });
    }

    const uploaded = await uploadFileToMediaGateway({
      file,
      folder: "media-uploads/source-audio",
    });
    const handle = await triggerEssentiaAnalysis({
      bucket: uploaded.bucket,
      objectKey: uploaded.objectKey,
      sourceLabel: file.name,
      mode,
    });

    return queuedResponse(handle.id, {
      storage: {
        storageProvider: "rustfs",
        storageBucket: uploaded.bucket,
        storagePath: uploaded.objectKey,
        storageUrl: uploaded.mediaUrl || uploaded.publicUrl,
        storageStatus: "uploaded",
        storageError: null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Essentia orchestration failed";
    const status = /not configured|Missing RustFS media gateway env/i.test(message) ? 503 : 500;
    return Response.json({ error: message }, { status });
  }
}

function queuedResponse(runId: string, extra: Record<string, unknown> = {}) {
  return Response.json({
    orchestration: "trigger.dev",
    runId,
    status: "queued",
    ...extra,
  }, { status: 202 });
}

async function readJsonObject(request: Request) {
  try {
    const value = await request.json() as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function readRequiredString(value: unknown, maxLength: number) {
  return typeof value === "string" && value.trim() && value.trim().length <= maxLength ? value.trim() : null;
}

function isAudioMimeType(value: string | null): value is string {
  return Boolean(value && (value.startsWith("audio/") || value === "application/octet-stream"));
}
