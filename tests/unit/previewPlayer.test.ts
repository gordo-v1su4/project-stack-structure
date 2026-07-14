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

class FakeVideoElement {
  currentTime = 0;
  duration = 30;
  readyState = 4;
  paused = true;
  preload = "";
  playsInline = false;
  muted = false;
  crossOrigin: string | null = null;
  src = "";
  currentSrc = "";
  style: Record<string, string> = {};
  private listeners = new Map<string, Set<(event?: unknown) => void>>();

  addEventListener(type: string, listener: (event?: unknown) => void) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: (event?: unknown) => void) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener();
  }

  play() {
    this.paused = false;
    return Promise.resolve();
  }

  pause() {
    this.paused = true;
  }

  load() {}

  removeAttribute(name: string) {
    if (name === "src") this.src = "";
  }
}

async function flushAsync(rounds = 6) {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("BrowserPreviewPlayer double buffering", () => {
  test("stages the next cut on the standby element and swaps at the boundary without reloading the visible one", async () => {
    const originalRaf = globalThis.requestAnimationFrame;
    const originalCancelRaf = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = (() => 0) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = (() => undefined) as typeof cancelAnimationFrame;
    (globalThis as Record<string, unknown>).HTMLMediaElement ??= { HAVE_METADATA: 1, HAVE_CURRENT_DATA: 2 };

    try {
      const player = new BrowserPreviewPlayer({ warmSourceLimit: 0 });
      const front = new FakeVideoElement();
      const back = new FakeVideoElement();
      player.attach(front as unknown as HTMLVideoElement, back as unknown as HTMLVideoElement);
      expect(front.crossOrigin).toBe("anonymous");
      expect(back.crossOrigin).toBe("anonymous");
      player.load([
        { videoUrl: "blob:a", startTime: 0, endTime: 1, label: "SEG_01" },
        { videoUrl: "blob:b", startTime: 0, endTime: 1, label: "SEG_02" },
      ]);

      const playDone = player.play();
      await flushAsync();

      // Segment 1 plays on the front element; segment 2 is staged hidden.
      expect(front.src).toBe("blob:a");
      expect(front.paused).toBe(false);
      expect(front.style.opacity).toBe("1");
      expect(back.src).toBe("blob:b");
      expect(back.style.opacity).toBe("0");
      expect(player.getState().currentIndex).toBe(0);

      // Reach the end of segment 1: the player must swap, not reload front.
      front.currentTime = 1;
      front.dispatch("timeupdate");
      await flushAsync();

      expect(player.getState().currentIndex).toBe(1);
      expect(back.style.opacity).toBe("1");
      expect(back.paused).toBe(false);
      expect(front.style.opacity).toBe("0");
      expect(front.paused).toBe(true);
      // The old front element still holds its source — no src churn on swap.
      expect(front.src).toBe("blob:a");

      // Finish segment 2 → ended.
      back.currentTime = 1;
      back.dispatch("timeupdate");
      await flushAsync();
      await playDone;

      expect(player.getState().status).toBe("ended");
    } finally {
      globalThis.requestAnimationFrame = originalRaf;
      globalThis.cancelAnimationFrame = originalCancelRaf;
    }
  });
});
