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
  seeking = false;
  preload = "";
  playsInline = false;
  muted = false;
  crossOrigin: string | null = null;
  private assignedSrc: string | null = null;
  readonly ownerDocument = { baseURI: "https://studio.test/editor/project" };
  get src() { return this.assignedSrc ? new URL(this.assignedSrc, this.ownerDocument.baseURI).href : ""; }
  set src(value: string) { this.assignedSrc = value; }
  getAttribute(name: string) { return name === "src" ? this.assignedSrc : null; }
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
  setAttribute(name: string, value: string) { if (name === "src") this.src = value; }
  remove() {}

  removeAttribute(name: string) {
    if (name === "src") this.assignedSrc = null;
  }
}

async function flushAsync(rounds = 6) {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

class SeekVideoElement extends FakeVideoElement {
  readonly seeks: number[] = [];
  loadCalls = 0;
  autoSeek = true;
  private clock = 0;
  constructor() {
    super();
    Object.defineProperty(this, "currentTime", { get: () => this.clock, set: (value: number) => {
      this.clock = value; this.seeking = true; this.seeks.push(value);
      if (this.autoSeek) queueMicrotask(() => this.settle(value));
    } });
  }
  settle(value = this.clock) { this.clock = value; this.seeking = false; this.dispatch("seeked"); }
  tick(value: number) { this.clock = value; this.dispatch("timeupdate"); }
  load() { this.loadCalls++; this.clock = 0; }
}

async function withSeekPlayer(run: (player: BrowserPreviewPlayer, front: SeekVideoElement, back: SeekVideoElement, audio: FakeAudioElement) => Promise<void>) {
  const previousRaf = globalThis.requestAnimationFrame, previousCancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = (() => 0) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => undefined) as typeof cancelAnimationFrame;
  (globalThis as Record<string, unknown>).HTMLMediaElement ??= { HAVE_METADATA: 1, HAVE_CURRENT_DATA: 2 };
  const player = new BrowserPreviewPlayer({ warmSourceLimit: 0 });
  const front = new SeekVideoElement(), back = new SeekVideoElement(), audio = new FakeAudioElement();
  player.attach(front as unknown as HTMLVideoElement, back as unknown as HTMLVideoElement);
  player.attachAudioElement(audio as unknown as HTMLAudioElement);
  player.load([
    { videoUrl: "blob:a", startTime: 1, endTime: 3, musicStart: 10, musicEnd: 12, label: "First" },
    { videoUrl: "blob:a", startTime: 7, endTime: 10, musicStart: 12, musicEnd: 15, label: "Second" },
    { kind: "gap", videoUrl: "", startTime: 4, endTime: 6, musicStart: 15, musicEnd: 17, label: "Gap" },
  ]);
  try { await run(player, front, back, audio); }
  finally { player.detach(); globalThis.requestAnimationFrame = previousRaf; globalThis.cancelAnimationFrame = previousCancel; }
}

