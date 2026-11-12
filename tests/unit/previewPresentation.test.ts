import { describe, expect, test } from "bun:test";
import { PreviewPresentation } from "@/components/studio/previewPresentation";

class Decoder {
  videoWidth = 1344; videoHeight = 768; currentTime = 0; seeking = false;
  callbacks = new Map<number, VideoFrameRequestCallback>(); next = 0;
  requestVideoFrameCallback(callback: VideoFrameRequestCallback) { const id = ++this.next; this.callbacks.set(id, callback); return id; }
  cancelVideoFrameCallback(id: number) { this.callbacks.delete(id); }
  frame(time: number) {
    this.currentTime = time;
    for (const [id, callback] of [...this.callbacks]) {
      if (this.callbacks.delete(id)) callback(0, { mediaTime: time } as VideoFrameCallbackMetadata);
    }
  }
  get video() { return this as unknown as HTMLVideoElement; }
}

async function fixture(run: (f: {
  presenter: PreviewPresentation; front: Decoder; back: Decoder; visible: number[];
  select(video: Decoder, index: number, token?: number): void;
  due(time: number): void;
  snapshots: Array<{ time: number; width: number; height: number; closed: boolean }>;
}) => Promise<void>) {
  const original = globalThis.OffscreenCanvas;
  const snapshots: Array<{ time: number; width: number; height: number; closed: boolean }> = [];
  class Raster {
    time = 0;
    constructor(public width: number, public height: number) {}
    getContext() { return { drawImage: (video: Decoder) => { this.time = video.currentTime; } }; }
    transferToImageBitmap() {
      const image = { time: this.time, width: this.width, height: this.height, closed: false, close() { this.closed = true; } };
      snapshots.push(image); return image;
    }
  }
  globalThis.OffscreenCanvas = Raster as unknown as typeof OffscreenCanvas;
  const front = new Decoder(), back = new Decoder(), visible: number[] = [];
  let active = front, index = 0, token = 1, dueTime = Infinity;
  const canvas = { width: 1, height: 1, getContext: () => ({
    drawImage: (image: { time: number; closed: boolean }) => { if (image.closed) throw Error("closed image drawn"); visible.push(image.time); },
    clearRect: () => {},
  }) } as unknown as HTMLCanvasElement;
  const presenter = new PreviewPresentation((video, candidate, owner, time) => video === active.video && candidate === index && owner === token && time <= dueTime,
    error => { throw error; });
  expect(presenter.attach(canvas)).toBe(true);
  try { await run({ presenter, front, back, visible, snapshots, due: time => { dueTime = time; }, select: (video, next, owner = token) => { active = video; index = next; token = owner; } }); }
  finally { presenter.clear(); globalThis.OffscreenCanvas = original; }
  expect(snapshots.every(image => image.closed)).toBe(true);
  expect(front.callbacks.size + back.callbacks.size).toBe(0);
}

