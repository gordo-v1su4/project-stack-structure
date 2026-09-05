import { Buffer } from "node:buffer";

import { AbortTaskRunError, logger, task, wait } from "@trigger.dev/sdk";

import {
  buildSwarmComfyDirectUrl,
  buildSwarmTextToImagePayload,
  extractComfyOutputRefs,
  getComfyHistoryStatus,
  patchComfyWorkflow,
  resolveSwarmModel,
  type ComfyOutputRef,
  type LocalGenerationRequest,
} from "@/components/studio/localGeneration";
import { downloadMediaGatewayFile, uploadFileToMediaGateway, type MediaGatewayUploadResult } from "@/lib/mediaGateway";

import { vm100HeavyQueue } from "./queues";
import { markWorkCompleted, markWorkRunning } from "./workMetadata";

export type LocalGenerationPayload = {
  request: LocalGenerationRequest;
  outputFolder?: string;
  timeoutSeconds?: number;
};

export type LocalGeneratedAsset = {
  provider: "swarmui" | "comfyui";
  kind: "image" | "video";
  filename: string;
  mimeType: string;
  providerUrl: string;
  metadata?: unknown;
  storage: MediaGatewayUploadResult;
};

export type LocalGenerationOutput = {
  provider: "swarmui" | "comfyui";
  status: "completed";
  message: string;
  sessionId?: string;
  promptId?: string;
  assets: LocalGeneratedAsset[];
};

export const localGenerationTask = task({
  id: "local-ai-generation",
  queue: vm100HeavyQueue,
  maxDuration: 1_800,
  // Provider requests have side effects. A replay must be an explicit user
  // action with a new idempotency scope, not an automatic duplicate generation.
  retry: { maxAttempts: 1 },
  run: async (payload: LocalGenerationPayload, { ctx }): Promise<LocalGenerationOutput> => {
    validatePayload(payload);
    const provider = payload.request.provider === "comfyui" ? "comfyui" : "swarmui";
    markWorkRunning("generating", `Generating with ${provider}`, { progressMode: "provider" });
    const timeoutSeconds = Math.max(30, Math.min(payload.timeoutSeconds ?? 1_500, 1_700));

    const outputFolder = payload.outputFolder?.trim()
      || `media-uploads/generated/local/${provider}/${ctx.run.id}`;

    const result = provider === "comfyui"
      ? await runComfyGenerationThroughSwarm(payload.request, outputFolder, timeoutSeconds, ctx.run.id)
      : await runSwarmGeneration(payload.request, outputFolder, ctx.run.id);

    logger.info("Local generation completed", {
      triggerRunId: ctx.run.id,
      provider,
      assetCount: result.assets.length,
      promptId: result.promptId,
      sessionId: result.sessionId,
    });
    markWorkCompleted("Generated assets persisted", {
      completedItems: result.assets.length,
      totalItems: result.assets.length,
    });
    return result;
  },
});

async function runSwarmGeneration(
  request: LocalGenerationRequest,
  outputFolder: string,
  triggerRunId: string,
): Promise<LocalGenerationOutput> {
  const baseUrl = getConfiguredUrl("LOCAL_SWARMUI_URL", "SWARMUI_URL", "http://host.docker.internal:7861");
  const sessionResponse = await fetchWithTimeout(`${baseUrl}/API/GetNewSession`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  }, 15_000);
  const session = await readJson(sessionResponse);
  if (!sessionResponse.ok || typeof session.session_id !== "string" || !session.session_id.trim()) {
    throw providerError("SwarmUI session creation", sessionResponse, session);
  }

  const model = await resolveSwarmModel({
    baseUrl,
    sessionId: session.session_id,
    requestedModel: request.model,
  });
  logger.info("Resolved SwarmUI image model", {
    triggerRunId,
    model,
  });

  const mediaParams = await hydrateSwarmMediaParams(request);
  const generateResponse = await fetchWithTimeout(`${baseUrl}/API/GenerateText2Image`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...buildSwarmTextToImagePayload({ ...request, model }, session.session_id),
      ...mediaParams,
    }),
  }, 1_600_000);
  const generated = await readJson(generateResponse);
  if (!generateResponse.ok || generated.error) {
    throw providerError("SwarmUI generation", generateResponse, generated);
  }

  const images = Array.isArray(generated.images) ? generated.images : [];
  if (!images.length) {
    throw new Error("SwarmUI completed without returning any generated assets.");
  }

  const assets = await Promise.all(images.map(async (entry, index) => {
    const reference = typeof entry === "string"
      ? entry
      : readString(entry, "image");
    if (!reference) throw new Error(`SwarmUI asset ${index + 1} did not include an image reference.`);
    const file = await fetchProviderAsset(reference, baseUrl, `swarm-${triggerRunId}-${index + 1}`);
    const storage = await uploadFileToMediaGateway({
      file,
      folder: outputFolder,
    });
    return {
      provider: "swarmui" as const,
      kind: inferKind(file.name, file.type),
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      providerUrl: resolveProviderUrl(baseUrl, reference),
      metadata: typeof entry === "object" && entry ? entry.metadata : undefined,
      storage,
    };
  }));

  return {
    provider: "swarmui",
    status: "completed",
    message: "SwarmUI generation completed and assets were persisted to RustFS.",
    sessionId: session.session_id,
    assets,
  };
}

