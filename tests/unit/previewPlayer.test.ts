import { describe, expect, test } from "bun:test";

import {
  BrowserPreviewPlayer,
  createPreviewPlayerState,
  getMasterAudioTimeForPosition,
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

describe("getMasterAudioTimeForPosition", () => {
  test("maps source-clip time onto the segment's music window", () => {
    const segments: PreviewSegment[] = [
      { videoUrl: "blob:a", startTime: 10, endTime: 14, label: "SEG_01", musicStart: 30, musicEnd: 34 },
    ];

    expect(getMasterAudioTimeForPosition(segments, 0, 10)).toBe(30);
    expect(getMasterAudioTimeForPosition(segments, 0, 11.5)).toBe(31.5);
    expect(getMasterAudioTimeForPosition(segments, 0, 14)).toBe(34);
  });

  test("clamps video time before the cut start to the music window start", () => {
    const segments: PreviewSegment[] = [
      { videoUrl: "blob:a", startTime: 10, endTime: 14, label: "SEG_01", musicStart: 30 },
    ];

    expect(getMasterAudioTimeForPosition(segments, 0, 8)).toBe(30);
  });

  test("advances across prior cuts using their music windows", () => {
    const segments: PreviewSegment[] = [
      { videoUrl: "blob:a", startTime: 0, endTime: 4, label: "SEG_01", musicStart: 8, musicEnd: 12 },
      { videoUrl: "blob:b", startTime: 5, endTime: 9, label: "SEG_02", musicStart: 20, musicEnd: 24 },
    ];

    expect(getMasterAudioTimeForPosition(segments, 1, 5)).toBe(20);
    expect(getMasterAudioTimeForPosition(segments, 1, 6.5)).toBe(21.5);
  });

  test("falls back to elapsed preview time when music times are missing", () => {
    const segments: PreviewSegment[] = [
      { videoUrl: "blob:a", startTime: 0, endTime: 4, label: "SEG_01" },
      { videoUrl: "blob:b", startTime: 0, endTime: 5, label: "SEG_02" },
    ];

    expect(getMasterAudioTimeForPosition(segments, 1, 2)).toBe(6);
  });

  test("fallback is offset by the first segment's musicStart when only it has one", () => {
    const segments: PreviewSegment[] = [
      { videoUrl: "blob:a", startTime: 0, endTime: 4, label: "SEG_01", musicStart: 8 },
      { videoUrl: "blob:b", startTime: 0, endTime: 5, label: "SEG_02" },
    ];

    expect(getMasterAudioTimeForPosition(segments, 1, 2)).toBe(14);
  });

  test("returns 0 for an out-of-range index", () => {
    expect(getMasterAudioTimeForPosition([], 0, 5)).toBe(0);
    expect(getMasterAudioTimeForPosition([{ videoUrl: "blob:a", startTime: 0, endTime: 1, label: "SEG_01" }], 3, 5)).toBe(0);
  });
});

class FakeAudioElement {
  currentTime = 0;
  paused = true;

  play() {
    this.paused = false;
    return Promise.resolve();
  }

  pause() {
    this.paused = true;
  }
}

describe("BrowserPreviewPlayer master audio", () => {
  test("attachAudioElement pauses the previously attached element", () => {
    const player = new BrowserPreviewPlayer();
    const first = new FakeAudioElement();
    const second = new FakeAudioElement();

    player.attachAudioElement(first as unknown as HTMLAudioElement);
    first.play();
    expect(first.paused).toBe(false);

    player.attachAudioElement(second as unknown as HTMLAudioElement);
    expect(first.paused).toBe(true);
  });

  test("stop and detach pause the attached master audio", () => {
    const player = new BrowserPreviewPlayer();
    const audio = new FakeAudioElement();
    player.attachAudioElement(audio as unknown as HTMLAudioElement);
    player.load([{ videoUrl: "blob:a", startTime: 0, endTime: 2, label: "SEG_01" }]);

    audio.play();
    player.stop();
    expect(audio.paused).toBe(true);

    audio.play();
    player.detach();
    expect(audio.paused).toBe(true);
  });

  test("resume failure surfaces a playback error instead of a phantom playing state", async () => {
    const player = new BrowserPreviewPlayer({ warmSourceLimit: 0 });
    const video = new FakeVideoElement();
    video.play = () => Promise.reject(new Error("undecodable source"));
    player.attach(video as unknown as HTMLVideoElement);
    player.load([{ videoUrl: "blob:a", startTime: 0, endTime: 2, label: "SEG_01" }]);

    player.resume();
    await flushAsync();

    const state = player.getState();
    expect(state.status).toBe("error");
    expect(state.errorMessage).toContain("resume");
  });

  test("stale resume rejection does not corrupt state after stop", async () => {
    const player = new BrowserPreviewPlayer({ warmSourceLimit: 0 });
    const video = new FakeVideoElement();
    let rejectPlay: (reason: Error) => void = () => {};
    video.play = () => new Promise((_resolve, reject) => { rejectPlay = reject; });
    player.attach(video as unknown as HTMLVideoElement);
    player.load([{ videoUrl: "blob:a", startTime: 0, endTime: 2, label: "SEG_01" }]);

    player.resume();
    player.stop();
    rejectPlay(new Error("undecodable source"));
    await flushAsync();

    expect(player.getState().status).toBe("idle");
    expect(player.getState().errorMessage).toBeNull();
  });

  test("pause during a pending resume keeps the preview paused", async () => {
    const originalRaf = globalThis.requestAnimationFrame;
    const originalCancelRaf = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = (() => 0) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = (() => undefined) as typeof cancelAnimationFrame;
    (globalThis as Record<string, unknown>).HTMLMediaElement ??= { HAVE_METADATA: 1, HAVE_CURRENT_DATA: 2 };

    try {
      const player = new BrowserPreviewPlayer({ warmSourceLimit: 0 });
      const video = new FakeVideoElement();
      player.attach(video as unknown as HTMLVideoElement);
      player.load([{ videoUrl: "blob:a", startTime: 0, endTime: 2, label: "SEG_01" }]);

      player.play();
      await flushAsync();
      expect(player.getState().status).toBe("playing");

      player.pause();
      expect(player.getState().status).toBe("paused");

      let resolvePlay: () => void = () => {};
      video.play = () => new Promise<void>((resolve) => { resolvePlay = resolve; });
      player.resume();
      player.pause();
      resolvePlay();
      await flushAsync();

      expect(player.getState().status).toBe("paused");
      expect(player.getState().errorMessage).toBeNull();
      expect(video.paused).toBe(true);
    } finally {
      globalThis.requestAnimationFrame = originalRaf;
      globalThis.cancelAnimationFrame = originalCancelRaf;
    }
  });
});

describe("BrowserPreviewPlayer double buffering", () => {
  test("stages the next cut on the standby element and swaps at the boundary without reloading the visible one", async () => {    const originalRaf = globalThis.requestAnimationFrame;
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

  test("pause during a pending standby swap leaves the current cut visible", async () => {
    const originalRaf = globalThis.requestAnimationFrame;
    const originalCancelRaf = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = (() => 0) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = (() => undefined) as typeof cancelAnimationFrame;
    (globalThis as Record<string, unknown>).HTMLMediaElement ??= { HAVE_METADATA: 1, HAVE_CURRENT_DATA: 2 };

    try {
      const player = new BrowserPreviewPlayer({ warmSourceLimit: 0 });
      const front = new FakeVideoElement();
      const back = new FakeVideoElement();
      let resolveBackPlay: () => void = () => {};
      back.play = () => new Promise<void>((resolve) => { resolveBackPlay = resolve; });
      player.attach(front as unknown as HTMLVideoElement, back as unknown as HTMLVideoElement);
      player.load([
        { videoUrl: "blob:a", startTime: 0, endTime: 1, label: "SEG_01" },
        { videoUrl: "blob:b", startTime: 0, endTime: 1, label: "SEG_02" },
      ]);

      const playDone = player.play();
      await flushAsync();
      expect(front.paused).toBe(false);
      expect(back.style.opacity).toBe("0");

      // Segment 1 ends → standby.play() is invoked but left pending.
      front.currentTime = 1;
      front.dispatch("timeupdate");
      await flushAsync();

      // Pause while the swap is in flight, then let the stale play resolve.
      player.pause();
      resolveBackPlay();
      await flushAsync();
      await playDone;

      expect(player.getState().status).toBe("paused");
      expect(front.style.opacity).toBe("1");
      expect(back.style.opacity).toBe("0");
      expect(back.paused).toBe(true);
    } finally {
      globalThis.requestAnimationFrame = originalRaf;
      globalThis.cancelAnimationFrame = originalCancelRaf;
    }
  });
});
