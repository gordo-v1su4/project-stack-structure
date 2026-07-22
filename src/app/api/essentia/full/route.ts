import { uploadFileToMediaGateway } from "@/lib/mediaGateway";
import { triggerEssentiaAnalysis } from "@/lib/triggerOrchestration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const mode = new URL(request.url).searchParams.get("mode") === "full" ? "full" : "fast";
    if (request.headers.get("content-type")?.includes("application/json")) {
      const payload = await request.json() as Record<string, unknown>;
      const sourceLabel = readRequiredString(payload.sourceLabel);
      const mimeType = readRequiredString(payload.mimeType);
      const size = typeof payload.size === "number" && Number.isSafeInteger(payload.size) && payload.size > 0
        ? payload.size
        : null;
      const chunks = readAudioChunks(payload.chunks);
      if (!sourceLabel || !mimeType || !size || !chunks) {
        return Response.json({ error: "Valid sourceLabel, mimeType, size, and chunk references are required." }, { status: 400 });
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

function readRequiredString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readAudioChunks(value: unknown) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 256) return null;
  const chunks = value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const chunk = entry as Record<string, unknown>;
    const bucket = readRequiredString(chunk.bucket);
    const objectKey = readRequiredString(chunk.objectKey);
    return bucket && objectKey ? { bucket, objectKey } : null;
  });
  return chunks.every((chunk) => chunk !== null)
    ? chunks as Array<{ bucket: string; objectKey: string }>
    : null;
}
