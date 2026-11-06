import { AbortTaskRunError, logger, metadata, task, wait } from "@trigger.dev/sdk";

import { formatSceneCaptionGatewayError, resolveSceneCaptionGatewayAuth } from "@/lib/sceneCaptionGateway";
import { vm100HeavyQueue } from "./queues";
import { assertStoryLoglineReview, safeStoryReviewFailureMessage, STORY_LOGLINE_REVIEW_REQUIRED } from "@/lib/storyLoglineReview";
import { markWorkCompleted, markWorkRunning } from "./workMetadata";
import { classifyStoryGatewayRejection, persistStoryTreatmentDiagnostic, storyDiagnosticContext, type StoryDiagnosticEvent } from "@/lib/storyTreatmentDiagnostics";

export type StoryTreatmentPayload = {
  operation?: "generate" | "revise";
  instructions: string;
  input: string;
  model: string;
  maxTokens?: number;
  reviewContext: { brief: string; constraints: string[] };
};

export type StoryTreatmentGatewayResult = {
  ok: boolean;
  loglineReview: { version: 1; status: "passed" };
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
    const diagnosticContext = storyDiagnosticContext({ runId: ctx.run.id, tags: ctx.run.tags, requestedModel: payload.model, input: payload.input, reviewContext: payload.reviewContext });
    const preserve = async (event: StoryDiagnosticEvent) => {
      const descriptor = await persistStoryTreatmentDiagnostic(diagnosticContext, event, {
        currentMetadata: () => metadata.current(),
        writeMetadata: async (key, record) => { metadata.set(key, JSON.parse(JSON.stringify(record))); await metadata.flush(); },
      });
      metadata.set(event.outcome === "authored-unreviewed" ? "storyAuthoredDiagnostic" : "storyReviewDiagnostic", descriptor);
      await metadata.flush();
    };
    markWorkRunning("preparing", "Preparing story model", { progressMode: "indeterminate" });
    const result = await runStoryTreatmentGateway(payload, ctx.run.id, preserve);
    markWorkCompleted(payload.operation === "revise" ? "Story revision ready for review" : "Story treatments ready");
    logger.info("Story treatment completed", {
      triggerRunId: ctx.run.id,
      model: result.model,
    });
    return result;
  },
});

