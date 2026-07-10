import { logger, task, wait } from "@trigger.dev/sdk/v3";

import { downloadMediaGatewayFile } from "@/lib/mediaGateway";

import { vm100HeavyQueue } from "./queues";

export type SmartSceneCaptionPayload = {
  bucket: string;
  objectKey: string;
  fileName: string;
  prompt: string;
  model: string;
  sceneId?: string;
  sourceName?: string;
  sampleTime?: string;
  sceneStart?: string;
  sceneEnd?: string;
  sceneDuration?: string;
  captionContext?: string;
};

export const smartSceneCaptionTask = task({
  id: "qwen-smart-scene-caption",
  queue: vm100HeavyQueue,
  maxDuration: 600,
  retry: {
    maxAttempts: 2,
    factor: 2,
    minTimeoutInMs: 3_000,
    maxTimeoutInMs: 20_000,
    randomize: true,
  },
  run: async (payload: SmartSceneCaptionPayload, { ctx }) => {
    const gatewayUrl = (process.env.SCENE_CAPTION_SMART_GATEWAY_URL
      || process.env.QWEN_CAPTION_GATEWAY_URL
      || "http://192.168.8.222:18091").replace(/\/+$/, "");
    const token = process.env.SCENE_CAPTION_SMART_GATEWAY_TOKEN
      || process.env.QWEN_CAPTION_GATEWAY_TOKEN
      || "";

    const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
    await ensureQwenBackend(gatewayUrl, headers, ctx.run.id);

    const source = await downloadMediaGatewayFile({
      bucket: payload.bucket,
      objectKey: payload.objectKey,
      fileName: payload.fileName,
    });
    const form = new FormData();
    form.set("image", new File([source.bytes], source.fileName, { type: source.mime }));
    form.set("prompt", payload.prompt);
    form.set("model", payload.model);
    form.set("mode", "smart");
    copyOptional(form, payload, "sceneId");
    copyOptional(form, payload, "sourceName");
    copyOptional(form, payload, "sampleTime");
    copyOptional(form, payload, "sceneStart");
    copyOptional(form, payload, "sceneEnd");
    copyOptional(form, payload, "sceneDuration");
    copyOptional(form, payload, "captionContext");

    const response = await fetch(`${gatewayUrl}/caption/scene`, {
      method: "POST",
      headers,
      body: form,
      signal: AbortSignal.timeout(240_000),
    });
    const result = await readJson(response);
    if (!response.ok || readBoolean(result, "ok") === false) {
      throw new Error(readString(result, "error") || readString(result, "detail") || `Caption gateway failed (${response.status})`);
    }

    logger.info("Smart scene caption completed", {
      triggerRunId: ctx.run.id,
      sceneId: payload.sceneId,
      sourceName: payload.sourceName,
    });
    return result;
  },
});

async function ensureQwenBackend(
  gatewayUrl: string,
  headers: Record<string, string> | undefined,
  triggerRunId: string,
) {
  let health = await fetchGatewayHealth(gatewayUrl, headers);
  if (readBoolean(health, "qwenBackendHealthy") === true) return;

  const startResponse = await fetch(`${gatewayUrl}/admin/qwen/start`, {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(35_000),
  });
  const startPayload = await readJson(startResponse);
  if (!startResponse.ok) {
    throw new Error(
      readString(startPayload, "detail")
      || readString(startPayload, "error")
      || `Unable to start Qwen backend (${startResponse.status})`,
    );
  }

  logger.info("Qwen backend start requested", { triggerRunId });
  const startupTimeoutMs = 300_000;
  const startedAt = Date.now();
  while (Date.now() - startedAt < startupTimeoutMs) {
    await wait.for({ seconds: 5 });
    health = await fetchGatewayHealth(gatewayUrl, headers);
    if (readBoolean(health, "qwenBackendHealthy") === true) {
      logger.info("Qwen backend ready", {
        triggerRunId,
        startupSeconds: Math.round((Date.now() - startedAt) / 1_000),
      });
      return;
    }
  }

  throw new Error("Qwen caption backend did not become ready within 300 seconds");
}

async function fetchGatewayHealth(gatewayUrl: string, headers: Record<string, string> | undefined) {
  const response = await fetch(`${gatewayUrl}/health`, {
    headers,
    signal: AbortSignal.timeout(5_000),
  });
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(readString(payload, "detail") || `Caption gateway health failed (${response.status})`);
  }
  return payload;
}

function copyOptional(form: FormData, payload: SmartSceneCaptionPayload, key: keyof SmartSceneCaptionPayload) {
  const value = payload[key];
  if (typeof value === "string" && value.trim()) form.set(key, value);
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : { value: parsed };
  } catch {
    return { error: text.slice(0, 500) };
  }
}

function readBoolean(value: Record<string, unknown>, key: string) {
  return typeof value[key] === "boolean" ? value[key] as boolean : undefined;
}

function readString(value: Record<string, unknown>, key: string) {
  return typeof value[key] === "string" && value[key].trim() ? value[key].trim() : undefined;
}
