import { readFile } from "node:fs/promises";
import path from "node:path";

import { uploadFileToMediaGateway } from "@/lib/mediaGateway";
import { triggerFfmpegPreview } from "@/lib/triggerOrchestration";

export const runtime = "nodejs";

interface PreviewSectionRequest {
  inputPath?: string;
  requestKey?: string;
  startTime?: number;
  endTime?: number;
  segments?: Array<{ inputPath: string; startTime: number; endTime: number }>;
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as PreviewSectionRequest;
    const requestKey = payload.requestKey ?? `preview-${Date.now()}`;
    const paths = payload.segments?.length
      ? [...new Set(payload.segments.map((segment) => segment.inputPath).filter(Boolean))]
      : payload.inputPath ? [payload.inputPath] : [];
    if (!paths.length) return Response.json({ success: false, error: "No video input available." }, { status: 400 });

    const inputFiles = await Promise.all(paths.map(async (inputPath) => {
      const bytes = await readFile(inputPath);
      const name = path.basename(inputPath) || "source.mp4";
      const file = new File([bytes], name, { type: "video/mp4" });
      const uploaded = await uploadFileToMediaGateway({
        file,
        folder: `media-uploads/preview-inputs/${sanitize(requestKey)}`,
      });
      return { bucket: uploaded.bucket, objectKey: uploaded.objectKey, fileName: name, mimeType: "video/mp4" };
    }));

    const indexByPath = new Map(paths.map((value, index) => [value, index]));
    const handle = await triggerFfmpegPreview({
      operation: payload.segments?.length ? "concat" : "preview",
      requestKey,
      inputFiles,
      segments: payload.segments?.map((segment) => ({
        startTime: segment.startTime,
        endTime: segment.endTime,
        sourceIndex: indexByPath.get(segment.inputPath) ?? 0,
      })),
      startTime: payload.startTime,
      endTime: payload.endTime,
    });

    return Response.json({ success: true, queued: true, orchestration: "trigger.dev", runId: handle.id, requestKey }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Preview generation failed.";
    return Response.json({ success: false, error: message }, { status: /not configured|Missing RustFS/i.test(message) ? 503 : 500 });
  }
}

function sanitize(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "preview";
}
