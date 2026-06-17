import { describe, expect, test } from "bun:test";
import { buildAudioDrivenSegments, buildBeatSegments, buildSceneSplitSegments, buildSourceClipSpans, buildStandardSegments } from "../../src/components/studio/sourceTimeline";
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

  test("buildSceneSplitSegments maps detected per-source scenes onto the continuous source timeline", () => {
    const [a, b, c] = makeVideoSources();
    const segments = buildSceneSplitSegments([
      {
        ...a!,
        scenes: [
          { id: 0, sourceClipId: 0, label: "A1", start: 0, end: 1.5, duration: 1.5, detector: "pyscenedetect-adaptive" },
          { id: 1, sourceClipId: 0, label: "A2", start: 1.5, end: 4, duration: 2.5, detector: "pyscenedetect-adaptive" },
        ],
      },
      {
        ...b!,
        scenes: [
          { id: 0, sourceClipId: 1, label: "B1", start: 0, end: 5, duration: 5, detector: "pyscenedetect-adaptive" },
        ],
      },
      c!,
    ]);

    expect(segments).toHaveLength(4);
    expect(segments[0]).toMatchObject({ start: 0, end: 1.5, sourceClipIds: [0], sceneId: 0, thumbnailUrl: undefined });
    expect(segments[1]).toMatchObject({ start: 1.5, end: 4, sourceClipIds: [0], sceneId: 1 });
    expect(segments[2]).toMatchObject({ start: 4, end: 9, sourceClipIds: [1], sceneId: 0 });
    expect(segments[3]).toMatchObject({ start: 9, end: 12, sourceClipIds: [2], sceneId: null });
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
