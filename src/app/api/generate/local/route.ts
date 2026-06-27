import {
  checkSwarmUiStatus,
  createSwarmImage,
  normalizeLocalGenerationUrl,
  type LocalGenerationRequest,
} from "@/components/studio/localGeneration";

export const runtime = "nodejs";

export async function GET() {
  const status = await checkSwarmUiStatus({ baseUrl: getSwarmUrl() });
  return Response.json({ success: true, providers: [status] });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Partial<LocalGenerationRequest>;
    if (body.provider && body.provider !== "swarmui") {
      return Response.json({
        success: false,
        error: "SwarmUI is the only supported local generation API surface. ComfyUI runs behind SwarmUI and is not addressed as a separate provider.",
      }, { status: 400 });
    }

    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) {
      return Response.json({ success: false, error: "prompt is required" }, { status: 400 });
    }

    const generationRequest: LocalGenerationRequest = {
      provider: "swarmui",
      prompt,
      negativePrompt: typeof body.negativePrompt === "string" ? body.negativePrompt : undefined,
      width: numberOrUndefined(body.width),
      height: numberOrUndefined(body.height),
      steps: numberOrUndefined(body.steps),
      seed: numberOrUndefined(body.seed),
      cfg: numberOrUndefined(body.cfg),
      model: typeof body.model === "string" ? body.model : undefined,
      action: typeof body.action === "string" ? body.action : undefined,
      kind: body.kind === "video" ? "video" : "image",
      batchSize: numberOrUndefined(body.batchSize),
      swarmParams: swarmParamsOrUndefined(body.swarmParams),
      waitForCompletion: true,
    };

    const job = await createSwarmImage({
      baseUrl: getSwarmUrl(),
      request: generationRequest,
    });
    return Response.json({ success: job.status !== "error", job }, { status: job.status === "error" ? 502 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Local generation failed";
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}

function getSwarmUrl() {
  return normalizeLocalGenerationUrl(process.env.LOCAL_SWARMUI_URL ?? process.env.SWARMUI_URL);
}

function swarmParamsOrUndefined(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value).filter((entry) => {
    const [, entryValue] = entry;
    if (typeof entryValue === "string" || typeof entryValue === "number" || typeof entryValue === "boolean") return true;
    return Array.isArray(entryValue) && entryValue.every((item) => typeof item === "string" || typeof item === "number" || typeof item === "boolean");
  });
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function numberOrUndefined(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
