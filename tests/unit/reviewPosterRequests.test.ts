import { afterEach, expect, test } from "bun:test";
import { lookupVisibleReviewPoster, ReviewPosterRequests } from "@/components/studio/reviewPosterRequests";
import { REVIEW_VIDEO_RECIPE } from "@/components/studio/reviewVideo";
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
test("poster lookup capacity follows completed work; offscreen waiters cancel without starting", async () => {
  const requests = new ReviewPosterRequests(2, 2), started: number[] = [], gates: Array<() => void> = [];
  const controllers = Array.from({ length: 4 }, () => new AbortController());
  let active = 0, peak = 0, nextStarted!: () => void;
  const fourthStarted = new Promise<void>(resolve => { nextStarted = resolve; });
  const work = (index: number) => requests.run(async () => {
    started.push(index); active++; peak = Math.max(peak, active);
    if (index === 3) nextStarted();
    await new Promise<void>(resolve => { gates[index] = resolve; }); active--; return index;
  }, controllers[index].signal);
  const first = work(0), second = work(1), cancelled = work(2), fourth = work(3);
  const cancelledResult = cancelled.then(() => false, () => true);
  await expect(requests.run(async () => 9, new AbortController().signal)).rejects.toThrow("full");
  expect(started).toEqual([0, 1]);
  controllers[0].abort(); // An active operation retains capacity until its real promise settles.
  controllers[2].abort(); expect(await cancelledResult).toBe(true); expect(started).toEqual([0, 1]);
  gates[0](); await first; await fourthStarted;
  expect(started).toEqual([0, 1, 3]); expect(peak).toBe(2);
  gates[1](); gates[3](); expect(await Promise.all([second, fourth])).toEqual([1, 3]);
});
test("an abort between assignment and execution prevents the lookup itself", async () => {
  const controller = new AbortController(), requests = new ReviewPosterRequests(); let starts = 0;
  const result = requests.run(async () => { starts++; }, controller.signal);
  controller.abort(); await expect(result).rejects.toThrow(); expect(starts).toBe(0);
});
test("visible poster readiness is GET-only and does not touch the original or queue a worker", async () => {
  const source = { bucket: "fixture", objectKey: "media-uploads/take.mp4" };
  const prepared = { version: 1, recipe: REVIEW_VIDEO_RECIPE, source, metadata: { recipe: REVIEW_VIDEO_RECIPE, proxy: {} },
    artifacts: { proxy: "proxy.mp4", poster: "poster.webp", sprite: "sprite.jpg" } };
  const calls: Array<{ url: string; method: string; signal: AbortSignal }> = [];
  globalThis.fetch = (async (url: unknown, options?: RequestInit) => {
    calls.push({ url: String(url), method: options?.method ?? "GET", signal: options?.signal as AbortSignal });
    return Response.json({ status: "ready", prepared });
  }) as typeof fetch;
  const controller = new AbortController(), url = `/api/storage/media?${new URLSearchParams(source)}`;
  expect(await lookupVisibleReviewPoster(url, "https://studio.test", controller.signal)).toEqual(prepared);
  expect(calls).toHaveLength(1); expect(calls[0].method).toBe("GET"); expect(calls[0].url.startsWith("/api/storage/review-video?")).toBe(true);
  controller.abort(); expect(calls[0].signal.aborted).toBe(true);
  expect(await lookupVisibleReviewPoster("https://foreign.test/video.mp4", "https://studio.test", new AbortController().signal)).toBeNull();
  expect(calls).toHaveLength(1);
  globalThis.fetch = (async () => Response.json({ status: "unprepared" })) as typeof fetch;
  expect(await lookupVisibleReviewPoster(url, "https://studio.test", new AbortController().signal)).toBeNull();
  globalThis.fetch = (async () => Response.json({ status: "ready", prepared: { ...prepared, source: { ...source, bucket: "wrong" } } })) as typeof fetch;
  await expect(lookupVisibleReviewPoster(url, "https://studio.test", new AbortController().signal)).rejects.toThrow("match");
});
