import { getHiggsfieldAccount, type HiggsfieldInputImage, type HiggsfieldResolution } from "@/lib/higgsfieldGateway";
import { getMediaGatewayConfig } from "@/lib/mediaGateway";
import { getSessionUser, unauthorizedResponse } from "@/lib/session";
import { triggerHiggsfieldGeneration } from "@/lib/triggerOrchestration";

export const runtime = "nodejs";

function addAllowedHost(hosts: Set<string>, candidate: string | undefined) {
  if (!candidate?.trim()) return;
  try {
    const value = candidate.trim();
    hosts.add(new URL(value.includes("://") ? value : `https://${value}`).host);
  } catch {
    // Malformed env values are ignored rather than failing startup.
  }
}

function allowedImageHosts(): string[] {
  const config = getMediaGatewayConfig();
  const publicUrl = process.env.MEDIA_GATEWAY_PUBLIC_URL?.trim();
  const extras = (process.env.HIGGSFIELD_ALLOWED_IMAGE_HOSTS ?? "").split(",");
  const hosts = new Set<string>();
  addAllowedHost(hosts, config?.url);
  addAllowedHost(hosts, publicUrl);
  for (const extra of extras) addAllowedHost(hosts, extra);
  return [...hosts];
}

function isAllowedImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && allowedImageHosts().includes(url.host);
  } catch {
    return false;
  }
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return unauthorizedResponse("Sign in with GitHub to check generation providers.");
  try {
    await getHiggsfieldAccount();
    return Response.json({ success: true, configured: true });
  } catch {
    return Response.json({ success: true, configured: false });
  }
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return unauthorizedResponse("Sign in with GitHub to run paid generations.");
  try {
    const body = await request.json() as {
      prompt?: unknown;
      title?: unknown;
      characterName?: unknown;
      aspectRatio?: unknown;
      resolution?: unknown;
      inputImages?: unknown;
      splitRows?: unknown;
      splitCols?: unknown;
    };

    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) return Response.json({ success: false, error: "prompt is required" }, { status: 400 });
    const inputImages = normalizeInputImages(body.inputImages);
    if (!inputImages.length) return Response.json({ success: false, error: "At least one input image URL is required." }, { status: 400 });

    const handle = await triggerHiggsfieldGeneration({
      prompt,
      inputImages,
      characterName: typeof body.characterName === "string" ? body.characterName.trim() : undefined,
      title: typeof body.title === "string" ? body.title.trim() : undefined,
      aspectRatio: typeof body.aspectRatio === "string" && body.aspectRatio.trim() ? body.aspectRatio.trim() : "16:9",
      resolution: normalizeResolution(body.resolution),
      splitRows: normalizeInt(body.splitRows, 1, 24) ?? 3,
      splitCols: normalizeInt(body.splitCols, 1, 24) ?? 3,
    });

    return Response.json({
      success: true,
      orchestration: "trigger.dev",
      runId: handle.id,
      status: "queued",
    }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Higgsfield generation failed";
    return Response.json({ success: false, error: message }, { status: 502 });
  }
}

function normalizeInputImages(value: unknown): HiggsfieldInputImage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const url = typeof record.url === "string" ? record.url.trim() : "";
    if (!url || !isAllowedImageUrl(url)) return [];
    return [{
      id: typeof record.id === "string" ? record.id.trim() : undefined,
      url,
      type: record.type === "media_input" ? "media_input" : undefined,
      label: typeof record.label === "string" ? record.label.trim() : undefined,
    }];
  });
}

function normalizeResolution(value: unknown): HiggsfieldResolution {
  return value === "1k" || value === "4k" ? value : "2k";
}

function normalizeInt(value: unknown, min: number, max: number) {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(numeric)) return undefined;
  return Math.min(max, Math.max(min, Math.trunc(numeric)));
}
