import { describe, expect, test } from "bun:test";
import { buildAudioDrivenSegments, buildBeatSegments, buildSourceClipSpans, buildStandardSegments } from "../../src/components/studio/sourceTimeline";
import { makeBeatJoinAnalysis, makeSourceClips, makeVideoSources } from "../helpers/studioFixtures";

describe("sourceTimeline", () => {
  test("buildSourceClipSpans filters invalid durations and accumulates time", () => {
    const spans = buildSourceClipSpans([
      ...makeVideoSources(),
      { id: 99, name: "bad.mp4", duration: 0, size: 1, thumbnailUrl: "x", videoUrl: "blob:bad" },
    ]);

    expect(spans).toHaveLength(3);
    expect(spans[0]).toMatchObject({ start: 0, end: 4 });
    expect(spans[1]).toMatchObject({ start: 4, end: 9 });
    expect(spans[2]).toMatchObject({ start: 9, end: 12 });
  });

  test("buildStandardSegments covers the full source timeline", () => {
    const segments = buildStandardSegments(makeSourceClips(), 4);

    expect(segments.length).toBeGreaterThan(1);
    expect(segments[0]?.start).toBe(0);
    expect(segments.at(-1)?.end).toBe(12);
    expect(segments.flatMap((segment) => segment.sourceClipIds)).toContain(1);
  });

  test("buildBeatSegments derives music-sized segments from bpm and bars", () => {
    const segments = buildBeatSegments(makeSourceClips(), 120, 2);

    expect(segments[0]?.duration).toBeCloseTo(4, 2);
    expect(segments.at(-1)?.end).toBe(12);
  });

  test("buildAudioDrivenSegments produces post-cut segments from analysis events", () => {
    const segments = buildAudioDrivenSegments({
      sourceClips: makeSourceClips(),
      analysis: makeBeatJoinAnalysis(),
      mode: "onsets",
      targetEvents: 2,
      density: 0.8,
    });

    expect(segments.length).toBeGreaterThan(1);
    expect(segments[0]?.start).toBe(0);
    expect(segments.every((segment) => segment.duration > 0)).toBe(true);
  });
});
