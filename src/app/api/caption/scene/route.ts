import { LFM_SCENE_CAPTION_PROMPT, parseSceneCaptionResponse } from "@/review/lib/analysis/scene-caption-format";
import type { SceneCaptionMode, SceneCaptionSource } from "@/components/studio/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_SMART_MODEL_ID = "Qwen/Qwen3-VL-4B-Instruct-GGUF:Q4_K_M";
const DEFAULT_FAST_MODEL_ID = "LiquidAI/LFM2.5-VL-450M-ONNX";
const HEALTH_TIMEOUT_MS = 2_500;

type CaptionGatewayConfig = {
  configured: boolean;
  mode: SceneCaptionMode;
  url: string;
  token: string;
  model: string;
  endpoint: string;
  captionSource: SceneCaptionSource;
};

type CaptionGatewayPayload = {
  ok?: boolean;
  text?: unknown;
  caption?: unknown;
  meta?: unknown;
  sceneData?: unknown;
  source?: unknown;
  model?: unknown;
  error?: unknown;
};

type CaptionGatewayHealth = {
  reachable: boolean;
  status?: number;
  error?: string;
};

function getCaptionGatewayConfig(
  mode: SceneCaptionMode,
  env: Record<string, string | undefined> = process.env,
): CaptionGatewayConfig {
  if (mode === "smart") {
    const url = cleanUrl(env.SCENE_CAPTION_SMART_GATEWAY_URL || env.QWEN_CAPTION_GATEWAY_URL || "");
    const token = cleanString(env.SCENE_CAPTION_SMART_GATEWAY_TOKEN || env.QWEN_CAPTION_GATEWAY_TOKEN || "");
    const model = cleanString(env.SCENE_CAPTION_SMART_MODEL_ID || env.QWEN_CAPTION_MODEL_ID || DEFAULT_SMART_MODEL_ID);
    const endpoint = cleanString(env.SCENE_CAPTION_SMART_GATEWAY_ENDPOINT || env.QWEN_CAPTION_GATEWAY_ENDPOINT || "/caption/scene");

    return {
      configured: Boolean(url),
      mode,
      url,
      token,
      model,
      endpoint: normalizeEndpoint(endpoint),
      captionSource: "qwen3-vl-server",
    };
  }

  const url = cleanUrl(env.SCENE_CAPTION_FAST_GATEWAY_URL || env.LFM_CAPTION_GATEWAY_URL || env.SCENE_CAPTION_GATEWAY_URL || env.VISION_CAPTION_GATEWAY_URL || "");
  const token = cleanString(env.SCENE_CAPTION_FAST_GATEWAY_TOKEN || env.LFM_CAPTION_GATEWAY_TOKEN || env.SCENE_CAPTION_GATEWAY_TOKEN || env.VISION_CAPTION_GATEWAY_TOKEN || "");
  const model = cleanString(env.SCENE_CAPTION_FAST_MODEL_ID || env.LFM_CAPTION_MODEL_ID || env.SCENE_CAPTION_MODEL_ID || DEFAULT_FAST_MODEL_ID);
  const endpoint = cleanString(env.SCENE_CAPTION_FAST_GATEWAY_ENDPOINT || env.LFM_CAPTION_GATEWAY_ENDPOINT || env.SCENE_CAPTION_GATEWAY_ENDPOINT || "/caption/scene");

  return {
    configured: Boolean(url),
    mode,
    url,
    token,
    model,
    endpoint: normalizeEndpoint(endpoint),
    captionSource: "lfm-server",
  };
}

