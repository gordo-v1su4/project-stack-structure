import { uploadFileToMediaGateway } from "@/lib/mediaGateway";
import { triggerFinalExport } from "@/lib/triggerOrchestration";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const audioFile = formData.get("audio");
    const segmentsRaw = formData.get("segments");
    const requestKey = String(formData.get("requestKey") || `final-export-${Date.now()}`);
    if (!(audioFile instanceof File)) return Response.json({ success: false, error: "Master audio file is required." }, { status: 400 });
    if (typeof segmentsRaw !== "string" || !segmentsRaw.trim()) return Response.json({ success: false, error: "Export segments are required." }, { status: 400 });

    const inputFiles = [...formData.entries()]
      .map(([key, value]) => {
        const match = key.match(/^file:(\d+)$/);
        return match && value instanceof File ? { index: Number(match[1]), file: value } : null;
      })
      .filter((entry): entry is { index: number; file: File } => entry !== null)
      .sort((left, right) => left.index - right.index)
      .map((entry) => entry.file);
    if (!inputFiles.length) return Response.json({ success: false, error: "At least one source video file is required." }, { status: 400 });

    const segments = JSON.parse(segmentsRaw) as Array<Record<string, unknown>>;
    if (!Array.isArray(segments) || !segments.length) return Response.json({ success: false, error: "No export segments provided." }, { status: 400 });
    const audio = await uploadInput(audioFile, `media-uploads/export-inputs/${sanitize(requestKey)}`);
    const videos = await Promise.all(inputFiles.map((file) => uploadInput(file, `media-uploads/export-inputs/${sanitize(requestKey)}`)));
    const handle = await triggerFinalExport({
      requestKey,
      audio,
      videos,
      segments: segments.map((segment) => ({
        sourceIndex: numberValue(segment.sourceIndex) ?? 0,
        startTime: numberValue(segment.startTime) ?? 0,
        endTime: numberValue(segment.endTime) ?? 0,
        musicStart: numberValue(segment.musicStart),
        musicEnd: numberValue(segment.musicEnd),
        label: typeof segment.label === "string" ? segment.label : undefined,
      })),
      effectCues: parseJsonField(formData.get("shaderCues")) as unknown[] | undefined,
      beats: parseJsonField(formData.get("beats")) as number[] | undefined,
      lyricChunks: parseJsonField(formData.get("lyricChunks")) as Array<{ id?: string; index?: number; start: number; end: number; text?: string }> | undefined,
      shaderPresetId: String(formData.get("shaderPresetId") || "balanced-music-video"),
    });
    return Response.json({ success: true, queued: true, orchestration: "trigger.dev", runId: handle.id, requestKey }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Final export failed.";
    return Response.json({ success: false, error: message }, { status: /not configured|Missing RustFS/i.test(message) ? 503 : 500 });
  }
}

async function uploadInput(file: File, folder: string) {
  const uploaded = await uploadFileToMediaGateway({ file, folder });
  return { bucket: uploaded.bucket, objectKey: uploaded.objectKey, fileName: file.name, mimeType: file.type || "application/octet-stream" };
}

function parseJsonField(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return JSON.parse(value) as unknown;
}

function numberValue(value: unknown) {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(number) ? number : undefined;
}

function sanitize(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "export";
}
