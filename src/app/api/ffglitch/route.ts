import { readFile } from "node:fs/promises";
import path from "node:path";

import { detectFfglitch } from "@/components/studio/ffglitchApi";
import { uploadFileToMediaGateway } from "@/lib/mediaGateway";
import { triggerFfglitch } from "@/lib/triggerOrchestration";
import type { GlitchMotionVectorParams } from "@/components/studio/ffglitchApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getFfmpegGatewayConfig() {
  const url = process.env.FFMPEG_GATEWAY_URL?.trim().replace(/\/+$/, "") ?? "";
  const apiKey = process.env.FFMPEG_GATEWAY_API_KEY?.trim() ?? "";
  return { url, apiKey };
}

export async function GET() {
  const config = getFfmpegGatewayConfig();

  if (config.url) {
    const headers: Record<string, string> = {};
    if (config.apiKey) headers["X-API-Key"] = config.apiKey;

    const response = await fetch(`${config.url}/ffglitch/detect`, { method: "POST", headers });
    const payload = await response.json();

    return Response.json(payload, { status: response.status });
  }

  const capabilities = await detectFfglitch();
  return Response.json(capabilities);
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      action: "probe" | "glitch";
      inputPath?: string;
      outputPath?: string;
      glitchParams?: GlitchMotionVectorParams;
    };

    if ((payload.action !== "probe" && payload.action !== "glitch") || !payload.inputPath?.trim()) {
      return Response.json({ success: false, error: "Invalid action or missing inputPath." }, { status: 400 });
    }
    if (payload.action === "glitch" && !payload.glitchParams) {
      return Response.json({ success: false, error: "glitchParams are required for a glitch operation." }, { status: 400 });
    }

    const sourceIdentity = payload.inputPath.trim();
    const source = await resolveDurableInput(sourceIdentity);
    const handle = await triggerFfglitch({
      action: payload.action,
      inputPath: source.url,
      sourceIdentity,
      fileName: source.fileName,
      outputPath: payload.outputPath,
      glitchParams: payload.glitchParams,
    });
    return Response.json({ success: true, orchestration: "trigger.dev", runId: handle.id, status: "queued" }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown FFglitch error";
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}

async function resolveDurableInput(inputPath: string) {
  if (/^https?:\/\//i.test(inputPath)) {
    const url = new URL(inputPath);
    return { url: inputPath, fileName: path.basename(url.pathname) || "source.mp4" };
  }

  const bytes = await readFile(inputPath);
  const fileName = path.basename(inputPath) || "source.mp4";
  const uploaded = await uploadFileToMediaGateway({
    file: new File([bytes], fileName, { type: mediaType(fileName) }),
    folder: "media-uploads/ffglitch-inputs",
  });
  return { url: uploaded.mediaUrl || uploaded.publicUrl, fileName };
}

function mediaType(fileName: string) {
  const extension = path.extname(fileName).toLowerCase();
  if (extension === ".webm") return "video/webm";
  if (extension === ".avi") return "video/x-msvideo";
  if (extension === ".mov") return "video/quicktime";
  return "video/mp4";
}
