import { logger, task, wait } from "@trigger.dev/sdk";

import { formatSceneCaptionGatewayError, resolveSceneCaptionGatewayAuth } from "@/lib/sceneCaptionGateway";
import { vm100HeavyQueue } from "./queues";

export type StoryTreatmentPayload = {
  instructions: string;
  input: string;
  model: string;
  maxTokens?: number;
};

export type StoryTreatmentGatewayResult = {
  ok: boolean;
  model: string;
  output: Record<string, unknown>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

export const storyTreatmentTask = task({
  id: "qwen-story-treatment",
  queue: vm100HeavyQueue,
  maxDuration: 600,
  retry: {
    maxAttempts: 2,
    factor: 2,
    minTimeoutInMs: 3_000,
    maxTimeoutInMs: 20_000,
    randomize: true,
  },
  run: async (payload: StoryTreatmentPayload, { ctx }) => {
    const result = await runStoryTreatmentGateway(payload, ctx.run.id);
    logger.info("Story treatment completed", {
      triggerRunId: ctx.run.id,
      model: result.model,
    });
    return result;
  },
});

async function runStoryTreatmentGateway(payload: StoryTreatmentPayload, triggerRunId: string) {
  const { gatewayUrl, token } = resolveSceneCaptionGatewayAuth();
  const endpoint = normalizeEndpoint(process.env.STORY_TREATMENT_GATEWAY_ENDPOINT || "/story/treatments");
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  await ensureQwenBackend(gatewayUrl, token ? headers : undefined, triggerRunId);

  const response = await fetch(`${gatewayUrl}${endpoint}`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: payload.model,
      instructions: payload.instructions,
      input: payload.input,
      max_tokens: payload.maxTokens ?? 1_536,
    }),
    signal: AbortSignal.timeout(540_000),
  });
  const result = await readJson(response);
  if (!response.ok || readBoolean(result, "ok") === false) {
    throw new Error(formatSceneCaptionGatewayError(response.status, result, endpoint));
  }
  const output = result.output;
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    throw new Error("Story gateway returned no JSON output object.");
  }
  const usage = result.usage;
  return {
    ok: true,
    model: readString(result, "model") || payload.model,
    output: output as Record<string, unknown>,
    usage: usage && typeof usage === "object" && !Array.isArray(usage)
      ? usage as StoryTreatmentGatewayResult["usage"]
      : undefined,
  } satisfies StoryTreatmentGatewayResult;
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

  logger.info("Qwen backend start requested for story treatment", { triggerRunId });
  const startupTimeoutMs = 300_000;
  const startedAt = Date.now();
  while (Date.now() - startedAt < startupTimeoutMs) {
    await wait.for({ seconds: 5 });
    health = await fetchGatewayHealth(gatewayUrl, headers);
    if (readBoolean(health, "qwenBackendHealthy") === true) {
      logger.info("Qwen backend ready for story treatment", {
        triggerRunId,
        startupSeconds: Math.round((Date.now() - startedAt) / 1_000),
      });
      return;
    }
  }

  throw new Error("Qwen backend did not become ready for story treatment within 300 seconds");
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

function normalizeEndpoint(value: string) {
  return value.startsWith("/") ? value : `/${value}`;
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