describe("BrowserPreviewPlayer non-destructive timeline seeking", () => {
  test("idle and paused seeks land on exact in-cut source time without autoplay or source teardown", async () => {
    await withSeekPlayer(async (player, front, back, audio) => {
      const initialBackLoads = back.loadCalls;
      await player.seekToTime(3.25);
      expect(player.getState()).toMatchObject({ status: "paused", currentIndex: 1, currentTime: 3.25, totalDuration: 7 });
      expect(front.currentTime).toBe(8.25); expect(audio.currentTime).toBe(13.25);
      expect(front.paused).toBe(true); expect(audio.paused).toBe(true);
      const loads = front.loadCalls;
      await player.seekToSegment(0);
      expect(player.getState()).toMatchObject({ status: "paused", currentIndex: 0, currentTime: 0 });
      expect(front.currentTime).toBe(1); expect(front.loadCalls).toBe(loads); expect(back.loadCalls).toBe(initialBackLoads);
      expect(front.getAttribute("src")).toBe("blob:a");
    });
  });
  test("playing seeks resolve preparation, keep playing intent and do not await the whole cut", async () => {
    await withSeekPlayer(async (player, front, back, audio) => {
      void player.play(); await flushAsync();
      const loads = [front.loadCalls, back.loadCalls];
      await player.seekToTime(3.5);
      expect(player.getState()).toMatchObject({ status: "playing", currentIndex: 1, currentTime: 3.5 });
      expect(front.currentTime).toBe(8.5); expect(audio.currentTime).toBe(13.5);
      expect(front.paused).toBe(false); expect(audio.paused).toBe(false);
      expect([front.loadCalls, back.loadCalls]).toEqual(loads);
      player.pause(); await player.seekToTime(1.5);
      expect(player.getState().status).toBe("paused"); expect(front.currentTime).toBe(2.5);
    });
  });
  test("latest seek cancels old preparation and ignores a late seeked event at the old time", async () => {
    await withSeekPlayer(async (player, front) => {
      front.autoSeek = false;
      const first = player.seekToTime(3);
      await flushAsync();
      const latest = player.seekToTime(3.5);
      await flushAsync(); await first;
      expect(player.getState()).toMatchObject({ status: "loading", currentTime: 3.5, currentIndex: 1 });
      front.settle(8); await flushAsync();
      expect(player.getState().status).toBe("loading");
      front.settle(8.5); await latest;
      expect(player.getState()).toMatchObject({ status: "paused", currentTime: 3.5 });
      expect(front.seeks).toEqual([8, 8.5]);
    });
  });
  test("a second seek to the same pending target waits without issuing another native seek", async () => {
    await withSeekPlayer(async (player, front) => {
      front.autoSeek = false;
      const first = player.seekToTime(3); await flushAsync();
      const second = player.seekToTime(3); await flushAsync(); await first;
      expect(front.seeks).toEqual([8]); expect(player.getState().status).toBe("loading");
      front.settle(8); await second;
      expect(player.getState()).toMatchObject({ status: "paused", currentTime: 3 });
    });
  });
  test("pause during pending seek retains its exact requested position for resume", async () => {
    await withSeekPlayer(async (player, front) => {
      void player.play(); await flushAsync(); front.autoSeek = false;
      const pending = player.seekToTime(3.5); await flushAsync();
      player.pause(); await pending;
      expect(player.getState()).toMatchObject({ status: "loading", currentTime: 3.5 });
      player.resume(); await flushAsync();
      front.settle(8.5); await flushAsync();
      expect(player.getState()).toMatchObject({ status: "playing", currentTime: 3.5, currentIndex: 1 });
      expect(front.currentTime).toBe(8.5);
    });
  });
  test("pause during preparation still silently lands the target without needing resume", async () => {
    await withSeekPlayer(async (player, front, _back, audio) => {
      void player.play(); await flushAsync(); front.autoSeek = false;
      const pending = player.seekToTime(3.5); await flushAsync();
      const loads = front.loadCalls;
      player.pause(); await pending; await flushAsync();
      front.settle(8.5); await flushAsync();
      expect(player.getState()).toMatchObject({ status: "paused", currentTime: 3.5, currentIndex: 1 });
      expect(front.paused).toBe(true); expect(audio.paused).toBe(true);
      expect(front.loadCalls).toBe(loads); expect(audio.currentTime).toBe(13.5);
    });
  });
  test("stop and load cancel a pending seek without a late completion changing the new state", async () => {
    await withSeekPlayer(async (player, front) => {
      front.autoSeek = false;
      const pending = player.seekToTime(3); await flushAsync();
      player.stop(); await pending; front.settle(8);
      expect(player.getState()).toMatchObject({ status: "idle", currentIndex: 0, currentTime: 0 });
      const another = player.seekToTime(1); await flushAsync();
      player.load([{ videoUrl: "blob:new", startTime: 0, endTime: 2, label: "New" }]); await another;
      front.settle(2); expect(player.getState()).toMatchObject({ status: "idle", currentIndex: 0, totalDuration: 2 });
    });
  });
  test("a loading subscriber can stop immediately without the cancelled seek reassigning a source", async () => {
    await withSeekPlayer(async (player, front) => {
      const unsubscribe = player.subscribe(state => { if (state.status === "loading") player.stop(); });
      await player.seekToTime(3);
      expect(player.getState()).toMatchObject({ status: "idle", currentIndex: 0, currentTime: 0 });
      expect(front.getAttribute("src")).toBe(null);
      unsubscribe();
    });
  });
  test("source switches can reuse an already assigned standby decoder", async () => {
    await withSeekPlayer(async (player, front, back) => {
      player.load([{ videoUrl: "blob:a", startTime: 0, endTime: 2, label: "A" },
        { videoUrl: "/api/storage/media?key=b", startTime: 2, endTime: 4, label: "B" }]);
      back.src = "https://studio.test/api/storage/media?key=b";
      const loads = [front.loadCalls, back.loadCalls];
      await player.seekToTime(2.5);
      expect(player.getActiveVideoElement()).toBe(back as unknown as HTMLVideoElement);
      expect(back.currentTime).toBe(2.5); expect([front.loadCalls, back.loadCalls]).toEqual(loads);
      expect(player.getState()).toMatchObject({ status: "paused", currentIndex: 1, currentTime: 2.5 });
    });
  });
  test("gap seeking preserves offset and master-song time, and resume continues from that offset", async () => {
    await withSeekPlayer(async (player, front, back, audio) => {
      const loads = [front.loadCalls, back.loadCalls];
      await player.seekToTime(5.5);
      expect(player.getState()).toMatchObject({ status: "paused", currentIndex: 2, currentTime: 5.5 });
      expect(audio.currentTime).toBe(15.5); expect([front.loadCalls, back.loadCalls]).toEqual(loads);
      player.resume();
      await flushAsync();
      expect(player.getState().status).toBe("playing"); expect(audio.currentTime).toBeCloseTo(15.5, 1);
    });
  });
  test("bounds and exact end are stable despite native duration clamp, and ended scrubs stay paused", async () => {
    await withSeekPlayer(async (player, front, _back, audio) => {
      player.load([{ videoUrl: "blob:a", startTime: 0, endTime: 2, label: "A" }]); front.duration = 2;
      await player.seekToTime(99);
      expect(front.currentTime).toBe(1.999999);
      expect(player.getState()).toMatchObject({ status: "paused", currentTime: 2, totalDuration: 2 });
      player.resume(); expect(player.getState()).toMatchObject({ status: "ended", currentTime: 2 });
      expect(front.paused).toBe(true);
      await player.seekToTime(-1); expect(player.getState().currentTime).toBe(0);
      void player.play(); await flushAsync(); audio.currentTime = 2; front.tick(2); await flushAsync();
      expect(player.getState()).toMatchObject({ status: "ended", currentTime: 2 });
      await player.seekToTime(0.5); expect(player.getState()).toMatchObject({ status: "paused", currentTime: 0.5 });
    });
  });
  test("exact timeline end corrects an already loaded exclusive trim endpoint without reloading", async () => {
    await withSeekPlayer(async (player, front, _back, audio) => {
      player.load([{ videoUrl: "blob:a", startTime: 3, endTime: 4, musicStart: 10, musicEnd: 11, label: "Final" }]);
      front.duration = 5;
      await player.seekToTime(0.5);
      const loads = front.loadCalls;
      front.tick(4);
      const seekCount = front.seeks.length;
      await player.seekToTime(1);
      expect(front.seeks.slice(seekCount)).toEqual([3.999999]);
      expect(front.currentTime).toBeLessThan(4);
      expect(front.loadCalls).toBe(loads);
      expect(front.paused).toBe(true);
      expect(audio.currentTime).toBe(11);
      expect(player.getState()).toMatchObject({ status: "paused", currentTime: 1, totalDuration: 1 });
      player.resume();
      expect(player.getState().status).toBe("ended");
      expect(front.paused).toBe(true);
    });
  });
  test("current metadata errors become state errors; stale metadata completion cannot revive playback", async () => {
    await withSeekPlayer(async (player, front) => {
      front.readyState = 0;
      const failed = player.seekToTime(3); await flushAsync(); front.dispatch("error"); await failed;
      expect(player.getState()).toMatchObject({ status: "error", errorMessage: "Could not load preview video metadata." });
      const stale = player.seekToTime(3); await flushAsync(); player.stop(); await stale;
      front.readyState = 4; front.dispatch("loadedmetadata");
      expect(player.getState()).toMatchObject({ status: "idle", errorMessage: null });
    });
  });
  test("warm source assignments survive paused scrubbing rather than being removed or reloaded", async () => {
    const previousDocument = globalThis.document;
    const warmVideos: SeekVideoElement[] = [];
    globalThis.document = { createElement: () => { const video = new SeekVideoElement(); warmVideos.push(video); return video; },
      body: { appendChild: () => {} } } as unknown as Document;
    const player = new BrowserPreviewPlayer({ warmSourceLimit: 2 });
    const video = new SeekVideoElement();
    try {
      player.attach(video as unknown as HTMLVideoElement);
      player.load([{ videoUrl: "blob:a", startTime: 0, endTime: 2, label: "A" },
        { videoUrl: "blob:b", startTime: 3, endTime: 5, label: "B" }]);
      const loads = warmVideos.map(item => item.loadCalls);
      expect(player.getWarmSourceUrls()).toEqual(["blob:a", "blob:b"]);
      await player.seekToTime(1); await player.seekToTime(3);
      expect(player.getWarmSourceUrls()).toEqual(["blob:a", "blob:b"]);
      expect(warmVideos.map(item => item.loadCalls)).toEqual(loads);
      expect(warmVideos.map(item => item.getAttribute("src"))).toEqual(["blob:a", "blob:b"]);
    } finally {
      player.detach();
      if (previousDocument === undefined) delete (globalThis as Record<string, unknown>).document;
      else globalThis.document = previousDocument;
    }
  });
});

