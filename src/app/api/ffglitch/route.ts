import {
  applyGlitchWithScript,
  detectFfglitch,
  generateGlitchScript,
  probeFfglitchFeatures,
  type GlitchMotionVectorParams,
} from "@/components/studio/ffglitchApi";

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

    const response = await fetch(`${config.url}/ffglitch/detect`, { headers });
    const payload = await response.json();

    return Response.json(payload, { status: response.status });
  }

  const capabilities = await detectFfglitch();
  return Response.json(capabilities);
}

export async function POST(request: Request) {
  const config = getFfmpegGatewayConfig();

  if (config.url) {
    const payload = (await request.json()) as {
      action: "probe" | "glitch";
      inputPath?: string;
      outputPath?: string;
      glitchParams?: GlitchMotionVectorParams;
    };

    if (payload.action === "probe" && payload.inputPath) {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (config.apiKey) headers["X-API-Key"] = config.apiKey;

      const response = await fetch(`${config.url}/probe`, {
        method: "POST",
        headers,
        body: JSON.stringify({ inputPath: payload.inputPath }),
      });

      const result = await response.json();
      return Response.json(result, { status: response.status });
    }

    if (payload.action === "glitch" && payload.glitchParams) {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (config.apiKey) headers["X-API-Key"] = config.apiKey;

      const response = await fetch(`${config.url}/ffglitch/glitch`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          mode: payload.glitchParams.mode,
          intensity: payload.glitchParams.intensity,
          beatTimes: payload.glitchParams.beatTimes,
        }),
      });

      const result = await response.json();
      return Response.json(result, { status: response.status });
    }

    return Response.json(
      { success: false, error: "Invalid action or missing parameters." },
      { status: 400 }
    );
  }

  try {
    const payload = (await request.json()) as {
      action: "probe" | "glitch";
      inputPath?: string;
      outputPath?: string;
      glitchParams?: GlitchMotionVectorParams;
    };

    const capabilities = await detectFfglitch();
    if (!capabilities.available) {
      return Response.json(
        { success: false, error: "FFglitch is not available on this server." },
        { status: 503 }
      );
    }

    if (payload.action === "probe" && payload.inputPath) {
      const features = await probeFfglitchFeatures(
        payload.inputPath,
        capabilities.ffeditPath ?? undefined
      );
      return Response.json({ success: true, features });
    }

    if (payload.action === "glitch" && payload.inputPath && payload.glitchParams) {
      const scriptPath = await generateGlitchScript(payload.glitchParams);
      const outputPath =
        payload.outputPath ??
        `${payload.inputPath.replace(/\.[^.]+$/, "")}-glitched${payload.inputPath.match(/\.[^.]+$/)?.[0] ?? ".avi"}`;

      const result = await applyGlitchWithScript(
        payload.inputPath,
        scriptPath,
        outputPath,
        capabilities.ffeditPath ?? undefined
      );

      return Response.json({ success: true, ...result });
    }

    return Response.json(
      { success: false, error: "Invalid action or missing parameters." },
      { status: 400 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown FFglitch error";
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}