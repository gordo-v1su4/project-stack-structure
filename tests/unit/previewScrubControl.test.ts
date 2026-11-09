import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { bindPreviewScrubControl, formatPreviewScrubTime } from "@/components/studio/previewScrubControl";
import { PreviewTimelineScrubber } from "@/components/studio/PreviewTimelineScrubber";
import { BrowserPreviewPlayer, createPreviewPlayerState, type PreviewPlayerState } from "@/components/studio/previewPlayer";
import { PreviewPlayer } from "@/components/studio/PreviewPlayerComponent";

class Input extends EventTarget {
  value = "0"; max = "1"; disabled = true;
  attributes = new Map<string, string>();
  setAttribute(key: string, value: string) { this.attributes.set(key, value); }
  setPointerCapture() {}
  fire(name: string) { this.dispatchEvent(new Event(name)); }
}
function fixture() {
  let state: PreviewPlayerState = { ...createPreviewPlayerState(), totalDuration: 20, segmentCount: 4, status: "paused" };
  const listeners = new Set<(state: PreviewPlayerState) => void>();
  const seeks: number[] = [];
  const source = {
    getState: () => state,
    subscribe(listener: (state: PreviewPlayerState) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async seekToTime(time: number) { seeks.push(time); source.emit({ currentTime: time }); },
    emit(patch: Partial<PreviewPlayerState>) { state = { ...state, ...patch }; for (const listener of listeners) listener(state); },
  };
  let id = 0;
  const queued = new Map<number, FrameRequestCallback>();
  const frames = { request: (fn: FrameRequestCallback) => { queued.set(++id, fn); return id; }, cancel: (key: number) => { queued.delete(key); } };
  const tick = () => { const callbacks = [...queued.values()]; queued.clear(); for (const callback of callbacks) callback(0); };
  const input = new Input();
  const clock = { textContent: "" };
  const release = bindPreviewScrubControl(source, input as unknown as HTMLInputElement, clock as HTMLElement, frames);
  return { source, seeks, input, clock, queued, listeners, tick, release };
}

test("pointer scrubbing uses the latest value per frame and flushes the final release without changing playback intent", () => {
  const f = fixture();
  f.source.emit({ status: "playing", currentTime: 2 });
  f.input.fire("pointerdown");
  for (const time of [4, 8, 12]) { f.input.value = String(time); f.input.fire("input"); }
  expect(f.seeks).toEqual([]); expect(f.queued.size).toBe(1);
  f.source.emit({ currentTime: 2.1 });
  expect(f.input.value).toBe("12"); expect(f.clock.textContent).toContain("0:12.00");
  f.tick(); expect(f.seeks).toEqual([12]);
  f.input.value = "18.5"; f.input.fire("input"); f.input.fire("pointerup");
  expect(f.seeks).toEqual([12, 18.5]); expect(f.queued.size).toBe(0);
  expect(f.source.getState().status).toBe("playing");
  f.release();
});

test("native range change/keyboard input commits immediately, clamps to preview duration and keeps paused state", () => {
  const f = fixture();
  f.input.value = "8.25"; f.input.fire("input"); f.input.fire("change");
  expect(f.seeks).toEqual([8.25]); expect(f.source.getState().status).toBe("paused");
  f.input.value = "99"; f.input.fire("input"); f.input.fire("blur");
  expect(f.seeks).toEqual([8.25, 20]);
  f.release();
});

test("playback ticks update DOM only; empty previews disable scrubbing and cleanup discards stale queued seeks", () => {
  const f = fixture();
  for (let i = 0; i < 120; i++) f.source.emit({ currentTime: i / 10 });
  expect(f.seeks).toEqual([]); expect(f.clock.textContent).toBe("0:11.90 / 0:20.00");
  f.source.emit({ totalDuration: 0, segmentCount: 0 });
  expect(f.input.disabled).toBe(true); f.input.fire("input"); expect(f.queued.size).toBe(0);
  f.source.emit({ totalDuration: 20, segmentCount: 4 });
  f.input.value = "6"; f.input.fire("input"); f.release(); f.tick();
  expect(f.seeks).toEqual([]); expect(f.listeners.size).toBe(0);
  f.input.fire("change"); expect(f.seeks).toEqual([]);
});

test("scrubber renders an accessible native keyboard/touch range with a non-announcing clock", () => {
  const f = fixture();
  const html = renderToStaticMarkup(createElement(PreviewTimelineScrubber, { player: f.source, segments: [] }));
  expect(html).toContain('type="range"'); expect(html).toContain('aria-label="Preview position"');
  expect(html).toContain('aria-live="off"'); expect(html).toContain('max="20"'); expect(html).toContain('step="0.01"');
  expect(html).toContain("Home or End"); expect(formatPreviewScrubTime(59.999)).toBe("1:00.00");
  f.release();
});

test("monitor and console retain the frame while seeking, keep errors visible and expose the scrubber", () => {
  for (const variant of ["monitor", "console"] as const) {
    const player = new BrowserPreviewPlayer();
    player.getState = () => ({ ...createPreviewPlayerState(), status: "loading", totalDuration: 2, segmentCount: 1, errorMessage: "A real media error" });
    const html = renderToStaticMarkup(createElement(PreviewPlayer, { player, variant,
      segments: [{ videoUrl: "https://media.invalid/source.mp4", startTime: 0, endTime: 2, label: "Example" }] }));
    const loadingClasses = html.match(/data-preview-loading="true" class="([^"]*)"/)?.[1] ?? "";
    expect(loadingClasses).toContain("pointer-events-none"); expect(loadingClasses.includes("inset-0")).toBe(false);
    expect(html).toContain("A real media error"); expect(html).toContain('data-preview-scrubber="true"');
  }
});
