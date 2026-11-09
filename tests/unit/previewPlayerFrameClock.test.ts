import { describe, expect, test } from "bun:test";
import { BrowserPreviewPlayer } from "@/components/studio/previewPlayer";

class FrameVideo {
  private time = 0;
  private nextFrameId = 0;
  private events = new Map<string, Set<() => void>>();
  frames = new Map<number, () => void>();
  duration = 30;
  readyState = 4;
  paused = true;
  private assignedSrc: string | null = null;
  readonly ownerDocument = { baseURI: "https://studio.test/editor/project" };
  get src() { return this.assignedSrc ? new URL(this.assignedSrc, this.ownerDocument.baseURI).href : ""; }
  set src(value: string) { this.assignedSrc = value; }
  getAttribute(name: string) { return name === "src" ? this.assignedSrc : null; }
  style: Record<string, string> = {};
  get currentTime() { return this.time; }
  set currentTime(time: number) {
    this.time = time;
    queueMicrotask(() => this.dispatch("seeked"));
  }
  advance(time: number) { this.time = time; }
  addEventListener(type: string, callback: () => void) {
    const listeners = this.events.get(type) ?? new Set();
    listeners.add(callback);
    this.events.set(type, listeners);
  }
  removeEventListener(type: string, callback: () => void) { this.events.get(type)?.delete(callback); }
  dispatch(type: string) { for (const callback of [...(this.events.get(type) ?? [])]) callback(); }
  get listenerCount() { return [...this.events.values()].reduce((sum, listeners) => sum + listeners.size, 0); }
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  load() {}
  removeAttribute(name: string) { if (name === "src") this.assignedSrc = null; }
  requestVideoFrameCallback(callback: () => void) {
    const id = ++this.nextFrameId;
    this.frames.set(id, callback);
    return id;
  }
  cancelVideoFrameCallback(id: number) { this.frames.delete(id); }
  frame() {
    for (const [id, callback] of [...this.frames]) {
      if (!this.frames.delete(id)) continue;
      callback();
    }
  }
}

class ClockAudio {
  readyState = 4;
  time = 0;
  seeks = 0;
  paused = true;
  get currentTime() { return this.time; }
  set currentTime(time: number) { this.time = time; this.seeks++; }
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
}

async function flush() {
  for (let round = 0; round < 20; round++) await Promise.resolve();
}

function fixture(count = 6) {
  (globalThis as Record<string, unknown>).HTMLMediaElement ??= { HAVE_METADATA: 1 };
  const player = new BrowserPreviewPlayer({ warmSourceLimit: 0 });
  const videos = [new FrameVideo(), new FrameVideo()] as const;
  player.attach(videos[0] as unknown as HTMLVideoElement, videos[1] as unknown as HTMLVideoElement);
  player.load(Array.from({ length: count }, (_, index) => ({
    videoUrl: `blob:cut-${index}`, startTime: 0, endTime: 1, musicStart: index, label: `Cut ${index}`,
  })));
  return { player, videos };
}