export async function runStoryTreatmentGateway(payload: StoryTreatmentPayload, triggerRunId: string, preserve?: (event: StoryDiagnosticEvent) => Promise<void>) {
  const { gatewayUrl, token } = resolveSceneCaptionGatewayAuth();
  const endpoint = normalizeEndpoint(process.env.STORY_TREATMENT_GATEWAY_ENDPOINT || "/story/treatments");
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const preserveSafely = async (event: StoryDiagnosticEvent) => {
    try { await preserve?.(event); }
    catch {
      // Storage/telemetry failure neither replaces the original rejection nor approves anything.
      try { metadata.set("storyDiagnosticStatus", "unavailable"); } catch { /* Telemetry is best effort too. */ }
      logger.warn("Story diagnostic preservation unavailable", { triggerRunId, phase: event.phase });
    }
  };

  await logger.trace("Prepare GPU story model", () => ensureQwenBackend(gatewayUrl, token ? headers : undefined, triggerRunId));

  markWorkRunning("generating", payload.operation === "revise" ? "Reconciling selected story and moments" : "Generating three story treatments");
  const diagnosticState: { authoredOutput?: Record<string, unknown>; actualModel?: string } = {};
  let lastHttpStatus: number | undefined;
  const result = await logger.trace("Author story on GPU", async () => {
    const authored = await postStoryStage(`${endpoint}/author`, {
      operation: payload.operation ?? "generate",
      model: payload.model,
      instructions: payload.instructions,
      input: payload.input,
      max_tokens: payload.maxTokens ?? 2_800,
      review_context: payload.reviewContext,
    }, 390_000);
    if (!authored.output || typeof authored.output !== "object" || Array.isArray(authored.output)) {
      throw new Error("Story gateway returned no JSON output object.");
    }
    return authored;
  });
  const output = result.output;
  const authoredOutput = output as Record<string, unknown>;
  const actualModel = readString(result, "model") || undefined;
  Object.assign(diagnosticState, { authoredOutput, actualModel });
  await preserveSafely({ phase: "author", outcome: "authored-unreviewed", authoredOutput, actualModel, httpStatus: lastHttpStatus });
  logger.info("Story authoring finished; independent review required", { triggerRunId, model: payload.model });
  markWorkRunning("reviewing", "Checking story logline against authored facts");
  const review = await logger.trace("Review story logline on GPU", async () => {
    const reviewed = await postStoryStage(`${endpoint}/review`, {
      operation: payload.operation ?? "generate", output, review_context: payload.reviewContext,
    }, 135_000);
    try { assertStoryLoglineReview(reviewed.logline_review); }
    catch {
      await preserveSafely({ phase: "review", outcome: "rejected", authoredOutput, actualModel, httpStatus: lastHttpStatus,
        gatewayReviewMarker: "missing-or-invalid", rejection: { phase: "review", httpStatus: lastHttpStatus ?? 200, issues: [{ code: "review-approval-marker-missing" }] } });
      throw new AbortTaskRunError(STORY_LOGLINE_REVIEW_REQUIRED);
    }
    return { ...reviewed, logline_review: reviewed.logline_review };
  });
  await preserveSafely({ phase: "review", outcome: "review-passed", authoredOutput, actualModel, httpStatus: lastHttpStatus, gatewayReviewMarker: "passed" });
  logger.info("Independent story review passed", { triggerRunId, model: readString(review, "model") || payload.model });
  const usage = result.usage;
  return {
    ok: true,
    loglineReview: review.logline_review,
    model: readString(result, "model") || payload.model,
    output: output as Record<string, unknown>,
    usage: usage && typeof usage === "object" && !Array.isArray(usage)
      ? usage as StoryTreatmentGatewayResult["usage"]
      : undefined,
  } satisfies StoryTreatmentGatewayResult;

  async function postStoryStage(stageEndpoint: string, body: Record<string, unknown>, timeoutMs: number) {
    const requestOptions: RequestInit & { timeout: false } = {
      method: "POST", headers, body: JSON.stringify(body), timeout: false,
      signal: AbortSignal.timeout(timeoutMs),
    };
    const response = await fetch(`${gatewayUrl}${stageEndpoint}`, requestOptions);
    lastHttpStatus = response.status;
    const stageResult = await readJson(response);
    if (!response.ok || readBoolean(stageResult, "ok") === false) {
      const detail = readString(stageResult, "detail");
      const phase = stageEndpoint.endsWith("/review") ? "review" : "author";
      await preserveSafely({ phase, outcome: "rejected", ...diagnosticState, httpStatus: response.status, rejection: classifyStoryGatewayRejection(phase, response.status, detail) });
      if (detail?.startsWith("Story logline review failed:")) {
        const message = safeStoryReviewFailureMessage(detail);
        logger.warn("Story stage rejected", { triggerRunId, stage: stageEndpoint.endsWith("/review") ? "review" : "author", reason: message });
        // A corrected authoring request must be a new run. Do not repeat the
        // identical story automatically after a semantic review rejection.
        throw new AbortTaskRunError(message);
      }
      if (response.status === 404) {
        throw new AbortTaskRunError(STORY_LOGLINE_REVIEW_REQUIRED);
      }
      throw new Error(formatSceneCaptionGatewayError(response.status, stageResult, stageEndpoint));
    }
    return stageResult;
  }
}

async function ensureQwenBackend(
  gatewayUrl: string,
  headers: Record<string, string> | undefined,
  triggerRunId: string,
) {
  let health = await fetchGatewayHealth(gatewayUrl, headers);
  if (readBoolean(health, "qwenBackendHealthy") === true) return;

  markWorkRunning("starting", "Starting story model");
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