async function hydrateSwarmMediaParams(request: LocalGenerationRequest) {
  const [initimage, videoendimage, ...promptimages] = await Promise.all([
    request.initImage ? durableImageDataUrl(request.initImage) : undefined,
    request.videoEndImage ? durableImageDataUrl(request.videoEndImage) : undefined,
    ...(request.promptImages ?? []).map(durableImageDataUrl),
  ]);
  return {
    ...(initimage ? { initimage } : {}),
    ...(videoendimage ? { videoendimage } : {}),
    ...(promptimages.length ? { promptimages } : {}),
  };
}

async function durableImageDataUrl(reference: NonNullable<LocalGenerationRequest["initImage"]>) {
  const media = await downloadMediaGatewayFile(reference);
  if (!media.mime.startsWith("image/")) throw new AbortTaskRunError("MiniMax conditioning inputs must be durable images.");
  return `data:${media.mime};base64,${Buffer.from(media.bytes).toString("base64")}`;
}

async function runComfyGenerationThroughSwarm(
  request: LocalGenerationRequest,
  outputFolder: string,
  timeoutSeconds: number,
  triggerRunId: string,
): Promise<LocalGenerationOutput> {
  if (!request.workflow || typeof request.workflow !== "object") {
    throw new AbortTaskRunError("ComfyUI generation through SwarmUI requires a workflow payload.");
  }

  const baseUrl = getConfiguredUrl("LOCAL_SWARMUI_URL", "SWARMUI_URL", "http://host.docker.internal:7861");
  const workflow = patchComfyWorkflow(request.workflow, request, {
    filenamePrefix: `stack-structure/${triggerRunId}`,
  });
  const promptResponse = await fetchWithTimeout(buildSwarmComfyDirectUrl(baseUrl, "prompt"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: workflow,
      client_id: `stack-structure-${triggerRunId}`,
    }),
  }, 15_000);
  const prompt = await readJson(promptResponse);
  if (!promptResponse.ok || typeof prompt.prompt_id !== "string" || !prompt.prompt_id.trim()) {
    throw providerError("ComfyUI prompt submission", promptResponse, prompt);
  }

  const startedAt = Date.now();
  let refs: ComfyOutputRef[] = [];
  while (Date.now() - startedAt <= timeoutSeconds * 1_000) {
    const historyResponse = await fetchWithTimeout(
      buildSwarmComfyDirectUrl(baseUrl, `history/${encodeURIComponent(prompt.prompt_id)}`),
      undefined,
      10_000,
    );
    const history = historyResponse.ok ? await readJson(historyResponse) : {};
    const status = getComfyHistoryStatus(history, prompt.prompt_id);
    if (status === "error") {
      throw new Error(`ComfyUI workflow ${prompt.prompt_id} failed.`);
    }
    refs = extractComfyOutputRefs(history, prompt.prompt_id);
    if (status === "completed" && refs.length) break;
    await wait.for({ seconds: 3 });
  }

  if (!refs.length) {
    throw new Error(`ComfyUI workflow ${prompt.prompt_id} timed out without output assets.`);
  }

  const assets = await Promise.all(refs.map(async (ref, index) => {
    const providerUrl = buildComfyViewUrl(baseUrl, ref);
    const file = await fetchProviderAsset(providerUrl, baseUrl, `comfy-${triggerRunId}-${index + 1}`, true);
    const storage = await uploadFileToMediaGateway({ file, folder: outputFolder });
    return {
      provider: "comfyui" as const,
      kind: ref.kind,
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      providerUrl,
      metadata: ref,
      storage,
    };
  }));

  return {
    provider: "comfyui",
    status: "completed",
    message: "ComfyUI generation through SwarmUI completed and assets were persisted to RustFS.",
    promptId: prompt.prompt_id,
    assets,
  };
}

