import { uploadFileToMediaGateway } from "@/lib/mediaGateway";
import { getSessionUser, unauthorizedResponse } from "@/lib/session";
import { triggerFfmpegPreview } from "@/lib/triggerOrchestration";

export const runtime = "nodejs";

type GatewaySegment = {
  startTime: number;
  endTime: number;
  sourceIndex?: number;
};

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return unauthorizedResponse("Sign in with GitHub to render previews.");
  try {
    const formData = await request.formData();
    const primary = formData.get("file");
    const segmentsRaw = formData.get("segments");
    const requestKey = String(formData.get("requestKey") || `preview-${Date.now()}`);

    if (!(primary instanceof File)) return Response.json({ success: false, error: "Video file is required." }, { status: 400 });
    if (typeof segmentsRaw !== "string" || !segmentsRaw.trim()) return Response.json({ success: false, error: "Segments are required." }, { status: 400 });

    const segments = JSON.parse(segmentsRaw) as GatewaySegment[];
    if (!Array.isArray(segments) || !segments.length) return Response.json({ success: false, error: "No segments provided." }, { status: 400 });

    const indexedFiles = [...formData.entries()]
      .map(([key, value]) => {
        const match = key.match(/^file:(\d+)$/);
        return match && value instanceof File ? { index: Number(match[1]), file: value } : null;
      })
      .filter((entry): entry is { index: number; file: File } => entry !== null)
      .sort((left, right) => left.index - right.index);
    const files = indexedFiles.length ? indexedFiles.map((entry) => entry.file) : [primary];

    const inputFiles = await Promise.all(files.map(async (file) => {
      const uploaded = await uploadFileToMediaGateway({
        file,
        folder: `media-uploads/preview-inputs/${sanitize(requestKey)}`,
      });
      return {
        bucket: uploaded.bucket,
        objectKey: uploaded.objectKey,
        fileName: file.name,
        mimeType: file.type || "video/mp4",
      };
    }));

    const handle = await triggerFfmpegPreview({
      operation: "concat",
      requestKey,
      inputFiles,
      segments,
    });
    return Response.json({
      success: true,
      queued: true,
      orchestration: "trigger.dev",
      runId: handle.id,
      requestKey,
    }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gateway preview failed.";
    return Response.json({ success: false, error: message }, { status: /not configured|Missing RustFS/i.test(message) ? 503 : 500 });
  }
}

function sanitize(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "preview";
}