describe("BrowserPreviewPlayer assigned-source reuse", () => {
  const relative = "/api/storage/media?bucket=studio&objectKey=media-uploads%2Fowner%2Fclip.mp4";
  const absolute = `https://studio.test${relative}`;
  for (const scenario of [
    { name: "relative URLs reuse the reflected absolute source", first: relative, next: relative, boundary: 1, loads: 1, seeks: [] },
    { name: "relative and absolute URLs share a buffer", first: relative, next: absolute, boundary: 1, loads: 1, seeks: [] },
    { name: "absolute and relative URLs share a buffer", first: absolute, next: relative, boundary: 1, loads: 1, seeks: [] },
    { name: "an already landed contiguous cut keeps the existing exact-seek tolerance", first: relative, next: relative, boundary: 0.995, loads: 1, seeks: [] },
    { name: "a nearby but not landed boundary still seeks precisely", first: relative, next: relative, boundary: 0.98, loads: 1, seeks: [1] },
    { name: "a different storage query loads a different resource", first: relative, next: `${relative}&version=2`, boundary: 1, loads: 2, seeks: [1] },
  ]) {
    test(scenario.name, async () => {
      const originalRaf = globalThis.requestAnimationFrame;
      const originalCancelRaf = globalThis.cancelAnimationFrame;
      globalThis.requestAnimationFrame = (() => 0) as typeof requestAnimationFrame;
      globalThis.cancelAnimationFrame = (() => undefined) as typeof cancelAnimationFrame;
      (globalThis as Record<string, unknown>).HTMLMediaElement ??= { HAVE_METADATA: 1, HAVE_CURRENT_DATA: 2 };
      const player = new BrowserPreviewPlayer({ warmSourceLimit: 0 });
      const video = new FakeVideoElement();
      let time = 0, loads = 0;
      const audio = Object.assign(new FakeAudioElement(), { readyState: 4 });
      const seeks: number[] = [];
      Object.defineProperty(video, "currentTime", { get: () => time, set: (value: number) => {
        time = value; seeks.push(value); queueMicrotask(() => video.dispatch("seeked"));
      } });
      video.load = () => { loads++; time = 0; };
      try {
        player.attach(video as unknown as HTMLVideoElement);
        player.attachAudioElement(audio as unknown as HTMLAudioElement);
        player.load([
          { videoUrl: scenario.first, startTime: 0, endTime: 1, label: "First" },
          { videoUrl: scenario.next, startTime: 1, endTime: 2, label: "Contiguous" },
        ]);
        // load() deliberately stops and clears the old assignment. Count only playback work.
        loads = 0; seeks.length = 0;
        const playing = player.play();
        await flushAsync();
        expect(video.src).toBe(absolute);
        expect(video.getAttribute("src")).toBe(scenario.first);
        expect(loads).toBe(1);
        // The song reaches the cut boundary while native decoded time can
        // still differ slightly. Only the source seek tolerance is under test.
        audio.currentTime = 1;
        time = scenario.boundary; video.dispatch("timeupdate");
        await flushAsync();
        expect(player.getState().currentIndex).toBe(1);
        expect(player.getState().status).toBe("playing");
        expect(loads).toBe(scenario.loads);
        expect(seeks).toEqual(scenario.seeks);
        audio.currentTime = 2; time = 2; video.dispatch("timeupdate");
        await playing;
        expect(player.getState().status).toBe("ended");
      } finally {
        player.stop();
        globalThis.requestAnimationFrame = originalRaf;
        globalThis.cancelAnimationFrame = originalCancelRaf;
      }
    });
  }
});

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
  readyState = 4;
  duration = 60;
  ended = false;
  private listeners = new Map<string, Set<() => void>>();
  addEventListener(type: string, callback: () => void) { const set = this.listeners.get(type) ?? new Set(); set.add(callback); this.listeners.set(type, set); }
  removeEventListener(type: string, callback: () => void) { this.listeners.get(type)?.delete(callback); }
  dispatch(type: string) { for (const callback of [...this.listeners.get(type) ?? []]) callback(); }

  play() {
    this.paused = false;
    return Promise.resolve();
  }

  pause() {
    this.paused = true;
  }
}

