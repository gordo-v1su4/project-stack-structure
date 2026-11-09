import { expect, test } from "bun:test";
import { activatePlaybackTiming, markPlaybackGroupState, markPlaybackTiming, pauseWithPlaybackTiming, PlaybackTimingRecording,
  PLAYBACK_TIMING_RECORD_LIMIT, PLAYBACK_TIMING_WINDOW_MS, releasePlaybackTiming, type PlaybackTimingDetail } from "@/components/studio/playbackTiming";
import { installPlaybackTimingProbe, playbackTimingOptedIn } from "@/components/studio/playbackTimingProbe";

test("query absent never touches controls, document, clocks, timers or observers", () => {
  const window = new Proxy({ location: { search: "?other=1" } }, { get(target, key) {
    if (key !== "location") throw new Error("Disabled probe touched browser work");
    return target.location;
  } });
  const controls = new Proxy({}, { get() { throw new Error("Disabled probe read controls"); } });
  const cleanup = installPlaybackTimingProbe(window as unknown as Window & typeof globalThis, controls as Parameters<typeof installPlaybackTimingProbe>[1]);
  cleanup();
  expect(playbackTimingOptedIn("?playbackTiming=1")).toBe(true);
  expect(playbackTimingOptedIn("?playbackTiming=true")).toBe(false);
});

test("disabled native wrapper calls pause once without inspecting media state or the browser clock", () => {
  let pauses = 0;
  pauseWithPlaybackTiming({ pause() { pauses++; }, get paused(): boolean { throw new Error("Disabled diagnostic read state"); } }, "active-video");
  markPlaybackTiming("handler-entry", { action: "toggle" });
  markPlaybackGroupState([{ get paused(): boolean { throw new Error("Disabled diagnostic read group"); } }]);
  expect(pauses).toBe(1);
});

test("ring is capped, scalar-only and counts dropped records without retaining caller objects", () => {
  const recording = new PlaybackTimingRecording(() => 100);
  const detail = { action: "toggle", eventStartMs: 99, url: "PRIVATE_URL", text: "PRIVATE_TEXT", arbitrary: { src: "PRIVATE_SRC" } };
  for (let index = 0; index < 500; index++) recording.mark("handler-entry", detail as PlaybackTimingDetail);
  const snapshot = recording.snapshot();
  expect(snapshot.records).toHaveLength(PLAYBACK_TIMING_RECORD_LIMIT);
  expect(snapshot.droppedRecords).toBe(501 - PLAYBACK_TIMING_RECORD_LIMIT);
  expect(snapshot.records.at(-1)?.sequence).toBe(501);
  expect(JSON.stringify(snapshot)).not.toContain("PRIVATE_");
  recording.mark("handler-entry", { action: "PRIVATE_ACTION" } as unknown as PlaybackTimingDetail);
  expect(JSON.stringify(recording.snapshot())).not.toContain("PRIVATE_ACTION");
  const copy = recording.snapshot();
  copy.records[0]!.atMs = 999;
  expect(recording.snapshot().records[0]!.atMs).toBe(100);
});

test("deadline rejects later events even if cleanup is delayed, and explicitly marks missing input", () => {
  let now = 50;
  const recording = new PlaybackTimingRecording(() => now);
  const deadline = recording.deadlineMs;
  now = deadline + 500;
  recording.mark("handler-entry", { action: "stop" });
  recording.finish("deadline");
  const snapshot = recording.snapshot();
  expect(snapshot.observationWindowMs).toBe(PLAYBACK_TIMING_WINDOW_MS);
  expect(snapshot.deadlineMs).toBe(deadline);
  expect(snapshot.observationEndMs).toBe(deadline);
  expect(snapshot.finishedAtMs).toBe(now);
  expect(snapshot.records).toHaveLength(1);
  expect(snapshot.milestones.transportInput).toBe("not-captured");
  expect(snapshot.milestones.playerPause).toBe("not-captured");
});

test("native call/return and all-paused markers use the same monotonic clock without changing behavior", () => {
  let now = 0;
  const recording = new PlaybackTimingRecording(() => now);
  const video = { paused: false, pause() { now += 2; this.paused = true; } };
  const audio = { paused: false, pause() { now += 3; this.paused = true; } };
  activatePlaybackTiming(recording);
  try {
    markPlaybackTiming("handler-entry", { action: "toggle" });
    pauseWithPlaybackTiming(video, "active-video");
    pauseWithPlaybackTiming(audio, "master-audio");
    markPlaybackGroupState([video, null, audio]);
    markPlaybackTiming("handler-return", { action: "toggle" });
    const records = recording.snapshot().records;
    expect(records.filter(entry => entry.phase === "native-pause-call").map(entry => entry.atMs)).toEqual([0, 2]);
    expect(records.filter(entry => entry.phase === "native-pause-return").map(entry => [entry.atMs, entry.paused])).toEqual([[2, true], [5, true]]);
    expect(records.find(entry => entry.phase === "group-state")).toMatchObject({ allPaused: true, mediaCount: 2, atMs: 5 });
    expect(recording.snapshot().mediaScope).toBe("current-document");
  } finally { releasePlaybackTiming(recording); }
  const count = recording.snapshot().records.length;
  markPlaybackTiming("handler-entry");
  expect(recording.snapshot().records).toHaveLength(count);
});