function validatePayload(payload: LocalGenerationPayload) {
  if (!payload || !payload.request || typeof payload.request !== "object") {
    throw new AbortTaskRunError("Local generation request is required.");
  }
  if (typeof payload.request.prompt !== "string" || !payload.request.prompt.trim()) {
    throw new AbortTaskRunError("Local generation prompt is required.");
  }
}

function getConfiguredUrl(primary: string, secondary: string, fallback: string) {
  return (process.env[primary] || process.env[secondary] || fallback).trim().replace(/\/+$/, "");
}

async function fetchProviderAsset(
  reference: string,
  baseUrl: string,
  fallbackName: string,
  alreadyAbsolute = false,
) {
  if (reference.startsWith("data:")) return dataUrlToFile(reference, fallbackName);
  const url = alreadyAbsolute ? reference : resolveProviderUrl(baseUrl, reference);
  // SwarmUI persists outputs asynchronously after GenerateText2Image responds,
  // so an immediate /View fetch can race the file write (observed as a 500
  // from ViewOutput). Retry with backoff before giving up.
  let lastStatus = 0;
  let lastBody = "";
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 1_500 * attempt));
    const response = await fetchWithTimeout(url, undefined, 120_000);
    if (response.ok) {
      const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream";
      const filename = filenameFromUrl(url) || `${fallbackName}${extensionFromMime(contentType)}`;
      const blob = await response.blob();
      return new File([blob], filename, { type: contentType });
    }
    lastStatus = response.status;
    lastBody = await response.text().catch(() => "");
  }
  throw new Error(`Generated asset download failed (${lastStatus}): ${lastBody.slice(0, 200)}`);
}

export function dataUrlToFile(value: string, fallbackName: string) {
  const match = value.match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/);
  if (!match) throw new Error("Generated data URL is invalid.");
  const mime = match[1] || "application/octet-stream";
  let decodedPayload = match[3];
  try {
    decodedPayload = decodeURIComponent(decodedPayload);
  } catch (error) {
    if (!(error instanceof URIError)) throw error;
  }
  const bytes = match[2]
    ? Buffer.from(decodedPayload, "base64")
    : new TextEncoder().encode(decodedPayload);
  return new File([bytes], `${fallbackName}${extensionFromMime(mime)}`, { type: mime });
}

function buildComfyViewUrl(swarmBaseUrl: string, ref: ComfyOutputRef) {
  const search = new URLSearchParams({ filename: ref.filename, type: ref.type || "output" });
  if (ref.subfolder) search.set("subfolder", ref.subfolder);
  return buildSwarmComfyDirectUrl(swarmBaseUrl, `view?${search.toString()}`);
}

function resolveProviderUrl(baseUrl: string, reference: string) {
  try {
    return new URL(reference).toString();
  } catch {
    return `${baseUrl}/${reference.replace(/^\/+/, "")}`;
  }
}

function filenameFromUrl(value: string) {
  try {
    const pathname = new URL(value).pathname;
    const name = pathname.split("/").pop();
    return name && name.includes(".") ? decodeURIComponent(name) : undefined;
  } catch {
    return undefined;
  }
}

function inferKind(filename: string, mimeType: string) {
  return mimeType.startsWith("video/") || /\.(mp4|webm|gif|mov)$/i.test(filename) ? "video" as const : "image" as const;
}

function extensionFromMime(mimeType: string) {
  if (mimeType.includes("jpeg")) return ".jpg";
  if (mimeType.includes("png")) return ".png";
  if (mimeType.includes("webp")) return ".webp";
  if (mimeType.includes("gif")) return ".gif";
  if (mimeType.includes("mp4")) return ".mp4";
  if (mimeType.includes("webm")) return ".webm";
  return ".bin";
}

function providerError(operation: string, response: Response, payload: Record<string, unknown>): Error {
  const detail = readString(payload, "error") || readString(payload, "detail") || response.statusText;
  const message = `${operation} failed (${response.status}): ${detail || "unknown provider error"}`;
  return response.status >= 400 && response.status < 500 ? new AbortTaskRunError(message) : new Error(message);
}

async function fetchWithTimeout(url: string, init: RequestInit | undefined, timeoutMs: number) {
  return fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text().catch(() => "");
  if (!text.trim()) return {};
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : { value };
  } catch {
    return { error: text.slice(0, 500) };
  }
}

function readString(value: unknown, key: string) {
  const item = value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
  return typeof item === "string" && item.trim() ? item.trim() : undefined;
}
