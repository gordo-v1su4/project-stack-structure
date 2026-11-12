import { afterEach, expect, test } from "bun:test";
import { ExclusiveHoverPreview, loadHoverReviewVideo, reviewProxyWindow, reviewVideoReference } from "@/components/studio/reviewHoverPreview";
import { REVIEW_VIDEO_RECIPE, type ReviewVideoMetadata } from "@/components/studio/reviewVideo";

const fetchBefore = globalThis.fetch;
afterEach(() => { globalThis.fetch = fetchBefore; });
const origin = "https://studio.test", video = "/api/storage/media?bucket=studio&objectKey=media-uploads%2Fsource.mp4";
const prepared = { version: 1, recipe: REVIEW_VIDEO_RECIPE, source: { bucket: "studio", objectKey: "media-uploads/source.mp4" },
  metadata: { recipe: REVIEW_VIDEO_RECIPE, proxy: { duration: 5, sourceTimeOffset: 0.046029 } }, artifacts: { proxy: "proxy.mp4", poster: "poster.webp", sprite: "sprite.jpg" } };
test("a new focus cancels the previous hover; stale cleanup cannot release the new card", () => {
  const hover = new ExclusiveHoverPreview(), first = {}, next = {}; let stops = 0;
  const releaseFirst = hover.claim(first, () => { stops++; }); expect(hover.owns(first)).toBe(true);
  const releaseNext = hover.claim(next, () => { stops++; }); expect(stops).toBe(1);
  releaseFirst(); expect(hover.owns(next)).toBe(true); expect(hover.owns(first)).toBe(false);
  releaseNext(); expect(hover.owns(next)).toBe(false);
});
test("proxy viewing maps source timestamps and clamps unavailable edge frames without retiming", () => {
  const metadata = prepared.metadata as ReviewVideoMetadata;
  const range = reviewProxyWindow(metadata, 0, 2)!;
  expect(range.start).toBe(0); expect(range.end).toBeCloseTo(1.953971, 6);
  expect(reviewProxyWindow(metadata, 1, 2)).toEqual({ start: 0.953971, end: 1.953971 });
  expect(reviewProxyWindow(metadata, 6, 7)).toBeNull(); expect(reviewProxyWindow(metadata, 2, 1)).toBeNull();
  expect(reviewProxyWindow(metadata, NaN)).toBeNull();
});
test("only same-origin durable media references are eligible; originals never become hover URLs", async () => {
  expect(reviewVideoReference(video, origin)).toEqual({ bucket: "studio", objectKey: "media-uploads/source.mp4" });
  expect(reviewVideoReference(`${origin}${video}`, origin)).not.toBeNull();
  for (const value of ["blob:abc", "https://provider.test/video.mp4", `https://foreign.test${video}`, "/api/storage/download-url?bucket=studio&objectKey=file"]) {
    expect(reviewVideoReference(value, origin)).toBeNull();
    expect(await loadHoverReviewVideo(value, origin, new AbortController().signal, () => {})).toBeNull();
  }
});
test("ready hover performs only a readiness GET and rejects a mismatched stored result", async () => {
  const methods: string[] = [];
  globalThis.fetch = (async (_url: unknown, options?: RequestInit) => { methods.push(options!.method!); return Response.json({ status: "ready", prepared }); }) as typeof fetch;
  expect(await loadHoverReviewVideo(video, origin, new AbortController().signal, () => { throw new Error("Already ready"); })).toEqual(prepared);
  expect(methods).toEqual(["GET"]);
  globalThis.fetch = (async () => Response.json({ status: "ready", prepared: { ...prepared, source: { ...prepared.source, objectKey: "foreign" } } })) as typeof fetch;
  await expect(loadHoverReviewVideo(video, origin, new AbortController().signal, () => {})).rejects.toThrow("match");
});
test("missing derivatives queue CPU preparation with one reusable intent and preserve abort signals", async () => {
  const intents: string[] = [], signals: AbortSignal[] = []; let preparing = 0;
  globalThis.fetch = (async (_url: unknown, options?: RequestInit) => {
    signals.push(options!.signal as AbortSignal);
    if (options!.method === "GET") return Response.json({ status: "unprepared" });
    intents.push(JSON.parse(options!.body as string).intentId); return Response.json({ status: "ready", prepared });
  }) as typeof fetch;
  const controller = new AbortController();
  await loadHoverReviewVideo(video, origin, controller.signal, () => { preparing++; });
  await loadHoverReviewVideo(video, origin, controller.signal, () => { preparing++; });
  expect(preparing).toBe(2); expect(intents).toHaveLength(2); expect(intents[0]).toBe(intents[1]);
  controller.abort(); expect(signals.every(signal => signal.aborted)).toBe(true);
});
test("leaving before readiness returns prevents a new preparation submission", async () => {
  const controller = new AbortController(); let calls = 0;
  globalThis.fetch = (async () => { calls++; controller.abort(); return Response.json({ status: "unprepared" }); }) as typeof fetch;
  await expect(loadHoverReviewVideo(video, origin, controller.signal, () => { throw new Error("Must not queue"); })).rejects.toThrow();
  expect(calls).toBe(1);
});
test("a terminal preparation failure is reported immediately rather than left looking queued", async () => {
  const paths: string[] = [];
  globalThis.fetch = (async (url: unknown, options?: RequestInit) => {
    paths.push(String(url));
    if (String(url).includes("/api/orchestration/")) return Response.json({ taskIdentifier: "prepare-review-video", isCompleted: true, isFailed: true, isSuccess: false });
    return Response.json(options?.method === "POST" ? { status: "queued", runId: "run_fixture" } : { status: "unprepared" });
  }) as typeof fetch;
  await expect(loadHoverReviewVideo(video, origin, new AbortController().signal, () => {})).rejects.toThrow("did not complete");
  expect(paths).toHaveLength(3); expect(paths[2]).toBe("/api/orchestration/runs/run_fixture");
});
