export type TriggerRunStatus = {
  id: string;
  status: string;
  isCompleted: boolean;
  isSuccess: boolean;
  isFailed: boolean;
  isCancelled: boolean;
  output?: unknown;
  error?: string;
};

export async function waitForTriggerRunOutput(
  runId: string,
  options: { timeoutMs: number; pollIntervalMs?: number },
) {
  const startedAt = Date.now();
  let currentIntervalMs = options.pollIntervalMs ?? 1_500;

  while (Date.now() - startedAt <= options.timeoutMs) {
    const response = await fetch(`/api/orchestration/runs/${encodeURIComponent(runId)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(readError(payload) || `Trigger run lookup failed (${response.status})`);
    }

    const run = payload as unknown as TriggerRunStatus;
    if (run.isFailed || run.isCancelled) {
      throw new Error(run.error || `Trigger run ${runId} ended with ${run.status}.`);
    }
    if (run.isCompleted) {
      if (run.isSuccess) return run.output;
      throw new Error(run.error || `Trigger run ${runId} ended with ${run.status}.`);
    }

    await sleep(currentIntervalMs);
    currentIntervalMs = nextTriggerPollInterval(currentIntervalMs);
  }

  throw new Error(`Trigger run ${runId} timed out after ${Math.round(options.timeoutMs / 1_000)}s.`);
}

export function nextTriggerPollInterval(currentIntervalMs: number) {
  return Math.min(Math.ceil(currentIntervalMs * 1.5), 15_000);
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : { value };
  } catch {
    return { error: text.slice(0, 500) };
  }
}

function readError(payload: Record<string, unknown>) {
  const error = payload.error;
  return typeof error === "string" && error.trim() ? error.trim() : undefined;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
