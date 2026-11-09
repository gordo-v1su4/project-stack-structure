import { expect, test } from "bun:test";
import { installPlaybackTimingProbe } from "@/components/studio/playbackTimingProbe";

class Target {
  listeners = new Map<string, Set<(event: Event) => void>>();
  attributes = new Map<string, string>();
  disabled = false;
  tagName = "BUTTON";
  writes = 0;
  private text = "";
  get textContent() { return this.text; }
  set textContent(value: string) { this.text = value; this.writes++; }
  addEventListener(type: string, callback: (event: Event) => void) {
    const listeners = this.listeners.get(type) ?? new Set(); listeners.add(callback); this.listeners.set(type, listeners);
  }
  removeEventListener(type: string, callback: (event: Event) => void) { this.listeners.get(type)?.delete(callback); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  closest(selector: string) {
    if (selector === "[data-playback-action]") return this.attributes.has("data-playback-action") ? this : null;
    return this.tagName === "INPUT" ? this : null;
  }
  fire(type: string, patch: Record<string, unknown> = {}) {
    for (const callback of [...(this.listeners.get(type) ?? [])]) callback({ type, target: this, timeStamp: 0, ...patch } as unknown as Event);
  }
  get listenerCount() { return [...this.listeners.values()].reduce((sum, listeners) => sum + listeners.size, 0); }
}

function fixture() {
  let now = 0, next = 0;
  const document = new Target();
  const timers = new Map<number, () => void>(), frames = new Map<number, FrameRequestCallback>();
  const instances: Observer[] = [];
  class Observer {
    static supportedEntryTypes = ["event", "longtask"];
    disconnected = false;
    queued: PerformanceEntry[] = [];
    constructor(private callback: (list: { getEntries(): PerformanceEntry[] }) => void) { instances.push(this); }
    observe() {}
    takeRecords() { const queued = this.queued; this.queued = []; return queued; }
    disconnect() { this.disconnected = true; }
    emit(entries: PerformanceEntry[]) { this.callback({ getEntries: () => entries }); }
  }
  class Media extends Target { paused = true; }
  const window = { location: { search: "?playbackTiming=1" }, performance: { now: () => now, timeOrigin: 1_000_000 }, document,
    Element: Target, HTMLMediaElement: Media, PerformanceObserver: Observer,
    setTimeout(callback: () => void) { timers.set(++next, callback); return next; }, clearTimeout(id: number) { timers.delete(id); },
    requestAnimationFrame(callback: FrameRequestCallback) { frames.set(++next, callback); return next; }, cancelAnimationFrame(id: number) { frames.delete(id); },
  };
  const start = new Target(), finish = new Target(), status = new Target(), output = new Target();
  const controls = { start, finish, status, output };
  const install = () => installPlaybackTimingProbe(window as unknown as Window & typeof globalThis, controls as unknown as Parameters<typeof installPlaybackTimingProbe>[1]);
  return { install, document, window, start, finish, status, output, timers, frames, instances, setTime(value: number) { now = value; } };
}

test("native activation is fixed, quiet while recording, and Finish drains observers then tears down", () => {
  const f = fixture();
  const cleanup = f.install();
  expect(f.timers.size).toBe(0); expect(f.document.listenerCount).toBe(0);
  f.start.fire("click");
  const recordingOutput = f.output.textContent, writes = f.output.writes;
  expect(f.timers.size).toBe(1); expect(f.instances).toHaveLength(2);
  f.setTime(10); f.start.fire("click");
  expect(f.output.textContent).toBe(recordingOutput); expect(f.timers.size).toBe(1);
  const button = new Target(); button.attributes.set("data-playback-action", "toggle");
  for (let index = 0; index < 120; index++) f.document.fire("click", { target: button, timeStamp: 5 });
  expect(f.frames.size).toBe(8); // A maximum of eight two-frame samples, not a persistent rAF loop.
  f.instances[1]!.emit([{ name: "PRIVATE_NAME", startTime: 5, duration: 50, attribution: "PRIVATE_CONTENT" } as unknown as PerformanceEntry]);
  expect(f.output.writes).toBe(writes);
  expect(f.output.textContent).toBe(recordingOutput);
  f.instances[0]!.queued = [{ name: "click", target: button, startTime: 5, duration: 24, processingStart: 6, processingEnd: 9, interactionId: 7 } as unknown as PerformanceEntry];
  f.finish.fire("click");
  const result = JSON.parse(f.output.textContent);
  expect(result.finishReason).toBe("manual"); expect(result.deadlineMs).toBe(20_000);
  expect(result.records.some((entry: { phase: string }) => entry.phase === "event-timing")).toBe(true);
  expect(f.output.writes).toBe(writes + 1);
  expect(f.document.listenerCount).toBe(0); expect(f.frames.size).toBe(0); expect(f.timers.size).toBe(0);
  expect(f.finish.listenerCount).toBe(0); expect(f.instances.every(observer => observer.disconnected)).toBe(true);
  const completeOutput = f.output.textContent;
  f.instances[0]!.emit([{ name: "click", target: button, startTime: 5, duration: 24 } as unknown as PerformanceEntry]);
  expect(f.output.textContent).toBe(completeOutput);
  expect(completeOutput).not.toContain("PRIVATE_");
  cleanup(); expect(f.start.listenerCount).toBe(0);
});

test("only actual playback keyboard categories are captured; typed text and arbitrary EventTiming names are excluded", () => {
  const f = fixture(); const cleanup = f.install(); f.start.fire("click"); f.setTime(100);
  f.document.fire("keydown", { key: "K", timeStamp: 95 });
  f.document.fire("keydown", { key: " ", timeStamp: 96 });
  f.document.fire("keydown", { key: "PRIVATE_TYPED_TEXT", timeStamp: 97 });
  const input = new Target(); input.tagName = "INPUT";
  f.document.fire("keydown", { target: input, key: "k", timeStamp: 98 });
  const button = new Target(); button.attributes.set("data-playback-action", "stop");
  f.instances[0]!.emit([{ name: "PRIVATE_EVENT_NAME", target: button, startTime: 99, duration: 50 } as unknown as PerformanceEntry]);
  f.finish.fire("click");
  const result = JSON.parse(f.output.textContent);
  expect(result.records.filter((entry: { phase: string }) => entry.phase === "input-capture").map((entry: { action: string }) => entry.action)).toEqual(["stop", "toggle"]);
  expect(f.output.textContent).not.toContain("PRIVATE_");
  cleanup();
});

test("deadline and StrictMode-style setup/cleanup/setup leave no live observers, frames, timers or handlers", () => {
  const f = fixture(); const firstCleanup = f.install(); firstCleanup();
  const cleanup = f.install(); expect(f.start.listenerCount).toBe(1);
  f.start.fire("click"); f.setTime(20_001);
  for (const callback of [...f.timers.values()]) callback();
  const result = JSON.parse(f.output.textContent);
  expect(result.observationEndMs).toBe(20_000); expect(result.finishReason).toBe("deadline");
  expect(result.milestones.playerPause).toBe("not-captured");
  expect(f.document.listenerCount).toBe(0); expect(f.frames.size).toBe(0); expect(f.timers.size).toBe(0);
  f.start.fire("click");
  expect(f.timers.size).toBe(1);
  cleanup();
  expect(f.start.listenerCount).toBe(0); expect(f.finish.listenerCount).toBe(0);
  expect(f.timers.size).toBe(0); expect(f.document.listenerCount).toBe(0);
  expect(f.instances.every(observer => observer.disconnected)).toBe(true);
});

test("delayed deadline drains in-window observations without extending the window or accepting later callbacks", () => {
  const f = fixture(); const cleanup = f.install(); f.setTime(100); f.start.fire("click");
  const button = new Target(); button.attributes.set("data-playback-action", "toggle");
  f.instances[0]!.queued = [
    { name: "click", target: button, startTime: 19_900, duration: 4_000, processingStart: 23_800, processingEnd: 23_900 },
    { name: "click", target: button, startTime: 20_101, duration: 24 },
    { name: "click", target: button, startTime: 99, duration: 24 },
  ] as unknown as PerformanceEntry[];
  f.instances[1]!.queued = [
    { name: "self", startTime: 19_800, duration: 4_100 },
    { name: "self", startTime: 20_101, duration: 50 },
  ] as unknown as PerformanceEntry[];
  const recordingWrites = f.output.writes;
  f.setTime(24_000); // A blocking task delayed the fixed 20-second deadline callback.
  for (const callback of [...f.timers.values()]) callback();
  const result = JSON.parse(f.output.textContent);
  expect(result.deadlineMs).toBe(20_100); expect(result.observationEndMs).toBe(20_100);
  expect(result.finishedAtMs).toBe(24_000); expect(result.atMsMeaning).toBe("observed-at");
  const drained = result.records.filter((entry: { delivery?: string }) => entry.delivery === "finish-drain");
  expect(drained.map((entry: { phase: string; eventStartMs: number }) => [entry.phase, entry.eventStartMs])).toEqual([
    ["event-timing", 19_900], ["long-task", 19_800],
  ]);
  expect(drained.every((entry: { atMs: number }) => entry.atMs === 24_000)).toBe(true);
  expect(drained[0].processingStartMs).toBe(23_800); // Queueing beyond the window remains visible.
  expect(f.output.writes).toBe(recordingWrites + 1);
  expect(f.timers.size).toBe(0); expect(f.frames.size).toBe(0); expect(f.document.listenerCount).toBe(0);
  expect(f.instances.every(observer => observer.disconnected)).toBe(true);
  const complete = f.output.textContent;
  f.instances[0]!.emit([{ name: "click", target: button, startTime: 19_950, duration: 25 } as unknown as PerformanceEntry]);
  expect(f.output.textContent).toBe(complete);
  cleanup();
});

test("observer delivery before a delayed deadline timer preserves the consumed batch and closes the window", () => {
  const f = fixture(); const cleanup = f.install(); f.start.fire("click");
  const button = new Target(); button.attributes.set("data-playback-action", "stop");
  const delayedTimer = [...f.timers.values()][0]!;
  f.instances[1]!.queued = [{ name: "self", startTime: 19_000, duration: 5_000 } as unknown as PerformanceEntry];
  f.setTime(24_000);
  f.instances[0]!.emit([
    { name: "click", target: button, startTime: 19_500, duration: 4_500 },
    { name: "click", target: button, startTime: 20_001, duration: 20 },
  ] as unknown as PerformanceEntry[]);
  const result = JSON.parse(f.output.textContent);
  expect(result.state).toBe("complete"); expect(result.finishReason).toBe("deadline");
  expect(result.observationEndMs).toBe(20_000); expect(result.finishedAtMs).toBe(24_000);
  expect(result.records.filter((entry: { delivery?: string }) => entry.delivery === "finish-drain")
    .map((entry: { phase: string; eventStartMs: number }) => [entry.phase, entry.eventStartMs]))
    .toEqual([["event-timing", 19_500], ["long-task", 19_000]]);
  expect(f.timers.size).toBe(0); expect(f.document.listenerCount).toBe(0);
  expect(f.instances.every(observer => observer.disconnected)).toBe(true);
  const completed = f.output.textContent, writes = f.output.writes;
  delayedTimer();
  f.instances[0]!.emit([{ name: "click", target: button, startTime: 19_500, duration: 4_500 } as unknown as PerformanceEntry]);
  expect(f.output.textContent).toBe(completed); expect(f.output.writes).toBe(writes);
  cleanup();
});
