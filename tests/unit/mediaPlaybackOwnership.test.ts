import { describe, expect, test } from "bun:test";
import { MediaPlaybackOwnership, registerMediaPlaybackGroup } from "@/components/studio/mediaPlaybackOwnership";

function media() {
  return Object.assign(new EventTarget(), { pauses: 0, pause() { this.pauses++; } });
}

describe("media playback ownership", () => {
  test("master audio and both preview buffers share one owner; native clip interrupts the transport", () => {
    const ownership = new MediaPlaybackOwnership();
    const main = media(), standby = media(), audio = media(), clip = media();
    const all = [main, standby, audio, clip] as unknown as HTMLMediaElement[];
    let transportPauses = 0;
    const release = ownership.register({}, [main, standby, audio], () => { transportPauses++; });
    expect(ownership.claim(main, all)).toBe(true);
    expect(ownership.claim(audio, all)).toBe(false);
    expect(ownership.claim(standby, all)).toBe(false);
    expect([main.pauses, standby.pauses, audio.pauses]).toEqual([0, 0, 0]);
    expect(transportPauses).toBe(0);
    expect(clip.pauses).toBe(3);
    expect(ownership.claim(clip, all)).toBe(true);
    expect(transportPauses).toBe(1);
    expect([main.pauses, standby.pauses, audio.pauses]).toEqual([1, 1, 1]);
    release();
    ownership.pauseAll(all);
    expect(transportPauses).toBe(1);
  });

  test("a remote ownership claim pauses all local groups and unregistered native players", () => {
    const ownership = new MediaPlaybackOwnership();
    const local = media(), native = media();
    let pauses = 0;
    ownership.register({}, [local], () => { pauses++; });
    const all = [local, native] as unknown as HTMLMediaElement[];
    ownership.claim(local, all);
    ownership.pauseAll(all);
    expect(pauses).toBe(1);
    expect(local.pauses).toBe(1);
    expect(native.pauses).toBe(2);
    expect(ownership.claim(local, all)).toBe(true);
  });

  test("document capture and cross-tab messages coordinate ownership and release their listeners", () => {
    class FakeMedia extends EventTarget {
      paused = false;
      pause() { this.paused = true; }
    }
    class FakeChannel extends EventTarget {
      static current: FakeChannel;
      messages: unknown[] = [];
      closed = false;
      constructor() { super(); FakeChannel.current = this; }
      postMessage(message: unknown) { this.messages.push(message); }
      close() { this.closed = true; }
    }
    let listener: ((event: Event) => void) | null = null;
    const main = new FakeMedia(), audio = new FakeMedia(), clip = new FakeMedia();
    const globals = ["document", "HTMLMediaElement", "BroadcastChannel"] as const;
    const originals = globals.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
    const fakeDocument = {
      querySelectorAll: () => [main, audio, clip],
      addEventListener: (_: string, callback: (event: Event) => void) => { listener = callback; },
      removeEventListener: () => { listener = null; },
    };
    const values = [fakeDocument, FakeMedia, FakeChannel];
    globals.forEach((name, index) => Object.defineProperty(globalThis, name, { configurable: true, value: values[index] }));
    let release: (() => void) | undefined;
    try {
      let pauses = 0;
      release = registerMediaPlaybackGroup({}, [main, audio] as unknown as HTMLMediaElement[], () => { pauses++; main.pause(); audio.pause(); });
      const play = (target: FakeMedia) => {
        target.paused = false;
        const event = new Event("play");
        Object.defineProperty(event, "target", { value: target });
        (listener as unknown as (event: Event) => void)(event);
      };
      play(main);
      play(audio);
      expect(FakeChannel.current.messages).toEqual(["claim"]);
      expect(pauses).toBe(0);
      play(clip);
      expect(main.paused && audio.paused).toBe(true);
      expect(pauses).toBe(1);
      FakeChannel.current.dispatchEvent(new MessageEvent("message", { data: "claim" }));
      expect(clip.paused).toBe(true);
      expect(pauses).toBe(2);
      release(); release = undefined;
      expect(listener).toBeNull();
      expect(FakeChannel.current.closed).toBe(true);
    } finally {
      release?.();
      globals.forEach((name, index) => {
        const descriptor = originals[index];
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      });
    }
  });
});
