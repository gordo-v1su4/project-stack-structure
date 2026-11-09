import { generationScopeSha256 } from "./generationScope";
import { H3_SHOT_PLANNING_LIMITS, parseH3ShotPlanningResult, type H3ShotPlanningInput, type H3ShotPlanningResult } from "./h3ShotPlanning";

type ClientOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  pollIntervalMs?: number;
  fetch?: typeof fetch;
  /** Recheck the mounted project's snapshot before every request and return. */
  isCurrent?: () => boolean;
};
const endpoint = "/api/generate/h3/shot-planning";

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
    const initial = await request(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(context) });
    if (initial.response.status === 200) return parseReady(initial.data);
    if (initial.response.status !== 202 || initial.data.success !== true || initial.data.state !== "queued"
      || initial.data.bindingSha256 !== bindingSha256 || typeof initial.data.runId !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(initial.data.runId)) {
      throw new Error("Shot planning dispatch returned an invalid acknowledgment. It was not retried.");
    }
    const runId = initial.data.runId;
    while (true) {
      const { data: run } = await request(`/api/orchestration/runs/${encodeURIComponent(runId)}`);
      if (run.id !== runId || typeof run.status !== "string"
        || (run.taskIdentifier !== undefined && run.taskIdentifier !== "qwen-h3-shot-planning")
        || ["isCompleted", "isSuccess", "isFailed", "isCancelled"].some(key => typeof run[key] !== "boolean")) throw new Error("Invalid owned shot planning run status.");
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
