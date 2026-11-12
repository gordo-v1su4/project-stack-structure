import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createPreviewPlayerState, type BrowserPreviewPlayer, type PreviewPlayerListener, type PreviewPlayerState } from "@/components/studio/previewPlayer";
import { createPreviewPlayerStore, getPreviewPlayerStore } from "@/components/studio/previewPlayerStore";
import { PreviewPlayer } from "@/components/studio/PreviewPlayerComponent";
import { PreviewBeatSpine, PreviewTransportBar } from "@/components/studio/shell/PreviewPlaybackLeaves";
import { makeBeatJoinAnalysis } from "../helpers/studioFixtures";

class PlayerSource {
  state: PreviewPlayerState = { ...createPreviewPlayerState(), status: "playing", segmentCount: 24, totalDuration: 24 };
  listeners = new Set<PreviewPlayerListener>();
  subscriptions = 0;
  getState() { return { ...this.state }; }
  subscribe(listener: PreviewPlayerListener) {
    this.subscriptions++;
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  emit(patch: Partial<PreviewPlayerState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.getState());
  }
}

describe("preview subscriptions", () => {
  test("120 native clock updates reach every playback leaf without notifying the editor root", () => {
    const source = new PlayerSource();
    const store = createPreviewPlayerStore(source);
    const rootSnapshots: unknown[] = [];
    const leafTimes: number[][] = [[], [], []];
    const releaseRoot = store.subscribeSummary(() => rootSnapshots.push(store.getSummary()));
    const releaseLeaves = leafTimes.map((times) => store.subscribe(() => times.push(store.getSnapshot().currentTime)));
    const initialSummary = store.getSummary();
    const expected = Array.from({ length: 120 }, (_, index) => (index + 1) / 60);
    for (const currentTime of expected) source.emit({ currentTime });
    expect(source.subscriptions).toBe(1);
    expect(rootSnapshots).toHaveLength(0);
    expect(store.getSummary()).toBe(initialSummary);
    expect("currentTime" in store.getSummary()).toBe(false);
    for (const times of leafTimes) expect(times).toEqual(expected);

    source.emit({ currentIndex: 1, currentTime: 2 });
    expect(rootSnapshots).toHaveLength(1);
    source.emit({ status: "paused" });
    expect(rootSnapshots).toHaveLength(2);
    source.emit({ status: "error", errorMessage: "Decode failed" });
    expect(rootSnapshots).toHaveLength(3);
    expect(store.getSummary().errorMessage).toBe("Decode failed");
    releaseRoot();
    expect(source.listeners.size).toBe(1);
    for (const release of releaseLeaves) release();
    expect(source.listeners.size).toBe(0);
  });

  test("cached snapshots are referentially stable and repeated identical events do not notify", () => {
    const source = new PlayerSource();
    const store = createPreviewPlayerStore(source);
    const initial = store.getSnapshot();
    let notifications = 0;
    const release = store.subscribe(() => notifications++);
    expect(store.getSnapshot()).toBe(initial);
    expect(store.getSnapshot()).toBe(store.getSnapshot());
    source.emit({});
    expect(notifications).toBe(0);
    source.emit({ currentTime: 0.5 });
    expect(notifications).toBe(1);
    expect(store.getSnapshot()).not.toBe(initial);
    expect(store.getServerSnapshot()).toBe(initial);
    release();
  });

  test("subscription catches missed seeks and remounts without retaining an upstream listener", () => {
    const source = new PlayerSource();
    const store = createPreviewPlayerStore(source);
    source.emit({ currentTime: 9, currentIndex: 4 });
    const release = store.subscribe(() => {});
    expect(store.getSnapshot().currentTime).toBe(9);
    expect(store.getSummary().currentIndex).toBe(4);
    release();
    source.emit({ status: "idle", currentTime: 0, currentIndex: 0 });
    const releaseRemount = store.subscribeSummary(() => {});
    expect(store.getSummary().status).toBe("idle");
    expect(store.getSnapshot().currentTime).toBe(0);
    expect(source.listeners.size).toBe(1);
    releaseRemount();
    expect(source.listeners.size).toBe(0);
  });

  test("the same player shares its store while distinct players remain isolated", () => {
    const first = new PlayerSource();
    const second = new PlayerSource();
    expect(getPreviewPlayerStore(first)).toBe(getPreviewPlayerStore(first));
    expect(getPreviewPlayerStore(first)).not.toBe(getPreviewPlayerStore(second));
  });
});

describe("playback leaves server rendering", () => {
  const noop = () => {};
  const transportProps = {
    transport: { source: "preview" as const, currentTime: 0, duration: 24, isPlaying: true, label: "Preview", bpm: 120 },
    onToggle: noop, onStop: noop, onRewind: noop, onOpenCommands: noop,
    statusLabel: "Ready", statusTone: "ready" as const, activity: null, activityTone: "waiting" as const,
  };

  test("preview transport renders the leaf snapshot and song transport keeps its own clock", () => {
    const source = new PlayerSource();
    source.state.currentTime = 7.25;
    const player = source as unknown as BrowserPreviewPlayer;
    const preview = renderToStaticMarkup(createElement(PreviewTransportBar, { ...transportProps, player }));
    expect(preview).toContain("00:07.25");
    expect(preview).toContain("Pause (Space)");
    const song = renderToStaticMarkup(createElement(PreviewTransportBar, {
      ...transportProps, player: null,
      transport: { ...transportProps.transport, source: "song", currentTime: 3.5 },
    }));
    expect(song).toContain("00:03.50");
    expect(source.subscriptions).toBe(0);
  });

  test("monitor and beat spine render without browser media work or eager subscriptions", () => {
    const source = new PlayerSource();
    const player = source as unknown as BrowserPreviewPlayer;
    const monitor = renderToStaticMarkup(createElement(PreviewPlayer, {
      player, variant: "monitor", segments: [{ videoUrl: "blob:fixture", startTime: 0, endTime: 24, label: "Fixture" }],
    }));
    expect(monitor).toContain('data-preview-variant="monitor"');
    expect(monitor.match(/<video/g)).toHaveLength(2);
    const spine = renderToStaticMarkup(createElement(PreviewBeatSpine, {
      player, songPlayhead: 0, analysis: makeBeatJoinAnalysis(), bpm: 120, onSeek: noop,
      caption: null, slots: [], selectedSlotId: null, onSelectSlot: noop, takes: [], onPreviewSource: noop,
    }));
    expect(spine).toContain('aria-label="Beat spine"');
    expect(spine).toContain("Intro");
    expect(source.subscriptions).toBe(0);
  });
});
