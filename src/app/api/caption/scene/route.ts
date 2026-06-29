import { LFM_SCENE_CAPTION_PROMPT, parseSceneCaptionResponse } from "@/review/lib/analysis/scene-caption-format";
import type { SceneCaptionMode, SceneCaptionSource } from "@/components/studio/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_SMART_MODEL_ID = "Qwen/Qwen3-VL-4B-Instruct-GGUF:Q4_K_M";

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

function getCaptionGatewayConfig(env: Record<string, string | undefined> = process.env) {
  const url = (
    env.SCENE_CAPTION_SMART_GATEWAY_URL ||
    env.QWEN_CAPTION_GATEWAY_URL ||
    env.SCENE_CAPTION_GATEWAY_URL ||
    env.VISION_CAPTION_GATEWAY_URL ||
    ""
  ).trim().replace(/\/+$/, "");
  const token = (
    env.SCENE_CAPTION_SMART_GATEWAY_TOKEN ||
    env.QWEN_CAPTION_GATEWAY_TOKEN ||
    env.SCENE_CAPTION_GATEWAY_TOKEN ||
    env.VISION_CAPTION_GATEWAY_TOKEN ||
    ""
  ).trim();
  const model = (
    env.SCENE_CAPTION_SMART_MODEL_ID ||
    env.QWEN_CAPTION_MODEL_ID ||
    env.SCENE_CAPTION_MODEL_ID ||
    DEFAULT_SMART_MODEL_ID
  ).trim();
  const endpoint = (
    env.SCENE_CAPTION_SMART_GATEWAY_ENDPOINT ||
    env.SCENE_CAPTION_GATEWAY_ENDPOINT ||
    "/caption/scene"
  ).trim();

  return {
    configured: Boolean(url),
    mode: "smart" as const,
    url,
    token,
    model,
    endpoint: endpoint.startsWith("/") ? endpoint : `/${endpoint}`,
    captionSource: "qwen3-vl-server" satisfies SceneCaptionSource,
  };
}

export async function GET() {
  const smart = getCaptionGatewayConfig();
  return Response.json({
    provider: "scene-caption-gateway",
    configured: smart.configured,
    defaultMode: "smart",
    providers: {
      fast: {
        configured: true,
        model: "LiquidAI/LFM2.5-VL-450M-ONNX",
        captionSource: "lfm-webgpu" satisfies SceneCaptionSource,
        runtime: "browser-webgpu",
      },
      smart: {
        configured: smart.configured,
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
    if (mode !== "smart") {
      return Response.json({
        ok: false,
        configured: true,
        mode,
        error: "Fast scene captions run in the browser through LiquidAI/LFM WebGPU; the server gateway only handles smart Qwen3-VL GGUF captions.",
      }, { status: 400 });
    }

    const config = getCaptionGatewayConfig();
    if (!config.configured) {
      return Response.json({
        ok: false,
        configured: false,
        mode,
        error: "Smart Qwen3-VL scene caption gateway is not configured; captioning is blocked until SCENE_CAPTION_SMART_GATEWAY_URL or SCENE_CAPTION_GATEWAY_URL is set.",
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
      return Response.json({
        ok: false,
        configured: true,
        error: readString(payload.error) || text.slice(0, 300) || `${upstream.status} ${upstream.statusText}`,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