export async function GET() {
  const fastServer = getCaptionGatewayConfig("fast");
  const smart = getCaptionGatewayConfig("smart");
  const [fastHealth, smartHealth] = await Promise.all([
    checkCaptionGatewayHealth(fastServer),
    checkCaptionGatewayHealth(smart),
  ]);

  return Response.json({
    provider: "scene-caption-gateway",
    configured: smart.configured && smartHealth.reachable,
    reachable: smartHealth.reachable,
    defaultMode: "smart",
    providers: {
      fast: {
        configured: true,
        model: DEFAULT_FAST_MODEL_ID,
        captionSource: "lfm-webgpu" satisfies SceneCaptionSource,
        runtime: "browser-webgpu",
        serverGateway: {
          configured: fastServer.configured,
          reachable: fastHealth.reachable,
          status: fastHealth.status,
          error: fastHealth.error,
          model: fastServer.model,
          captionSource: fastServer.captionSource,
        },
      },
      smart: {
        configured: smart.configured,
        reachable: smartHealth.reachable,
        status: smartHealth.status,
        error: smartHealth.error,
        model: smart.model,
        captionSource: smart.captionSource,
      },
    },
    model: smart.model,
    captionSource: smart.captionSource,
  });
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const mode = readCaptionMode(formData.get("mode"));
    const config = getCaptionGatewayConfig(mode);
    if (!config.configured) {
      return Response.json({
        ok: false,
        configured: false,
        mode,
        error: mode === "smart"
          ? "Smart Qwen3-VL scene caption gateway is not configured; set SCENE_CAPTION_SMART_GATEWAY_URL or QWEN_CAPTION_GATEWAY_URL."
          : "Fast server scene caption gateway is not configured; set SCENE_CAPTION_FAST_GATEWAY_URL, LFM_CAPTION_GATEWAY_URL, or SCENE_CAPTION_GATEWAY_URL.",
      }, { status: 503 });
    }

    const image = formData.get("image");
    if (!(image instanceof File)) {
      return Response.json({ ok: false, error: "image file is required" }, { status: 400 });
    }

    const upstreamForm = new FormData();
    upstreamForm.set("image", image, image.name || "scene-frame.jpg");
    upstreamForm.set("prompt", stringOrDefault(formData.get("prompt"), LFM_SCENE_CAPTION_PROMPT));
    upstreamForm.set("model", stringOrDefault(formData.get("model"), config.model));
    upstreamForm.set("mode", mode);
    copyString(formData, upstreamForm, "sceneId");
    copyString(formData, upstreamForm, "sourceName");
    copyString(formData, upstreamForm, "sampleTime");
    copyString(formData, upstreamForm, "sceneStart");
    copyString(formData, upstreamForm, "sceneEnd");
    copyString(formData, upstreamForm, "sceneDuration");
    copyString(formData, upstreamForm, "captionContext");

    const headers: Record<string, string> = {};
    if (config.token) headers.Authorization = `Bearer ${config.token}`;

    const upstream = await fetch(`${config.url}${config.endpoint}`, {
      method: "POST",
      headers,
      body: upstreamForm,
    });
    const text = await upstream.text();
    const payload = parseGatewayText(text) as CaptionGatewayPayload;

    if (!upstream.ok || payload.ok === false) {
      const looksLikeHtml = /^\s*<(!doctype|html)/i.test(text);
      return Response.json({
        ok: false,
        configured: true,
        error: readString(payload.error)
          || (looksLikeHtml
            ? `Caption gateway returned an HTML error page (${upstream.status}); likely a proxy timeout while the GPU queue was busy — retry.`
            : text.slice(0, 300) || `${upstream.status} ${upstream.statusText}`),
      }, { status: upstream.ok ? 502 : upstream.status });
    }

    const caption = normalizeGatewayCaption(payload, text);
    if (!caption.text) {
      return Response.json({ ok: false, configured: true, error: "Caption gateway returned no caption text." }, { status: 502 });
    }

    return Response.json({
      ok: true,
      configured: true,
      mode,
      text: caption.text,
      meta: caption.meta,
      captionSource: config.captionSource,
      model: readString(payload.model) || config.model,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Server scene captioning failed.";
    return Response.json({ ok: false, configured: false, error: message }, { status: 502 });
  }
}

function readCaptionMode(value: FormDataEntryValue | null): SceneCaptionMode {
  return value === "smart" ? "smart" : "fast";
}

async function checkCaptionGatewayHealth(config: CaptionGatewayConfig): Promise<CaptionGatewayHealth> {
  if (!config.configured) return { reachable: false };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {};
    if (config.token) headers.Authorization = `Bearer ${config.token}`;
    const response = await fetch(`${config.url}/health`, {
      cache: "no-store",
      headers,
      signal: controller.signal,
    });
    return {
      reachable: response.ok,
      status: response.status,
      error: response.ok ? undefined : `${response.status} ${response.statusText}`,
    };
  } catch (error) {
    return { reachable: false, error: error instanceof Error ? error.message : "Caption gateway health check failed." };
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeGatewayCaption(payload: CaptionGatewayPayload, rawText: string) {
  const directText = readString(payload.text) || readString(payload.caption);
  const directMeta = isRecord(payload.meta) ? payload.meta : isRecord(payload.sceneData) ? payload.sceneData : undefined;
  if (directText) {
    const parsed = parseSceneCaptionResponse(directText);
    return {
      text: parsed.text || directText,
      meta: directMeta || parsed.meta,
    };
  }
  return parseSceneCaptionResponse(rawText);
}

function parseGatewayText(text: string): unknown {
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { text };
  }
}

function stringOrDefault(value: FormDataEntryValue | null, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function copyString(from: FormData, to: FormData, key: string) {
  const value = from.get(key);
  if (typeof value === "string" && value.trim()) to.set(key, value.trim());
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function cleanString(value: string | undefined) {
  return value?.trim() ?? "";
}

function cleanUrl(value: string | undefined) {
  return cleanString(value).replace(/\/+$/, "");
}

function normalizeEndpoint(value: string) {
  return value.startsWith("/") ? value : `/${value}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
