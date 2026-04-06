import { describe, expect, test } from "bun:test";

import {
  cancelSectionRecompute,
  createSectionRecomputeState,
  failSectionRecompute,
  markSectionReady,
  markSectionRecomputeRunning,
  startSectionRecompute,
  swapReadySection,
  updateSectionRecomputeProgress,
} from "../../src/components/studio/sectionRecompute";

function makeJob(overrides: Partial<Parameters<typeof startSectionRecompute>[1]> = {}) {
  return {
    requestKey: "req-1",
    sectionId: "verse",
    continuityMode: "motion",
    paramsHash: "hash-1",
    startedAt: new Date(0).toISOString(),
    progress: 0,
    ...overrides,
  };
}

describe("sectionRecompute", () => {
  test("starts recompute from idle", () => {
    const state = startSectionRecompute(createSectionRecomputeState(), makeJob());

    expect(state.stage).toBe("recomputing");
    expect(state.activeRequestKey).toBe("req-1");
    expect(state.progress).toBe(0);
  });

  test("marks previous active request stale when a new one starts", () => {
    const initial = startSectionRecompute(createSectionRecomputeState(), makeJob({ requestKey: "req-1" }));
    const next = startSectionRecompute({ ...initial, currentAssetKey: "asset-prev" }, makeJob({ requestKey: "req-2", sectionId: "chorus" }));

    expect(next.stage).toBe("stale");
    expect(next.activeRequestKey).toBe("req-2");
    expect(next.staleRequestKeys).toContain("req-1");
  });

  test("updates progress only for the active request", () => {
    const running = startSectionRecompute(createSectionRecomputeState(), makeJob());
    const updated = updateSectionRecomputeProgress(running, { requestKey: "req-1", progress: 42.4 });
    const ignored = updateSectionRecomputeProgress(updated, { requestKey: "req-2", progress: 80 });

    expect(updated.progress).toBe(42);
    expect(ignored.progress).toBe(42);
  });

  test("marks a request ready and swaps only the matching asset", () => {
    const running = markSectionRecomputeRunning(startSectionRecompute(createSectionRecomputeState(), makeJob()), "req-1");
    const ready = markSectionReady(running, {
      requestKey: "req-1",
      assetKey: "asset-1",
      duration: 3.2,
      generatedAt: new Date(1).toISOString(),
    });
    const swapped = swapReadySection(ready, "req-1");

    expect(ready.stage).toBe("ready");
    expect(ready.readyAsset?.assetKey).toBe("asset-1");
    expect(swapped.stage).toBe("swapped");
    expect(swapped.currentAssetKey).toBe("asset-1");
    expect(swapped.activeRequestKey).toBeNull();
  });

  test("cancels active requests and clears ready assets", () => {
    const running = markSectionReady(
      startSectionRecompute(createSectionRecomputeState(), makeJob()),
      { requestKey: "req-1", assetKey: "asset-1", duration: 2, generatedAt: new Date(1).toISOString() },
    );
    const cancelled = cancelSectionRecompute(running, "req-1");

    expect(cancelled.stage).toBe("cancelled");
    expect(cancelled.activeRequestKey).toBeNull();
    expect(cancelled.readyAsset).toBeNull();
    expect(cancelled.lastCancelledRequestKey).toBe("req-1");
  });

  test("records failures as cancelled with an error message", () => {
    const running = startSectionRecompute(createSectionRecomputeState(), makeJob());
    const failed = failSectionRecompute(running, { requestKey: "req-1", message: "ffmpeg failed" });

    expect(failed.stage).toBe("cancelled");
    expect(failed.error).toBe("ffmpeg failed");
    expect(failed.activeRequestKey).toBeNull();
  });
});