class ClockAudioElement extends FakeAudioElement {
  readyState = 4;
  seeking = false;
  delaySeek = false;
  readonly seeks: number[] = [];
  private clock = 0;
  constructor() {
    super();
    Object.defineProperty(this, "currentTime", { get: () => this.clock, set: (value: number) => {
      this.clock = value; this.seeks.push(value); this.seeking = this.delaySeek;
    } });
  }
  tick(time: number) { this.clock = time; }
  settleSeek() { this.seeking = false; this.dispatch("seeked"); }
}

class PresentedVideoElement extends FakeVideoElement {
  private nextFrame = 0;
  private frames = new Map<number, (now: number, metadata: { mediaTime: number }) => void>();
  playCalls = 0;
  requestVideoFrameCallback(callback: (now: number, metadata: { mediaTime: number }) => void) {
    const id = ++this.nextFrame; this.frames.set(id, callback); return id;
  }
  cancelVideoFrameCallback(id: number) { this.frames.delete(id); }
  present(time: number) {
    this.currentTime = time;
    const callbacks = [...this.frames.values()]; this.frames.clear();
    for (const callback of callbacks) callback(performance.now(), { mediaTime: time });
  }
  play() { this.playCalls++; return super.play(); }
}

describe("BrowserPreviewPlayer musical cut clock", () => {
  async function withClock(run: (player: BrowserPreviewPlayer, front: PresentedVideoElement, back: PresentedVideoElement, audio: ClockAudioElement) => Promise<void>) {
    const previousRaf = globalThis.requestAnimationFrame, previousCancel = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = (() => 0) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = (() => undefined) as typeof cancelAnimationFrame;
    (globalThis as Record<string, unknown>).HTMLMediaElement ??= { HAVE_METADATA: 1, HAVE_CURRENT_DATA: 2 };
    const player = new BrowserPreviewPlayer({ warmSourceLimit: 0 });
    const front = new PresentedVideoElement(), back = new PresentedVideoElement(), audio = new ClockAudioElement();
    player.attach(front as unknown as HTMLVideoElement, back as unknown as HTMLVideoElement);
    player.attachAudioElement(audio as unknown as HTMLAudioElement);
    try { await run(player, front, back, audio); }
    finally { player.detach(); globalThis.requestAnimationFrame = previousRaf; globalThis.cancelAnimationFrame = previousCancel; }
  }

  test("decoder endpoints cannot advance cuts or stop the master before its actual endpoint", async () => {
    await withClock(async (player, front, back, audio) => {
      player.load([
        { videoUrl: "blob:a", startTime: 0, endTime: 1, musicStart: 10, label: "First" },
        { videoUrl: "blob:b", startTime: 0, endTime: 1, musicStart: 11, label: "Second" },
      ]);
      const playing = player.play(); await flushAsync();
      expect(audio.seeks).toEqual([10]);
      audio.tick(10.9); front.currentTime = 1; front.dispatch("ended");
      await flushAsync(); expect(player.getState().currentIndex).toBe(0);
      expect(player.getState().currentTime).toBeCloseTo(.9, 8);
      audio.tick(11); await flushAsync(10);
      expect(player.getState().currentIndex).toBe(1); expect(audio.seeks).toEqual([10]);
      audio.tick(11.92); back.currentTime = 1; back.dispatch("ended");
      await flushAsync(); expect(player.getState().status).toBe("playing"); expect(audio.paused).toBe(false);
      expect(player.getState().currentTime).toBeCloseTo(1.92, 8);
      audio.tick(12); await playing;
      expect(player.getState().status).toBe("ended"); expect(audio.paused).toBe(true); expect(audio.currentTime).toBe(12);
      expect(audio.seeks).toEqual([10]);
    });
  });

  test("rejected master playback fails explicitly instead of leaving a frozen master clock playing forever", async () => {
    await withClock(async (player, front, _back, audio) => {
      audio.play = () => Promise.reject(new Error("autoplay rejected"));
      player.load([{ videoUrl: "blob:a", startTime: 0, endTime: 1, label: "Needs song" }]);
      await player.play();
      expect(player.getState().status).toBe("error"); expect(player.getState().errorMessage).toContain("master audio");
      expect(front.paused).toBe(true); expect(audio.paused).toBe(true);
    });
  });

  test("master metadata and actual playback readiness precede the playing transport", async () => {
    await withClock(async (player, front, _back, audio) => {
      audio.readyState = 0; let resolve = () => {};
      audio.play = () => { audio.paused = false; return new Promise<void>(done => { resolve = done; }); };
      player.load([{ videoUrl: "blob:a", startTime: 0, endTime: 1, label: "Needs song" }]);
      const playing = player.play(); await flushAsync();
      expect(player.getState().status).toBe("loading"); expect(front.paused).toBe(true);
      audio.readyState = 4; audio.dispatch("loadedmetadata"); await flushAsync();
      expect(player.getState().status).toBe("loading"); expect(front.paused).toBe(true);
      resolve(); await flushAsync(); expect(player.getState().status).toBe("playing");
      audio.tick(1); front.currentTime = 1; front.dispatch("ended"); await playing;
      expect(player.getState().status).toBe("ended");
    });
  });

  test("stopping a pending master start prevents a late resolution from playing video", async () => {
    await withClock(async (player, front, _back, audio) => {
      let resolve = () => {};
      audio.play = () => { audio.paused = false; return new Promise<void>(done => { resolve = done; }); };
      player.load([{ videoUrl: "blob:a", startTime: 0, endTime: 1, label: "Needs song" }]);
      const playing = player.play(); await flushAsync(); player.stop(); resolve(); await playing;
      expect(player.getState().status).toBe("idle"); expect(front.playCalls).toBe(0);
      expect(front.paused).toBe(true); expect(audio.paused).toBe(true);
    });
  });

  test("a genuinely short master fails explicitly; sub-ms natural EOF rounding completes without a seek", async () => {
    await withClock(async (player, front, _back, audio) => {
      audio.duration = .5;
      const cut = [{ videoUrl: "blob:a", startTime: 0, endTime: 1, label: "One second" }];
      player.load(cut); await player.play(); expect(player.getState().status).toBe("error");
      expect(player.getState().errorMessage).toContain("ends before");
      audio.duration = .9996; player.load(cut); const playing = player.play(); await flushAsync();
      audio.tick(.9996); audio.ended = true; audio.paused = true; front.currentTime = 1; front.dispatch("ended"); await playing;
      expect(player.getState().status).toBe("ended"); expect(audio.currentTime).toBe(.9996);
      expect(audio.seeks).toEqual([0]);
    });
  });

  test("source clip audio keeps playing for its full song dwell and transport pause/resume preserves the master position", async () => {
    await withClock(async (player, front, _back, audio) => {
      player.load([{ videoUrl: "blob:a", startTime: 0, endTime: 8 / 24, musicStart: 0, label: "Eight frames" }]);
      const playing = player.play(); await flushAsync();
      for (let frame = 0; frame < 8; frame++) front.present(frame / 24);
      expect(front.currentTime).toBe(7 / 24); expect(front.paused).toBe(false);
      expect(audio.paused).toBe(false); expect(player.getState().status).toBe("playing");
      audio.tick(.32); player.pause(); const calls = front.playCalls;
      expect(player.getState().currentTime).toBe(.32);
      player.resume(); await flushAsync();
      expect(front.playCalls).toBe(calls + 1); expect(front.paused).toBe(false); expect(audio.paused).toBe(false);
      audio.tick(8 / 24); await flushAsync(10); await playing;
      expect(player.getState().status).toBe("ended"); expect(front.currentTime).toBe(7 / 24);
      expect(audio.seeks).toEqual([0]);
    });
  });

  test("gap playback completes rounded natural EOF and fails a stopped or early-ended master", async () => {
    await withClock(async (player, _front, _back, audio) => {
      const callbacks = new Map<number, FrameRequestCallback>(); let next = 0;
      globalThis.requestAnimationFrame = callback => { callbacks.set(++next, callback); return next; };
      globalThis.cancelAnimationFrame = id => { callbacks.delete(id); };
      const tick = () => { for (const [id, callback] of [...callbacks]) { callbacks.delete(id); callback(0); } };
      const gap: PreviewSegment[] = [{ videoUrl: "", kind: "gap", startTime: 0, endTime: 1, musicStart: 0, label: "Gap" }];
      audio.duration = .9996; player.load(gap); let playing = player.play(); await flushAsync();
      audio.tick(.9996); audio.ended = true; audio.paused = true; tick(); await playing;
      expect(player.getState().status).toBe("ended"); expect(audio.seeks).toEqual([0]);
      for (const ended of [false, true]) {
        audio.duration = 60; audio.ended = false; player.load(gap); playing = player.play(); await flushAsync();
        audio.tick(.5); audio.ended = ended; audio.paused = true; tick(); await playing;
        expect(player.getState().status).toBe("error");
        expect(player.getState().errorMessage).toContain(ended ? "ended before" : "stopped before");
        expect(audio.paused).toBe(true);
      }
    });
  });

  test("intentional discontinuous song windows seek once at the section boundary", async () => {
    await withClock(async (player, front, _back, audio) => {
      player.load([
        { videoUrl: "blob:a", startTime: 0, endTime: 1, musicStart: 10, label: "First section" },
        { videoUrl: "blob:b", startTime: 0, endTime: 1, musicStart: 25, label: "Other section" },
      ]);
      void player.play(); await flushAsync();
      front.currentTime = 1; audio.tick(11); await flushAsync(10);
      expect(player.getState().currentIndex).toBe(1); expect(audio.seeks).toEqual([10, 25]);
      expect(audio.paused).toBe(false);
    });
  });

  for (const stopDuringSeek of [false, true]) {
    test(`comparison jumps hold the prepared video until audio seek completes${stopDuringSeek ? "; stop cancels the pending start" : ""}`, async () => {
      await withClock(async (player, front, back, audio) => {
        player.load([
          { videoUrl: "blob:a", startTime: 0, endTime: 1, musicStart: 10, label: "First" },
          { videoUrl: "blob:b", startTime: 0, endTime: 1, musicStart: 25, label: "Separated" },
        ]);
        void player.play(); await flushAsync();
        audio.delaySeek = true;
        front.currentTime = 1; audio.tick(11); await flushAsync(10);
        expect(audio.seeks).toEqual([10, 25]);
        expect(audio.seeking).toBe(true);
        expect(audio.paused).toBe(true);
        expect(front.paused).toBe(true);
        expect(back.paused).toBe(true);
        expect(back.playCalls).toBe(0);
        if (stopDuringSeek) player.stop();
        audio.settleSeek(); await flushAsync();
        expect(back.playCalls).toBe(stopDuringSeek ? 0 : 1);
        expect(audio.paused).toBe(stopDuringSeek);
        expect(player.getState().status).toBe(stopDuringSeek ? "idle" : "playing");
      });
    });
  }

  test("resuming a paused seek stages the next decoder before the cut and swaps without reloading the current decoder", async () => {
    await withClock(async (player, front, back, audio) => {
      for (const video of [front, back]) {
        let sourceTime = video.currentTime;
        Object.defineProperty(video, "currentTime", { get: () => sourceTime, set: (value: number) => {
          sourceTime = value; queueMicrotask(() => video.dispatch("seeked"));
        } });
      }
      player.load([
        { videoUrl: "blob:a", startTime: 0, endTime: 1, musicStart: 0, label: "Resume here" },
        { videoUrl: "blob:b", startTime: 2, endTime: 3, musicStart: 1, label: "Prepared next" },
      ]);
      await player.seekToTime(.25);
      const firstSource = front.src;
      player.resume(); await flushAsync();
      expect(player.getState()).toMatchObject({ status: "playing", currentIndex: 0, currentTime: .25 });
      expect(back.src).toBe("blob:b"); expect(back.currentTime).toBe(2); expect(back.paused).toBe(true);
      expect(front.src).toBe(firstSource); expect(audio.seeks).toEqual([.25]);
      audio.tick(1); front.currentTime = 1; await flushAsync(10);
      expect(player.getState().currentIndex).toBe(1);
      expect(player.getActiveVideoElement()).toBe(back as unknown as HTMLVideoElement);
      expect(front.src).toBe(firstSource); expect(back.playCalls).toBe(1); expect(audio.seeks).toEqual([.25]);
      audio.tick(2); back.currentTime = 3; await flushAsync(10);
      expect(player.getState().status).toBe("ended");
    });
  });
});

