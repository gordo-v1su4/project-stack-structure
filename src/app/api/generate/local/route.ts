import {
  buildSwarmComfyDirectUrl,
  checkSwarmUiStatus,
  normalizeLocalGenerationUrl,
  type LocalGenerationMediaReference,
  type LocalGenerationRequest,
} from "@/components/studio/localGeneration";
import { getMediaGatewayConfig, normalizeMediaPath } from "@/lib/mediaGateway";
import { getSessionUser, unauthorizedResponse } from "@/lib/session";
import { triggerLocalGeneration } from "@/lib/triggerOrchestration";

export const runtime = "nodejs";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return unauthorizedResponse("Sign in with GitHub to check local generation providers.");
  const [swarm, comfy] = await Promise.all([
    checkSwarmUiStatus({ baseUrl: getSwarmUrl() }),
    checkComfyThroughSwarmStatus(),
  ]);
  return Response.json({
    success: true,
    providers: [
      swarm,
      comfy,
    ],
  });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return unauthorizedResponse("Sign in with GitHub to run local generation.");
  try {
    const body = await request.json() as Partial<LocalGenerationRequest>;
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) {
      return Response.json({ success: false, error: "prompt is required" }, { status: 400 });
    }

    const provider = body.provider === "comfyui" ? "comfyui" : "swarmui";
    const mediaConfig = getMediaGatewayConfig();
    const workflow = body.workflow && typeof body.workflow === "object" && !Array.isArray(body.workflow)
      ? body.workflow
      : undefined;
    const generationRequest: LocalGenerationRequest = {
      provider,
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
      initImage: mediaReferenceOrUndefined(body.initImage, mediaConfig),
      videoEndImage: mediaReferenceOrUndefined(body.videoEndImage, mediaConfig),
      promptImages: mediaReferenceListOrUndefined(body.promptImages, mediaConfig),
      workflow,
      waitForCompletion: true,
    };

    const handle = await triggerLocalGeneration({ request: generationRequest });
    return Response.json({
      success: true,
      orchestration: "trigger.dev",
      runId: handle.id,
      job: {
        provider,
        status: "queued",
        queued: true,
        completed: false,
        message: `${provider === "comfyui" ? "ComfyUI" : "SwarmUI"} generation queued through Trigger.dev.`,
        assets: [],
      },
    }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Local generation failed";
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}

function mediaReferenceOrUndefined(
  value: unknown,
  config: ReturnType<typeof getMediaGatewayConfig>,
): LocalGenerationMediaReference | undefined {
  if (value === undefined || value === null) return undefined;
  if (!config || typeof value !== "object" || Array.isArray(value)) throw new Error("Generation media must be a durable RustFS object.");
  const record = value as Record<string, unknown>;
  const bucket = typeof record.bucket === "string" ? record.bucket.trim() : "";
  const objectKey = typeof record.objectKey === "string" ? normalizeMediaPath(record.objectKey) : "";
  if (bucket !== config.bucket || (!objectKey.startsWith("media-uploads/") && objectKey !== "media-uploads")) {
    throw new Error("Generation media must stay inside the configured media-uploads bucket.");
  }
  return { bucket, objectKey };
}

function mediaReferenceListOrUndefined(
  value: unknown,
  config: ReturnType<typeof getMediaGatewayConfig>,
) {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length > 10) throw new Error("Choose at most 10 durable prompt images.");
  const references = value.map((entry) => mediaReferenceOrUndefined(entry, config));
  if (references.some((entry) => !entry)) throw new Error("Every prompt image must be a durable RustFS object.");
  return references as LocalGenerationMediaReference[];
}

function getSwarmUrl() {
  return normalizeLocalGenerationUrl(process.env.LOCAL_SWARMUI_URL ?? process.env.SWARMUI_URL);
}

async function checkComfyThroughSwarmStatus() {
  const baseUrl = getSwarmUrl();
  try {
    const response = await fetch(buildSwarmComfyDirectUrl(baseUrl, "system_stats"), {
      cache: "no-store",
      signal: AbortSignal.timeout(1_500),
    });
    const details = await response.json().catch(() => undefined);
    return {
      provider: "comfyui" as const,
      baseUrl,
      configured: true,
      reachable: response.ok,
      message: response.ok ? "ComfyUI is reachable through SwarmUI /ComfyBackendDirect." : `ComfyUI-through-Swarm returned HTTP ${response.status}.`,
      details,
    };
  } catch (error) {
    return {
      provider: "comfyui" as const,
      baseUrl,
      configured: true,
      reachable: false,
      message: error instanceof Error ? error.message : "ComfyUI-through-Swarm is not reachable.",
    };
  }
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
