import { expect, test } from "bun:test";
import { buildSelectedPlayback, normalizeSongRanges, previewOffsetAtSongTime, selectSongRange } from "@/components/studio/reviewSelection";
import type { EditPlanPreviewSegment } from "@/components/studio/musicVideoProject";
import { getMasterAudioTimeForPosition } from "@/components/studio/previewPlayer";

test("selection supports separated choruses, toggle removal and anchored Shift extension without mutating previous selections", () => {
  const first = selectSongRange(null, { start: 10, end: 20 })!;
  const before = JSON.stringify(first);
  const two = selectSongRange(first, { start: 50, end: 60 }, { toggle: true })!;
  expect(two.ranges).toEqual([{ start: 10, end: 20 }, { start: 50, end: 60 }]);
  expect(JSON.stringify(first)).toBe(before);
  expect(selectSongRange(two, { start: 50, end: 60 }, { toggle: true })!.ranges).toEqual(first.ranges);
  expect(selectSongRange(first, { start: 30, end: 40 }, { extend: true })!.ranges).toEqual([{ start: 10, end: 40 }]);
  expect(selectSongRange(first, { start: 0, end: 5 }, { extend: true })!.ranges).toEqual([{ start: 0, end: 20 }]);
  expect(selectSongRange(first, first.anchor, { toggle: true })).toBeNull();
});

test("subtracting a middle chunk retains both sides and additive drag merges overlapping ranges", () => {
  const whole = selectSongRange(null, { start: 0, end: 20 });
  const split = selectSongRange(whole, { start: 5, end: 10 }, { toggle: true });
  expect(split!.ranges).toEqual([{ start: 0, end: 5 }, { start: 10, end: 20 }]);
  expect(selectSongRange(split, { start: 4, end: 12 }, { add: true })!.ranges).toEqual([{ start: 0, end: 20 }]);
  expect(normalizeSongRanges([{ start: NaN, end: 2 }, { start: 4, end: 3 }, { start: 1, end: 2 }])).toEqual([{ start: 1, end: 2 }]);
});

test("separated playback clips the exact source windows at normal speed and uses the corresponding master audio", () => {
  const segments = [{ kind: "source", videoUrl: "a.mp4", startTime: 100, endTime: 110, musicStart: 10, musicEnd: 20, label: "Chorus 1" },
    { kind: "source", videoUrl: "b.mp4", startTime: 7, endTime: 17, musicStart: 50, musicEnd: 60, label: "Chorus 2" }] as EditPlanPreviewSegment[];
  const before = JSON.stringify(segments);
  const played = buildSelectedPlayback(segments, [{ start: 52, end: 55 }, { start: 12, end: 14 }]);
  expect(played.map(s => [s.startTime, s.endTime, s.musicStart, s.musicEnd])).toEqual([[102, 104, 12, 14], [9, 12, 52, 55]]);
  expect(getMasterAudioTimeForPosition(played, 0, 102.5)).toBe(12.5);
  expect(getMasterAudioTimeForPosition(played, 1, 10)).toBe(53);
  expect(previewOffsetAtSongTime(played, 53)).toBe(3);
  expect(previewOffsetAtSongTime(played, 30)).toBeNull();
  expect(previewOffsetAtSongTime(played, 55)).toBe(5);
  expect(JSON.stringify(segments)).toBe(before);
});

test("short footage remains a visible gap instead of stretching or repeating video", () => {
  const segments = [{ kind: "source", videoUrl: "a.mp4", startTime: 5, endTime: 7, musicStart: 10, musicEnd: 15, label: "Short" }] as EditPlanPreviewSegment[];
  const played = buildSelectedPlayback(segments, [{ start: 11, end: 15 }]);
  expect(played.map(s => [s.kind, s.startTime, s.endTime, s.musicStart, s.musicEnd])).toEqual([["source", 6, 7, 11, 12], ["gap", 0, 3, 12, 15]]);
});

test("unrepresented windows stay audible gaps; only explicitly unselected song ranges are skipped", () => {
  const segments = [{ kind: "source", videoUrl: "a", startTime: 0, endTime: 2, musicStart: 2, musicEnd: 4, label: "A" }] as EditPlanPreviewSegment[];
  expect(buildSelectedPlayback(segments, [{ start: 0, end: 6 }]).map(s => [s.kind, s.musicStart, s.musicEnd]))
    .toEqual([["gap", 0, 2], ["source", 2, 4], ["gap", 4, 6]]);
  expect(buildSelectedPlayback([], [{ start: 10, end: 20 }, { start: 40, end: 45 }]).map(s => [s.musicStart, s.musicEnd]))
    .toEqual([[10, 20], [40, 45]]);
});