describe("BrowserPreviewPlayer master audio", () => {
  for (const action of ["stop", "section", "seek"]) {
    test(`reloads a cleared video despite stale currentSrc after ${action}`, async () => {
      const originalRaf = globalThis.requestAnimationFrame;
      const originalCancelRaf = globalThis.cancelAnimationFrame;
      globalThis.requestAnimationFrame = (() => 0) as typeof requestAnimationFrame;
      globalThis.cancelAnimationFrame = (() => undefined) as typeof cancelAnimationFrame;
      (globalThis as Record<string, unknown>).HTMLMediaElement ??= { HAVE_METADATA: 1, HAVE_CURRENT_DATA: 2 };
      const player = new BrowserPreviewPlayer({ warmSourceLimit: 0 });
      const video = new FakeVideoElement();
      const audio = new FakeAudioElement();
      // Chromium can retain currentSrc after removeAttribute("src") + load(),
      // while src is empty and metadata is gone. Only assigning src reloads it.
      video.load = () => {
        video.readyState = 0;
        video.currentTime = 0;
        if (!video.src) return;
        video.currentSrc = video.src;
        queueMicrotask(() => {
          video.readyState = 4;
          video.dispatch("loadedmetadata");
        });
      };
      const section = [{ videoUrl: "blob:intro", startTime: 0, endTime: 2, label: "Intro", musicStart: 0 }];
      try {
        player.attach(video as unknown as HTMLVideoElement);
        player.attachAudioElement(audio as unknown as HTMLAudioElement);
        player.load(section);
        void player.play();
        await flushAsync();
        expect(player.getState().status).toBe("playing");

        if (action === "section") player.load([{ ...section[0]!, musicStart: 14 }]);
        else player.stop();
        expect(video.src).toBe("");
        expect(video.currentSrc).toBe("blob:intro");
        expect(video.readyState).toBe(0);
        if (action === "seek") player.seekToSegment(0);
        else void player.play();
        await flushAsync();

        expect(player.getState().status).toBe(action === "seek" ? "paused" : "playing");
        expect(video.src).toBe("blob:intro");
        expect(video.paused).toBe(action === "seek");
        expect(audio.paused).toBe(action === "seek");
        expect(audio.currentTime).toBe(action === "section" ? 14 : 0);
      } finally {
        player.stop();
        globalThis.requestAnimationFrame = originalRaf;
        globalThis.cancelAnimationFrame = originalCancelRaf;
      }
    });
  }

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

  test("stale play rejection does not overwrite a newer playback chain", async () => {
    const originalRaf = globalThis.requestAnimationFrame;
    const originalCancelRaf = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = (() => 0) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = (() => undefined) as typeof cancelAnimationFrame;
    (globalThis as Record<string, unknown>).HTMLMediaElement ??= { HAVE_METADATA: 1, HAVE_CURRENT_DATA: 2 };

    try {
      const player = new BrowserPreviewPlayer({ warmSourceLimit: 0 });
      const video = new FakeVideoElement();
      let rejectFirstPlay: (reason: Error) => void = () => {};
      let playCount = 0;
      video.play = () => {
        video.paused = false;
        playCount += 1;
        if (playCount === 1) {
          return new Promise((_resolve, reject) => { rejectFirstPlay = reject; });
        }
        return Promise.resolve();
      };
      player.attach(video as unknown as HTMLVideoElement);
      player.load([{ videoUrl: "blob:a", startTime: 0, endTime: 2, label: "SEG_01" }]);

      const stalePlayDone = player.play();
      await flushAsync();
      player.stop();
      void player.play();
      await flushAsync();
      expect(player.getState().status).toBe("playing");

      rejectFirstPlay(new Error("stale undecodable source"));
      await stalePlayDone;
      await flushAsync();

      expect(player.getState().status).toBe("playing");
      expect(player.getState().errorMessage).toBeNull();
      player.stop();
    } finally {
      globalThis.requestAnimationFrame = originalRaf;
      globalThis.cancelAnimationFrame = originalCancelRaf;
    }
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
        { videoUrl: "blob:b", startTime: 0, endTime: 1, label: "SEG_02", useClipAudio: true },
      ]);

      const playDone = player.play();
      await flushAsync();

      // Segment 1 plays on the front element; segment 2 is staged hidden.
      expect(front.src).toBe("blob:a");
      expect(front.paused).toBe(false);
      expect(front.muted).toBe(true);
      expect(back.muted).toBe(true);
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
      expect(back.muted).toBe(false);
      expect(front.muted).toBe(true);
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
      expect(front.paused).toBe(true);
      expect(back.paused).toBe(true);
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

  test("stale standby cleanup does not pause a newer chain reusing the same element and URL", async () => {
    const originalRaf = globalThis.requestAnimationFrame;
    const originalCancelRaf = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = (() => 0) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = (() => undefined) as typeof cancelAnimationFrame;
    (globalThis as Record<string, unknown>).HTMLMediaElement ??= { HAVE_METADATA: 1, HAVE_CURRENT_DATA: 2 };

    try {
      const player = new BrowserPreviewPlayer({ warmSourceLimit: 0 });
      const front = new FakeVideoElement();
      const back = new FakeVideoElement();
      const resolveBackPlays: Array<() => void> = [];
      back.play = () => {
        back.paused = false;
        return new Promise<void>((resolve) => { resolveBackPlays.push(resolve); });
      };
      player.attach(front as unknown as HTMLVideoElement, back as unknown as HTMLVideoElement);
      player.load([
        { videoUrl: "blob:a", startTime: 0, endTime: 1, label: "SEG_01" },
        { videoUrl: "blob:b", startTime: 0, endTime: 1, label: "SEG_02" },
      ]);

      const stalePlayDone = player.play();
      await flushAsync();
      front.currentTime = 1;
      front.dispatch("timeupdate");
      await flushAsync();
      expect(resolveBackPlays).toHaveLength(1);

      // Start a new chain with the same segment URLs, then leave its standby
      // play pending while the invalidated chain's earlier play settles.
      front.currentTime = 0;
      player.seekToSegment(0);
      await flushAsync();
      front.currentTime = 1;
      front.dispatch("timeupdate");
      await flushAsync();
      expect(resolveBackPlays).toHaveLength(2);
      expect(back.paused).toBe(false);

      resolveBackPlays[0]?.();
      await flushAsync();
      await stalePlayDone;
      expect(back.paused).toBe(false);

      resolveBackPlays[1]?.();
      await flushAsync();
      expect(player.getState().currentIndex).toBe(1);
      expect(back.style.opacity).toBe("1");
      expect(back.paused).toBe(false);
      player.stop();
    } finally {
      globalThis.requestAnimationFrame = originalRaf;
      globalThis.cancelAnimationFrame = originalCancelRaf;
    }
  });
});
