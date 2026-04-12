import {
  applyGlitchWithScript,
  detectFfglitch,
  generateGlitchScript,
  probeFfglitchFeatures,
  type GlitchMotionVectorParams,
} from "@/components/studio/ffglitchApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
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
