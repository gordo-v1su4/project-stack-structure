import { createHash } from "node:crypto";
import { logger, task, wait } from "@trigger.dev/sdk";

import { downloadMediaGatewayFile, uploadJsonToMediaGateway } from "@/lib/mediaGateway";
import type { DurableCaptionReference } from "@/lib/captionReferences";

import { vm100HeavyQueue } from "./queues";
import { markWorkCompleted, markWorkRunning, setWorkProgress } from "./workMetadata";

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
  captionReferences?: DurableCaptionReference[];
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
    markWorkRunning("captioning", "Captioning scene", { progressMode: "indeterminate" });
    const result = await runSmartSceneCaption(payload, ctx.run.id);
    markWorkCompleted("Scene caption persisted", { completedItems: 1, totalItems: 1 });
    return result;
  },
});

export type CaptionBatchScene = Omit<SmartSceneCaptionPayload, "prompt" | "model"> & {
  sceneIndex: number;
};

export type SceneCaptionBatchPayload = {
  batchIndex: number;
  sourceContentHash: string;
  prompt: string;
  model: string;
  scenes: CaptionBatchScene[];
};

export const sceneCaptionBatchTask = task({
  id: "qwen-scene-caption-batch",
  queue: vm100HeavyQueue,
  maxDuration: 1_800,
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 3_000,
    maxTimeoutInMs: 20_000,
    randomize: true,
  },
  run: async (payload: SceneCaptionBatchPayload, { ctx }) => {
    if (!payload.scenes.length || payload.scenes.length > 6) {
      throw new Error("Qwen caption batches must contain between 1 and 6 scenes.");
    }

    markWorkRunning("captioning", "Captioning scene batch", {
      progressMode: "exact",
      completedItems: 0,
      totalItems: payload.scenes.length,
    });
    const captions = [];
    for (const [index, scene] of payload.scenes.entries()) {
      const result = await runSmartSceneCaption({
        ...scene,
        prompt: payload.prompt,
        model: payload.model,
      }, ctx.run.id);
      captions.push({ sceneIndex: scene.sceneIndex, result });
      setWorkProgress({ completedItems: index + 1 });
    }

    const batchStorage = await uploadJsonToMediaGateway({
      data: {
        schema: "stack-structure.scene-caption-batch.v2",
        generatedAt: new Date().toISOString(),
        batchIndex: payload.batchIndex,
        sourceContentHash: payload.sourceContentHash,
        captions,
      },
      fileName: durableFileName(
        `caption-batch-${payload.batchIndex}`,
        `${payload.sourceContentHash}:${payload.model}:${payload.batchIndex}`,
        "qwen-caption-batch",
      ),
      folder: "media-uploads/analysis/v2/qwen-caption-batches",
    });

    logger.info("Qwen caption batch completed", {
      triggerRunId: ctx.run.id,
      batchIndex: payload.batchIndex,
      sceneCount: captions.length,
      batchObjectKey: batchStorage.objectKey,
    });
    markWorkCompleted("Caption batch persisted", {
      completedItems: captions.length,
      totalItems: captions.length,
    });
    return {
      batchIndex: payload.batchIndex,
      sceneCount: captions.length,
      batchStorage,
    };
  },
});

async function runSmartSceneCaption(payload: SmartSceneCaptionPayload, triggerRunId: string) {
    const gatewayUrl = (process.env.SCENE_CAPTION_SMART_GATEWAY_URL
      || process.env.QWEN_CAPTION_GATEWAY_URL
      || "http://192.168.8.222:18091").replace(/\/+$/, "");
    // The temporary Windows Trigger worker reaches the local caption gateway
    // over loopback. Its gateway is intentionally unauthenticated, and this
    // explicit flag prevents a stale repo .env.local token from leaking into
    // the local request while preserving production/VM100 authentication.
    const isLoopbackGateway = /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(gatewayUrl);
    const token = (process.env.STACK_STRUCTURE_LOCAL_TRIGGER === "1" || isLoopbackGateway)
      ? ""
      : process.env.SCENE_CAPTION_SMART_GATEWAY_TOKEN
        || process.env.QWEN_CAPTION_GATEWAY_TOKEN
        || "";

    const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
    await ensureQwenBackend(gatewayUrl, headers, triggerRunId);

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
    for (const reference of (payload.captionReferences ?? []).slice(0, 3)) {
      const storedReference = await downloadMediaGatewayFile({
        bucket: reference.bucket,
        objectKey: reference.objectKey,
        fileName: reference.fileName || `${reference.name}.jpg`,
      });
      form.append(
        "referenceImages",
        new File([storedReference.bytes], storedReference.fileName, { type: storedReference.mime }),
      );
      form.append("referenceLabels", JSON.stringify({ name: reference.name, role: reference.role }));
    }

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

    const captionStorage = await uploadJsonToMediaGateway({
      data: {
        schema: "stack-structure.scene-caption-result.v1",
        generatedAt: new Date().toISOString(),
        source: {
          bucket: payload.bucket,
          objectKey: payload.objectKey,
          fileName: payload.fileName,
          sceneId: payload.sceneId,
          sourceName: payload.sourceName,
          sampleTime: payload.sampleTime,
        },
        result,
      },
      fileName: durableFileName(
        payload.fileName,
        `${payload.bucket}:${payload.objectKey}:${payload.sceneId ?? ""}:${payload.sampleTime ?? ""}`,
        "qwen-caption",
      ),
      folder: "media-uploads/analysis/v2/qwen-captions",
    });

    logger.info("Smart scene caption completed", {
      triggerRunId,
      sceneId: payload.sceneId,
      sourceName: payload.sourceName,
      captionObjectKey: captionStorage.objectKey,
    });
    return { ...result, captionStorage };
}

function safeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "scene-frame";
}

function durableFileName(label: string, identity: string, suffix: string) {
  const digest = createHash("sha256").update(identity).digest("hex").slice(0, 16);
  return `${safeFileName(label)}-${digest}.${suffix}.json`;
}

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
