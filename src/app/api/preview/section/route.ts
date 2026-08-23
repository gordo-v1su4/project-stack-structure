import { getMediaGatewayConfig, normalizeMediaPath } from "@/lib/mediaGateway";
import { getSessionUser, unauthorizedResponse } from "@/lib/session";
import { triggerFfmpegPreview } from "@/lib/triggerOrchestration";

export const runtime = "nodejs";

interface PreviewSectionRequest {
  requestKey?: string;
  startTime?: number;
  endTime?: number;
  inputs?: Array<{ bucket?: string; objectKey?: string; fileName?: string; mimeType?: string }>;
  segments?: Array<{ sourceIndex: number; startTime: number; endTime: number }>;
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return unauthorizedResponse("Sign in with GitHub to render section previews.");
  try {
    const payload = await request.json() as PreviewSectionRequest;
    const requestKey = payload.requestKey ?? `preview-${Date.now()}`;
    const config = getMediaGatewayConfig();
    const rawInputs = payload.inputs ?? [];
    if (!rawInputs.length) {
      return Response.json({ success: false, error: "At least one gateway input (bucket and objectKey) is required." }, { status: 400 });
    }

    const inputFiles: Array<{ bucket: string; objectKey: string; fileName: string; mimeType: string }> = [];
    for (const input of rawInputs) {
      const bucket = input.bucket?.trim() ?? "";
      const objectKey = normalizeMediaPath(input.objectKey ?? "");
      if (!bucket || !objectKey) {
        return Response.json({ success: false, error: "Each input requires bucket and objectKey." }, { status: 400 });
      }
      if (config && bucket !== config.bucket) {
        return Response.json({ success: false, error: `bucket must be ${config.bucket}.` }, { status: 400 });
      }
      inputFiles.push({
        bucket,
        objectKey,
        fileName: input.fileName?.slice(0, 255) || "source.mp4",
        mimeType: input.mimeType || "video/mp4",
      });
    }

    const handle = await triggerFfmpegPreview({
      operation: "preview",
      requestKey,
      inputFiles,
      segments: payload.segments,
      startTime: payload.startTime,
      endTime: payload.endTime,
    });

    return Response.json({ success: true, queued: true, orchestration: "trigger.dev", runId: handle.id, requestKey }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Preview generation failed.";
    return Response.json({ success: false, error: message }, { status: /not configured|Missing RustFS/i.test(message) ? 503 : 500 });
  }
}
