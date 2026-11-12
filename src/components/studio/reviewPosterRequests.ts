import { readReadyReviewVideo, reviewVideoReference } from "./reviewHoverPreview";

/** Visible-card readiness uses two storage lookups, with a bounded cancellable wait list. */
export class ReviewPosterRequests {
  private active = 0;
  private pending: Array<{ start: () => void }> = [];
  constructor(private readonly concurrency = 2, private readonly maxPending = 64) {}
  run<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted();
    if (this.active >= this.concurrency && this.pending.length >= this.maxPending) return Promise.reject(new Error("Review poster queue is full."));
    return new Promise<T>((resolve, reject) => {
      const cancel = () => {
        const index = this.pending.indexOf(item);
        if (index >= 0) { this.pending.splice(index, 1); reject(signal.reason); }
      };
      const item = { start: () => {
        signal.removeEventListener("abort", cancel);
        if (signal.aborted) { reject(signal.reason); return; }
        this.active++;
        void Promise.resolve().then(() => { signal.throwIfAborted(); return work(); }).then(resolve, reject).finally(() => {
          this.active--;
          while (this.active < this.concurrency && this.pending.length) this.pending.shift()!.start();
        });
      } };
      if (this.active < this.concurrency) item.start();
      else { this.pending.push(item); signal.addEventListener("abort", cancel, { once: true }); }
    });
  }
}
const requests = new ReviewPosterRequests();

/** Readiness only: no POST, worker dispatch or original-media fallback. */
export function lookupVisibleReviewPoster(videoUrl: string, origin: string, signal: AbortSignal) {
  const source = reviewVideoReference(videoUrl, origin);
  if (!source) return Promise.resolve(null);
  return requests.run(async () => {
    const response = await fetch(`/api/storage/review-video?${new URLSearchParams(source)}`, { cache: "no-store",
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) });
    if (!response.ok) throw new Error("Prepared poster is unavailable.");
    const body = await response.json();
    signal.throwIfAborted();
    if (body.status === "unprepared") return null;
    return readReadyReviewVideo(body, source);
  }, signal);
}
