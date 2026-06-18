import { describe, expect, test } from "bun:test";

import {
  BrowserPreviewPlayer,
  createPreviewPlayerState,
  getWarmSegmentTargets,
  type PreviewSegment,
} from "@/components/studio/previewPlayer";

describe("createPreviewPlayerState", () => {
  test("returns idle state with zeroed fields", () => {
    const state = createPreviewPlayerState();
    expect(state.status).toBe("idle");
    expect(state.currentIndex).toBe(0);
    expect(state.segmentCount).toBe(0);
    expect(state.currentTime).toBe(0);
    expect(state.totalDuration).toBe(0);
    expect(state.errorMessage).toBeNull();
    expect(state.engineMode).toBe("html-video");
    expect(state.warmedSourceCount).toBe(0);
  });
});

describe("getWarmSegmentTargets", () => {
  test("deduplicates upcoming sources and applies preroll for decoder warmup", () => {
    const segments: PreviewSegment[] = [
      { videoUrl: "blob:a", startTime: 3, endTime: 4, label: "A1" },
      { videoUrl: "blob:a", startTime: 5, endTime: 6, label: "A2" },
      { videoUrl: "blob:b", startTime: 0.02, endTime: 1, label: "B1" },
      { videoUrl: "blob:c", startTime: 9, endTime: 10, label: "C1" },
    ];

    expect(getWarmSegmentTargets({
      segments,
      startIndex: 0,
      aheadSegments: 3,
      limit: 2,
      prerollSeconds: 0.1,
    })).toEqual([
      { videoUrl: "blob:a", warmTime: 2.9 },
      { videoUrl: "blob:b", warmTime: 0 },
    ]);
  });
});

describe("BrowserPreviewPlayer", () => {
  test("loads valid segments and computes total duration", () => {
    const player = new BrowserPreviewPlayer();
    const segments: PreviewSegment[] = [
      { videoUrl: "blob:a", startTime: 0, endTime: 2, label: "SEG_01" },
      { videoUrl: "blob:b", startTime: 0, endTime: 3, label: "SEG_02" },
    ];
    player.load(segments);
    const state = player.getState();
    expect(state.segmentCount).toBe(2);
    expect(state.totalDuration).toBe(5);
    expect(state.status).toBe("idle");
  });

  test("filters out segments with invalid time ranges", () => {
    const player = new BrowserPreviewPlayer();
    const segments: PreviewSegment[] = [
      { videoUrl: "blob:a", startTime: 2, endTime: 1, label: "BAD" },
      { videoUrl: "blob:b", startTime: 0, endTime: 1, label: "GOOD" },
      { videoUrl: "", startTime: 0, endTime: 1, label: "EMPTY_URL" },
    ];
    player.load(segments);
    const state = player.getState();
    expect(state.segmentCount).toBe(1);
  });

  test("sets error when no valid segments are provided", () => {
    const player = new BrowserPreviewPlayer();
    player.load([]);
    const state = player.getState();
    expect(state.errorMessage).not.toBeNull();
  });

  test("stop resets state to idle", () => {
    const player = new BrowserPreviewPlayer();
    const segments: PreviewSegment[] = [
      { videoUrl: "blob:a", startTime: 0, endTime: 2, label: "SEG_01" },
    ];
    player.load(segments);
    player.stop();
    const state = player.getState();
    expect(state.status).toBe("idle");
    expect(state.currentIndex).toBe(0);
  });

  test("subscribe receives state updates", () => {
    const player = new BrowserPreviewPlayer();
    const states: ReturnType<typeof player.getState>[] = [];
    const unsubscribe = player.subscribe((state) => {
      states.push(state);
    });

    const segments: PreviewSegment[] = [
      { videoUrl: "blob:a", startTime: 0, endTime: 2, label: "SEG_01" },
    ];
    player.load(segments);
    expect(states.length).toBeGreaterThanOrEqual(1);
    const loadedState = states.find((s) => s.segmentCount === 1);
    expect(loadedState).not.toBeNull();
    expect(loadedState!.segmentCount).toBe(1);

    unsubscribe();
  });

  test("getSegments returns loaded segments", () => {
    const player = new BrowserPreviewPlayer();
    const segments: PreviewSegment[] = [
      { videoUrl: "blob:a", startTime: 0, endTime: 2, label: "SEG_01" },
      { videoUrl: "blob:b", startTime: 0, endTime: 3, label: "SEG_02" },
    ];
    player.load(segments);
    expect(player.getSegments()).toEqual(segments);
  });

  test("getCurrentSegment returns null when no segments loaded", () => {
    const player = new BrowserPreviewPlayer();
    expect(player.getCurrentSegment()).toBeNull();
  });

  test("getCurrentSegment returns first segment after load", () => {
    const player = new BrowserPreviewPlayer();
    const segments: PreviewSegment[] = [
      { videoUrl: "blob:a", startTime: 0, endTime: 2, label: "SEG_01" },
    ];
    player.load(segments);
    expect(player.getCurrentSegment()?.label).toBe("SEG_01");
  });
});