describe("BrowserPreviewPlayer native frame clock", () => {
  test("24 alternating cuts keep one progress loop and release the old buffer", async () => {
    const { player, videos } = fixture(24);
    let emissions = 0;
    player.subscribe(() => emissions++);
    const done = player.play();
    try {
      await flush();
      for (let index = 0; index < 24; index++) {
        const active = videos[index % 2]!;
        const hidden = videos[(index + 1) % 2]!;
        expect(player.getState().currentIndex).toBe(index);
        expect(active.frames.size).toBe(2); // One progress callback and one cut-end waiter.
        expect(hidden.frames.size).toBe(0);
        const before = emissions;
        active.advance(0.5);
        active.frame();
        expect(emissions - before).toBe(1);
        active.advance(1);
        active.frame();
        await flush();
      }
      await done;
      expect(player.getState().status).toBe("ended");
      expect(videos.map((video) => video.frames.size)).toEqual([0, 0]);
      player.stop();
      expect(videos.map((video) => video.listenerCount)).toEqual([0, 0]);
    } finally { player.detach(); }
  });

  test("gap to picture preserves the continuous master song and cancels the gap clock", async () => {
    const originalRaf = globalThis.requestAnimationFrame;
    const originalCancel = globalThis.cancelAnimationFrame;
    const frames = new Map<number, FrameRequestCallback>();
    let nextId = 0;
    let now = 0;
    const originalNow = Object.getOwnPropertyDescriptor(performance, "now");
    Object.defineProperty(performance, "now", { configurable: true, value: () => now });
    globalThis.requestAnimationFrame = (callback) => { frames.set(++nextId, callback); return nextId; };
    globalThis.cancelAnimationFrame = (id) => { frames.delete(id); };
    const { player, videos } = fixture();
    const audio = new ClockAudio();
    player.attachAudioElement(audio as unknown as HTMLAudioElement);
    player.load([
      { kind: "gap", videoUrl: "", startTime: 0, endTime: 1, musicStart: 10, label: "Gap" },
      { videoUrl: "blob:picture", startTime: 3, endTime: 4, musicStart: 11, label: "Picture" },
    ]);
    const done = player.play();
    try {
      await flush();
      expect(audio.currentTime).toBe(10);
      expect(audio.seeks).toBe(1);
      for (const time of [500, 1000]) {
        now = time;
        audio.time = 10 + time / 1000;
        for (const [id, callback] of [...frames]) { frames.delete(id); callback(now); }
        await flush();
      }
      expect(frames.size).toBe(1); // One master-clock progress loop; the gap loop is gone.
      expect(player.getState().currentIndex).toBe(1);
      expect(player.getState().status).toBe("playing");
      expect(videos[0].currentTime).toBe(3);
      expect(audio.paused).toBe(false);
      expect(audio.seeks).toBe(1);
      audio.time = 12;
      videos[0].advance(4);
      videos[0].frame();
      await done;
      expect(player.getState().status).toBe("ended");
      expect(audio.paused).toBe(true);
      expect(audio.seeks).toBe(1);
    } finally {
      player.detach();
      if (originalNow) Object.defineProperty(performance, "now", originalNow);
      else Reflect.deleteProperty(performance, "now");
      globalThis.requestAnimationFrame = originalRaf;
      globalThis.cancelAnimationFrame = originalCancel;
    }
  });

  for (const outcome of ["resolve", "reject"] as const) {
    test(`Stop keeps video and master silent when a pending video.play later ${outcome}s`, async () => {
      const { player, videos } = fixture(1);
      const audio = new ClockAudio();
      player.attachAudioElement(audio as unknown as HTMLAudioElement);
      let settle = () => {};
      videos[0].play = () => {
        videos[0].paused = false;
        return new Promise<void>((resolve, reject) => {
          settle = outcome === "resolve" ? resolve : () => reject(new Error("Stopped"));
        });
      };
      const done = player.play();
      await flush();
      expect(videos[0].paused).toBe(false);
      const initialSeeks = audio.seeks; // Master readiness now precedes video.play.
      player.stop();
      settle();
      await done;
      expect(player.getState().status).toBe("idle");
      expect(player.getState().errorMessage).toBeNull();
      expect(videos[0].paused).toBe(true);
      expect(audio.paused).toBe(true);
      expect(audio.seeks).toBe(initialSeeks);
      expect(videos.map((video) => video.frames.size)).toEqual([0, 0]);
      player.detach();
    });
  }

  for (const pending of ["metadata", "seek"] as const) {
    test(`pausing second-cut ${pending} discards the previous cut end before resume`, async () => {
      const { player, videos } = fixture(2);
      player.getSegments()[1]!.startTime = 3;
      player.getSegments()[1]!.endTime = 5;
      const front = videos[0];
      videos[1].readyState = 0; // Standby cannot become ready before the boundary.
      front.load = () => { if (pending === "metadata" && front.src === "blob:cut-1") front.readyState = 0; };
      const dispatch = front.dispatch.bind(front);
      front.dispatch = (type) => { if (pending !== "seek" || type !== "seeked") dispatch(type); };
      void player.play();
      try {
        await flush();
        front.advance(1);
        front.frame();
        await flush();
        expect(player.getState().currentIndex).toBe(1);
        player.pause();
        expect(videos.map((video) => video.listenerCount)).toEqual([0, 0]);
        front.dispatch = dispatch;
        player.resume();
        front.readyState = 4;
        front.dispatch("loadedmetadata");
        await flush();
        expect(front.currentTime).toBe(3);
        expect(player.getState().status).toBe("playing");
        front.advance(4);
        front.frame();
        await flush();
        expect(player.getState().status).toBe("playing");
        front.advance(5);
        front.frame();
        await flush();
        expect(player.getState().status).toBe("ended");
      } finally { player.detach(); }
    });
  }

  test("continuous master-song cuts do not seek repeatedly, but discontinuous windows still seek", async () => {
    const { player, videos } = fixture();
    const audio = new ClockAudio();
    player.getSegments()[5]!.musicStart = 20;
    player.attachAudioElement(audio as unknown as HTMLAudioElement);
    void player.play();
    try {
      await flush();
      expect(audio.seeks).toBe(1);
      for (let index = 0; index < 5; index++) {
        audio.time = index + 1 + 0.06;
        videos[index % 2]!.advance(1);
        videos[index % 2]!.frame();
        await flush();
        expect(player.getState().currentIndex).toBe(index + 1);
        expect(audio.seeks).toBe(index === 4 ? 2 : 1);
      }
      expect(audio.currentTime).toBe(20);
      expect(audio.seeks).toBe(2);
    } finally { player.detach(); }
  });

  for (const action of ["pause", "stop", "seek", "load", "detach"] as const) {
    test(`${action} releases native frame callbacks and cut-end listeners immediately`, async () => {
      const { player, videos } = fixture(1);
      const done = player.play();
      await flush();
      if (action === "seek") player.seekToSegment(0);
      else if (action === "load") player.load([]);
      else player[action]();
      expect(videos.map((video) => video.frames.size)).toEqual([0, 0]);
      expect(videos.map((video) => video.listenerCount)).toEqual([0, 0]);
      await done;
      player.detach();
    });
  }

  for (const pending of ["metadata", "seek"] as const) {
    test(`pause cancels pending ${pending} and resume still stops at the cut end`, async () => {
      const { player, videos } = fixture(1);
      const video = videos[0];
      if (pending === "metadata") video.readyState = 0;
      else video.advance(5);
      // Keep an actual seek pending instead of automatically firing seeked.
      const dispatch = video.dispatch.bind(video);
      video.dispatch = (type) => { if (type !== "seeked") dispatch(type); };
      const done = player.play();
      await flush();
      expect(player.getState().status).toBe("loading");
      player.pause();
      expect(video.listenerCount).toBe(0);
      await done;
      video.readyState = 4;
      video.dispatch = dispatch;
      player.resume();
      await flush();
      expect(player.getState().status).toBe("playing");
      video.advance(1);
      video.frame();
      await flush();
      expect(player.getState().status).toBe("ended");
      expect(video.paused).toBe(true);
      player.detach();
    });
  }
});
