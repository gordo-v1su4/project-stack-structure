import type { PreparedReviewVideo } from "@/lib/preparedReviewVideoStore";
import type { ReviewVideoMetadata } from "./reviewVideo";
import { REVIEW_VIDEO_RECIPE } from "./reviewVideo";

/** A silent browser preview yields to the real transport and to the next card. */
export class ExclusiveHoverPreview {
  private active: { owner: object; stop: () => void } | null = null;
  claim(owner: object, stop: () => void) {
    this.active?.stop();
    this.active = { owner, stop };
    return () => { if (this.active?.owner === owner) this.active = null; };
  }
  owns(owner: object) { return this.active?.owner === owner; }
}
export const hoverPreview = new ExclusiveHoverPreview();

export function reviewVideoReference(value: string, origin: string) {
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin || url.pathname !== "/api/storage/media") return null;
    const bucket = url.searchParams.get("bucket"), objectKey = url.searchParams.get("objectKey");
    if (!bucket || !objectKey || bucket.length > 128 || objectKey.length > 2048) return null;
    return { bucket, objectKey };
  } catch { return null; }
}
export function reviewArtifactUrl(prepared: PreparedReviewVideo, kind: "proxy" | "poster" | "sprite") {
  return `/api/storage/media?${new URLSearchParams({ bucket: prepared.source.bucket, objectKey: prepared.artifacts[kind] })}`;
}
export function reviewProxyWindow(metadata: ReviewVideoMetadata, start: number, end?: number) {
  if (!Number.isFinite(start) || !Number.isFinite(metadata.proxy.duration) || metadata.proxy.duration <= 0 || !Number.isFinite(metadata.proxy.sourceTimeOffset)
    || (end !== undefined && (!Number.isFinite(end) || end <= start))) return null;
  const first = Math.max(0, start - metadata.proxy.sourceTimeOffset);
  const last = Math.min(metadata.proxy.duration, end === undefined ? metadata.proxy.duration : end - metadata.proxy.sourceTimeOffset);
  return first < last ? { start: first, end: last } : null;
}

const intents = new Map<string, string>();
function intentFor(key: string) {
  const existing = intents.get(key); if (existing) return existing;
  if (intents.size >= 256) intents.delete(intents.keys().next().value!);
  const intent = crypto.randomUUID(); intents.set(key, intent); return intent;
}
function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

/** Only the focused card invokes this. Abort stops observation, never rerenders source media. */
export async function loadHoverReviewVideo(videoUrl: string, origin: string, signal: AbortSignal, onPreparing: () => void): Promise<PreparedReviewVideo | null> {
  const source = reviewVideoReference(videoUrl, origin);
  if (!source) return null;
  const endpoint = `/api/storage/review-video?${new URLSearchParams(source)}`;
  let queuedRun: string | null = null;
  async function request(submit = false) {
    const response = await fetch(submit ? "/api/storage/review-video" : endpoint, { method: submit ? "POST" : "GET", cache: "no-store",
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]), ...(submit ? { headers: { "content-type": "application/json" }, body: JSON.stringify({ ...source, intentId: intentFor(`${origin}:${endpoint}`) }) } : {}) });
    if (!response.ok) throw new Error("Lightweight preview is unavailable. Inspect the original clip instead.");
    const body = await response.json();
    if (body.status === "ready") {
      const ready = body.prepared as PreparedReviewVideo;
      if (!ready || ready.version !== 1 || ready.recipe !== REVIEW_VIDEO_RECIPE || ready.metadata?.recipe !== REVIEW_VIDEO_RECIPE
        || ready.source?.bucket !== source!.bucket || ready.source.objectKey !== source!.objectKey
        || !ready.metadata?.proxy || !ready.artifacts?.proxy || !ready.artifacts.poster || !ready.artifacts.sprite) throw new Error("Review preview does not match this source.");
      return ready;
    }
    if (!["unprepared", "queued"].includes(body.status)) throw new Error("Lightweight preview is unavailable.");
    if (body.status === "queued") {
      if (typeof body.runId !== "string" || !/^run_[\w-]{1,150}$/.test(body.runId)) throw new Error("Review preparation has no valid run.");
      queuedRun = body.runId;
    }
    return null;
  }
  async function completed() {
    signal.throwIfAborted();
    if (!queuedRun) throw new Error("Review preparation was not queued.");
    const response = await fetch(`/api/orchestration/runs/${encodeURIComponent(queuedRun)}`, { cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) });
    if (!response.ok) throw new Error("Review preparation status is unavailable.");
    const run = await response.json();
    if (run.taskIdentifier !== "prepare-review-video" || run.isFailed || run.isCancelled || (run.isCompleted && !run.isSuccess)) {
      throw new Error("Review preparation did not complete; inspect the original clip.");
    }
    return Boolean(run.isCompleted && run.isSuccess);
  }
  let ready = await request(); signal.throwIfAborted(); if (ready) return ready;
  onPreparing();
  ready = await request(true); if (ready) return ready;
  if (await completed()) {
    ready = await request(); if (ready) return ready;
    throw new Error("Prepared review media is not available in storage.");
  }
  // Observation is bounded; the durable CPU preparation may continue after leaving.
  for (let attempt = 0; attempt < 8; attempt++) {
    await wait(attempt < 2 ? 1500 : 5000, signal);
    ready = await request(); if (ready) return ready;
    if (await completed()) throw new Error("Prepared review media is not available in storage.");
  }
  return null;
}