describe("bounded preview presentation", () => {
  test("source zero accepts the first positive video PTS without admitting a later interior seek", async () => {
    await fixture(async ({ presenter, front, visible }) => {
      presenter.observe(front.video, 0, 1, 1, new AbortController().signal, true, 0);
      const ready = presenter.ready(front.video); front.frame(.046029); await ready;
      expect(visible).toEqual([.046029]);
      presenter.observe(front.video, 0, 1, 1, new AbortController().signal, true, .5);
      front.frame(.6); expect(visible).toEqual([.046029]);
      front.frame(.5); await presenter.ready(front.video);
      expect(visible.at(-1)).toBe(.5);
    });
  });
  test("a future decoded snapshot waits for the musical presentation clock", async () => {
    await fixture(async ({ presenter, front, visible, due }) => {
      due(0); presenter.observe(front.video, 0, 1, 1, new AbortController().signal, true);
      const ready = presenter.ready(front.video); front.frame(0); await ready;
      front.frame(.1); expect(visible).toEqual([0]);
      due(.1); presenter.present(front.video); expect(visible).toEqual([0, .1]);
    });
  });
  test("a requested frame arriving before seeked is retained and committed only after the seek settles", async () => {
    await fixture(async ({ presenter, front, visible }) => {
      front.seeking = true;
      presenter.observe(front.video, 0, 1, 1, new AbortController().signal, true, .5);
      front.frame(.5); expect(visible).toEqual([]);
      front.seeking = false; await presenter.ready(front.video);
      expect(visible).toEqual([.5]);
    });
  });
  test("the first one-frame cut never exposes its exclusive endpoint without knowing a nominal frame rate", async () => {
    await fixture(async ({ presenter, front, visible }) => {
      presenter.observe(front.video, 0, 1 / 24, 1, new AbortController().signal, true);
      const ready = presenter.ready(front.video); front.frame(0); await ready;
      front.frame(1 / 24); front.frame(2 / 24);
      expect(visible).toEqual([0]); expect(presenter.frame?.mediaTime).toBe(0);
      expect(front.currentTime).toBe(2 / 24); // Decoder/audio transport was not paused or rewound.
    });
  });

  test("VFR filtering holds the last included raster and never derives the endpoint from currentTime or a guessed cadence", async () => {
    await fixture(async ({ presenter, front, visible, snapshots }) => {
      presenter.observe(front.video, 0, .15, 1, new AbortController().signal, true);
      const ready = presenter.ready(front.video); front.frame(0); await ready;
      for (const time of [.01, .03, .2, .4]) front.frame(time);
      expect(visible).toEqual([0, .01, .03]); expect(presenter.frame?.mediaTime).toBe(.03);
      expect(snapshots.filter(image => !image.closed)).toHaveLength(1);
    });
  });

  test("a rounded browser PTS at a fractional-frame endpoint remains exclusive", async () => {
    await fixture(async ({ presenter, front, visible }) => {
      presenter.observe(front.video, 0, 68 / 24, 1, new AbortController().signal, true);
      const ready = presenter.ready(front.video); front.frame(67 / 24); await ready;
      front.frame(2.833333);
      expect(visible).toEqual([67 / 24]);
    });
  });

  test("current and standby retain only their last included snapshot, including while a decoder runs past the endpoint", async () => {
    await fixture(async ({ presenter, front, back, visible, snapshots, select }) => {
      const signal = new AbortController().signal;
      presenter.observe(front.video, 0, .2, 1, signal, true); const a = presenter.ready(front.video); front.frame(0); await a;
      presenter.observe(back.video, 1, .2, 1, signal, true); const b = presenter.ready(back.video); back.frame(.1); await b;
      back.frame(.2); expect(visible).toEqual([0]);
      select(back, 1); presenter.present(back.video);
      expect(visible).toEqual([0, .1]); expect(presenter.frame).toEqual({ index: 1, mediaTime: .1, token: 1 });
      expect(snapshots.filter(image => !image.closed)).toHaveLength(2);
    });
  });

  test("aborted and replaced seek callbacks cannot overwrite the latest frame, and large sources obey the raster pixel budget", async () => {
    await fixture(async ({ presenter, front, visible, snapshots, select }) => {
      const old = new AbortController(); presenter.observe(front.video, 0, 1, 1, old.signal, true);
      const stale = [...front.callbacks.values()][0]!; old.abort();
      select(front, 0, 2); front.videoWidth = 8000; front.videoHeight = 4000;
      presenter.observe(front.video, 0, 1, 2, new AbortController().signal, true);
      const ready = presenter.ready(front.video); front.frame(.5); await ready;
      stale(0, { mediaTime: .1 } as VideoFrameCallbackMetadata);
      expect(visible).toEqual([.5]); expect(presenter.frame?.token).toBe(2);
      expect(snapshots[0]!.width * snapshots[0]!.height).toBeLessThanOrEqual(3840 * 2160);
    });
  });
});
