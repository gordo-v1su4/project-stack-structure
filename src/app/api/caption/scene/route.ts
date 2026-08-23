import { createHash } from "node:crypto";

import { LFM_SCENE_CAPTION_PROMPT } from "@/review/lib/analysis/scene-caption-format";
import type { SceneCaptionMode, SceneCaptionSource } from "@/components/studio/types";
import { uploadFileToMediaGateway } from "@/lib/mediaGateway";
import { getSessionUser, unauthorizedResponse } from "@/lib/session";
import { triggerSmartSceneCaption } from "@/lib/triggerOrchestration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_SMART_MODEL_ID = "Qwen/Qwen3-VL-4B-Instruct-GGUF:Q4_K_M";
const DEFAULT_FAST_MODEL_ID = "LiquidAI/LFM2.5-VL-450M-ONNX";
const HEALTH_TIMEOUT_MS = 2_500;
const MAX_CAPTION_IMAGE_BYTES = 25 * 1024 * 1024;

type CaptionGatewayConfig = {
  configured: boolean;
  mode: SceneCaptionMode;
  url: string;
  token: string;
  model: string;
  endpoint: string;
  captionSource: SceneCaptionSource;
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
  const user = await getSessionUser();
  if (!user) return unauthorizedResponse("Sign in with GitHub to run server captions.");
  try {
    const formData = await request.formData();
    const mode = readCaptionMode(formData.get("mode"));
    const config = getCaptionGatewayConfig(mode);
    if (mode !== "smart") {
      return Response.json({
        ok: false,
        configured: false,
        mode,
        error: "Fast captions run in browser WebGPU. Server-orchestrated captions use smart Qwen mode.",
      }, { status: 400 });
    }
    if (!config.configured) {
      return Response.json({
        ok: false,
        configured: false,
        mode,
        error: "Smart Qwen3-VL scene caption gateway is not configured; set SCENE_CAPTION_SMART_GATEWAY_URL.",
      }, { status: 503 });
    }

    const image = formData.get("image");
    if (!(image instanceof File)) {
      return Response.json({ ok: false, error: "image file is required" }, { status: 400 });
    }
    if (image.size > MAX_CAPTION_IMAGE_BYTES) {
      return Response.json({ ok: false, error: "Caption image exceeds the maximum allowed size." }, { status: 413 });
    }
    const bytes = await image.arrayBuffer();
    const imageDigest = createHash("sha256").update(new Uint8Array(bytes)).digest("hex");
    const uploaded = await uploadFileToMediaGateway({
      file: image,
      folder: "media-uploads/caption-frames",
    });
    const handle = await triggerSmartSceneCaption({
      bucket: uploaded.bucket,
      objectKey: uploaded.objectKey,
      fileName: image.name || "scene-frame.jpg",
      prompt: stringOrDefault(formData.get("prompt"), LFM_SCENE_CAPTION_PROMPT),
      model: stringOrDefault(formData.get("model"), config.model),
      sceneId: readFormString(formData, "sceneId"),
      sourceName: readFormString(formData, "sourceName"),
      sampleTime: readFormString(formData, "sampleTime"),
      sceneStart: readFormString(formData, "sceneStart"),
      sceneEnd: readFormString(formData, "sceneEnd"),
      sceneDuration: readFormString(formData, "sceneDuration"),
      captionContext: readFormString(formData, "captionContext"),
    }, imageDigest);
    return Response.json({
      ok: true,
      configured: true,
      mode,
      queued: true,
      orchestration: "trigger.dev",
      runId: handle.id,
      captionSource: config.captionSource,
      model: config.model,
    }, { status: 202 });
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

function stringOrDefault(value: FormDataEntryValue | null, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function readFormString(form: FormData, key: string) {
  const value = form.get(key);
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
