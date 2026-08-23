import path from "node:path";

import { detectFfglitch } from "@/components/studio/ffglitchApi";
import { getMediaGatewayConfig } from "@/lib/mediaGateway";
import { getSessionUser, unauthorizedResponse } from "@/lib/session";
import { triggerFfglitch } from "@/lib/triggerOrchestration";
import type { GlitchMotionVectorParams } from "@/components/studio/ffglitchApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getFfmpegGatewayConfig() {
  const url = process.env.FFMPEG_GATEWAY_URL?.trim().replace(/\/+$/, "") ?? "";
  const apiKey = process.env.FFMPEG_GATEWAY_API_KEY?.trim() ?? "";
  return { url, apiKey };
}

// SECURITY: glitch inputs must be durable gateway objects. Local server paths are
// never accepted (serverless has none; they enable arbitrary reads) and remote
// fetches are restricted to allowlisted media hosts.
function addAllowedHost(hosts: Set<string>, candidate: string | undefined) {
  if (!candidate?.trim()) return;
  try {
    const value = candidate.trim();
    hosts.add(new URL(value.includes("://") ? value : `https://${value}`).host);
  } catch {
    // Malformed env values are ignored rather than failing startup.
  }
}

function allowedInputHosts(): string[] {
  const config = getMediaGatewayConfig();
  const publicUrl = process.env.MEDIA_GATEWAY_PUBLIC_URL?.trim();
  const extras = (process.env.FFGLITCH_ALLOWED_INPUT_HOSTS ?? "").split(",");
  const hosts = new Set<string>();
  addAllowedHost(hosts, config?.url);
  addAllowedHost(hosts, publicUrl);
  for (const extra of extras) addAllowedHost(hosts, extra);
  return [...hosts];
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return unauthorizedResponse("Sign in with GitHub to check FFglitch capabilities.");

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
  const user = await getSessionUser();
  if (!user) return unauthorizedResponse("Sign in with GitHub to run FFglitch jobs.");
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
    const source = resolveDurableInput(sourceIdentity);
    if (!source) {
      return Response.json(
        { success: false, error: "inputPath must be an https URL on an allowed media host." },
        { status: 400 },
      );
    }
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
    return Response.json({ success: false, error: message }, { status: /sign in with github/i.test(message) ? 401 : 500 });
  }
}

function resolveDurableInput(inputPath: string): { url: string; fileName: string } | null {
  if (!/^https:\/\//i.test(inputPath)) return null;
  try {
    const url = new URL(inputPath);
    if (!allowedInputHosts().includes(url.host)) return null;
    return { url: inputPath, fileName: path.basename(url.pathname) || "source.mp4" };
  } catch {
    return null;
  }
}
