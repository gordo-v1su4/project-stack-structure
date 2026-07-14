import {
  checkSwarmUiStatus,
  normalizeLocalGenerationUrl,
  type LocalGenerationRequest,
} from "@/components/studio/localGeneration";
import { triggerLocalGeneration } from "@/lib/triggerOrchestration";

export const runtime = "nodejs";

export async function GET() {
  const [swarm, comfy] = await Promise.all([
    checkSwarmUiStatus({ baseUrl: getSwarmUrl() }),
    checkDirectComfyStatus(),
  ]);
  return Response.json({ success: true, providers: [swarm, comfy] });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Partial<LocalGenerationRequest>;
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) {
      return Response.json({ success: false, error: "prompt is required" }, { status: 400 });
    }

    const provider = body.provider === "comfyui" ? "comfyui" : "swarmui";
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

function getSwarmUrl() {
  return normalizeLocalGenerationUrl(process.env.LOCAL_SWARMUI_URL ?? process.env.SWARMUI_URL);
}

async function checkDirectComfyStatus() {
  const baseUrl = normalizeLocalGenerationUrl(process.env.LOCAL_COMFYUI_URL ?? process.env.COMFYUI_URL ?? "http://127.0.0.1:8188");
  try {
    const response = await fetch(`${baseUrl}/system_stats`, {
      cache: "no-store",
      signal: AbortSignal.timeout(1_500),
    });
    const details = await response.json().catch(() => undefined);
    return {
      provider: "comfyui" as const,
      baseUrl,
      configured: true,
      reachable: response.ok,
      message: response.ok ? "Standalone ComfyUI is reachable." : `Standalone ComfyUI returned HTTP ${response.status}.`,
      details,
    };
  } catch (error) {
    return {
      provider: "comfyui" as const,
      baseUrl,
      configured: true,
      reachable: false,
      message: error instanceof Error ? error.message : "Standalone ComfyUI is not reachable.",
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
