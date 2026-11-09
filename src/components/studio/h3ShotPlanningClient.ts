import { generationScopeSha256 } from "./generationScope";
import { H3_SHOT_PLANNING_LIMITS, parseH3ShotPlanningResult, type H3ShotPlanningInput, type H3ShotPlanningResult } from "./h3ShotPlanning";

type ClientOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  pollIntervalMs?: number;
  fetch?: typeof fetch;
  /** Durable attempt receipts. Reload resumes observation; only a new explicit call retries a proven failure. */
  storage?: Pick<Storage, "getItem" | "setItem">;
  /** Recheck the mounted project's snapshot before every request and return. */
  isCurrent?: () => boolean;
};
const endpoint = "/api/generate/h3/shot-planning";
type PlanningReceipt = { attempt: number; runId?: string; previousRunId?: string };

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid shot planning response.");
  return value as Record<string, unknown>;
}

/** A single explicit dispatch, bounded owned-run polling, then durable readback.
 * Aborting observation does not cancel or re-dispatch the acknowledged job.
 * Returned directions are proposals, not generation or creative approval.
 */
export async function requestH3ShotPlanning(input: H3ShotPlanningInput, options: ClientOptions = {}): Promise<H3ShotPlanningResult> {
  const timeoutMs = options.timeoutMs ?? 30 * 60_000;
  const intervalMs = options.pollIntervalMs ?? 1500;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60 * 60_000
    || !Number.isFinite(intervalMs) || intervalMs < 1 || intervalMs > 15_000) throw new Error("Invalid shot planning observation limits.");
  const snapshot = JSON.parse(JSON.stringify(input)) as H3ShotPlanningInput;
  const { bindingSha256, ...body } = snapshot;
  if (generationScopeSha256(body) !== bindingSha256) throw new Error("Shot planning input binding changed.");
  const transport = options.fetch ?? globalThis.fetch;
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason ?? new DOMException("Shot planning observation stopped.", "AbortError"));
  const timer = setTimeout(() => controller.abort(new DOMException("Shot planning observation timed out.", "TimeoutError")), timeoutMs);
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  const signal = controller.signal;
  const assertCurrent = () => {
    signal.throwIfAborted();
    if (options.isCurrent && !options.isCurrent()) throw new Error("The project or shot plan changed. The original run remains in its project history.");
  };
  // Race even injected/non-cooperative fetch/body readers against the same deadline.
  const bounded = <T>(work: Promise<T>): Promise<T> => new Promise((resolve, reject) => {
    const stop = () => { cleanup(); reject(signal.reason); };
    const cleanup = () => signal.removeEventListener("abort", stop);
    signal.addEventListener("abort", stop, { once: true });
    work.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    if (signal.aborted) stop();
  });
  const read = async (response: Response) => {
    if (!response.body) throw new Error("Shot planning response has no JSON body.");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const part = await bounded(reader.read());
        if (part.done) break;
        bytes += part.value.length;
        if (bytes > H3_SHOT_PLANNING_LIMITS.resultBytes + 64 * 1024) throw new Error("Shot planning response exceeds its byte bound.");
        chunks.push(part.value);
      }
      const buffer = new Uint8Array(bytes);
      let offset = 0; for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
      return record(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer)));
    } finally { void reader.cancel().catch(() => {}); }
  };
  const request = async (url: string, init: RequestInit = {}) => {
    assertCurrent();
    const response = await bounded(transport(url, { ...init, cache: "no-store", signal, credentials: "same-origin" }));
    const data = await read(response);
    assertCurrent();
    if (!response.ok || data.success === false || data.error) throw new Error(`Shot planning request failed (${response.status}). Existing footage is unchanged.`);
    return { response, data };
  };
  const parseReady = (data: Record<string, unknown>) => {
    if (data.success !== true || data.state !== "ready" || data.bindingSha256 !== bindingSha256) throw new Error("Shot planning result differs from the requested plan.");
    const result = parseH3ShotPlanningResult(data.result, snapshot);
    assertCurrent();
    return result;
  };
  try {
    const context = { projectId: snapshot.projectId, planSignature: snapshot.planSignature, bindingSha256 };
    const storage = options.storage ?? (typeof window !== "undefined" ? window.localStorage : undefined);
    const key = `h3-shot-planning-v1:${snapshot.projectId}:${bindingSha256}`;
    let saved = storage?.getItem(key);
    let receipt: PlanningReceipt = saved ? JSON.parse(saved) : { attempt: 0 };
    const validId = (value: unknown) => typeof value === "string" && /^[a-zA-Z0-9_-]{1,200}$/.test(value);
    if (!receipt || !Number.isInteger(receipt.attempt) || receipt.attempt < 0 || receipt.attempt > 2
      || (receipt.runId !== undefined && !validId(receipt.runId))
      || (receipt.attempt > 0 && !validId(receipt.previousRunId))) throw new Error("Invalid saved shot planning receipt. No generation was started.");
    // Storage is authoritative even when the worker crashed after writing it, or
    // the run record has expired. Recover it before consulting run state or limits.
    if (saved) {
      const stored = await request(`${endpoint}?${new URLSearchParams(context)}`);
      if (stored.response.status !== 200) throw new Error("Shot planning durable result is unavailable.");
      if (stored.data.state === "ready") return parseReady(stored.data);
      if (stored.data.success !== true || stored.data.state !== "missing" || stored.data.bindingSha256 !== bindingSha256) {
        throw new Error("Invalid shot planning durable result status. No generation was started.");
      }
    }
    const save = () => {
      if (!storage) return;
      if (storage.getItem(key) !== saved) throw new Error("Another shot planning observation changed this attempt. Resume the saved run.");
      saved = JSON.stringify(receipt);
      storage.setItem(key, saved);
    };
    const runState = async (runId: string) => {
      const { data: run } = await request(`/api/orchestration/runs/${encodeURIComponent(runId)}`);
      if (run.id !== runId || typeof run.status !== "string"
        || (run.taskIdentifier !== undefined && run.taskIdentifier !== "qwen-h3-shot-planning")
        || ["isCompleted", "isSuccess", "isFailed", "isCancelled"].some(key => typeof run[key] !== "boolean")
        || (run.isSuccess && (!run.isCompleted || run.isFailed || run.isCancelled))) throw new Error("Invalid owned shot planning run status.");
      return run;
    };
    // This boundary is an explicit user invocation, never an automatic poll retry.
    // A pending run is observed without POST; an uncertain ACK replays the same idempotent attempt.
    let resumedRun: string | undefined = receipt.runId;
    if (resumedRun) {
      const previous = await runState(resumedRun);
      if ((previous.isCompleted || previous.isCancelled) && !previous.isSuccess && (previous.isFailed || previous.isCancelled)) {
        if (receipt.attempt >= 2) throw new Error("Shot planning reached its three-attempt limit. Existing footage is unchanged.");
        receipt = { attempt: receipt.attempt + 1, previousRunId: resumedRun };
        resumedRun = undefined;
      }
    }
    save(); // Persist before dispatch, including when its acknowledgment might be lost.
    const initial = resumedRun ? { response: { status: 202 }, data: { success: true, state: "queued", bindingSha256, runId: resumedRun } }
      : await request(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...context,
        ...(receipt.attempt > 0 ? { attempt: receipt.attempt, previousRunId: receipt.previousRunId } : {}) }) });
    if (initial.response.status === 200) return parseReady(initial.data);
    if (initial.response.status !== 202 || initial.data.success !== true || initial.data.state !== "queued"
      || initial.data.bindingSha256 !== bindingSha256 || typeof initial.data.runId !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(initial.data.runId)) {
      throw new Error("Shot planning dispatch returned an invalid acknowledgment. It was not retried.");
    }
    const runId = initial.data.runId;
    receipt = { ...receipt, runId }; save();
    while (true) {
      const run = await runState(runId);
      if (run.isFailed || run.isCancelled || (run.isCompleted && !run.isSuccess)) throw new Error("Shot planning run did not succeed. Existing footage is unchanged.");
      if (run.isCompleted && run.isSuccess) break;
      if (run.isSuccess) throw new Error("Shot planning run status is inconsistent.");
      await bounded(new Promise<void>(resolve => {
        const handle = setTimeout(() => { signal.removeEventListener("abort", stop); resolve(); }, intervalMs);
        const stop = () => { clearTimeout(handle); signal.removeEventListener("abort", stop); resolve(); };
        signal.addEventListener("abort", stop, { once: true });
        if (signal.aborted) stop();
      }));
    }
    const query = new URLSearchParams(context);
    const result = await request(`${endpoint}?${query}`);
    if (result.response.status !== 200) throw new Error("Shot planning durable result is unavailable.");
    return parseReady(result.data);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}
