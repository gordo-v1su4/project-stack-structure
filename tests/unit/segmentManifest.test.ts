import { describe, expect, test } from "bun:test";

import {
  buildMusicCutEvents,
  buildSegmentManifest,
  compareSegmentCandidates,
  pickBestSegmentCandidate,
} from "../../src/components/studio/segmentManifest";
import { makeBeatJoinAnalysis, makeRankedCandidates, makeSourceClips } from "../helpers/studioFixtures";

describe("segmentManifest", () => {
  test("buildMusicCutEvents keeps musical cuts authoritative and sorted", () => {
    const events = buildMusicCutEvents({
      analysis: makeBeatJoinAnalysis(),
      mode: "onsets",
      includeSectionBoundaries: true,
    });

    expect(events[0]?.time).toBe(0);
    expect(events.at(-1)?.time).toBe(8);
    expect(events.some((event) => event.kind === "onset")).toBe(true);
    expect(events.some((event) => event.kind === "section")).toBe(true);
  });

  test("buildMusicCutEvents only quantizes within the configured tolerance window", () => {
    const analysis = makeBeatJoinAnalysis();
    const events = buildMusicCutEvents({
      analysis: {
        ...analysis,
        onsets: [0.26, 1.01, 1.46],
      },
      mode: "onsets",
      includeSectionBoundaries: false,
      quantizeStep: 0.25,
      quantizeTolerance: 0.02,
    });

    expect(events.map((event) => event.time)).toContain(1);
    expect(events.map((event) => event.time)).toContain(1.46);
    expect(events.find((event) => event.time === 1)?.quantized).toBe(true);
    expect(events.find((event) => event.time === 1.46)?.quantized).toBe(false);
  });

  test("buildSegmentManifest creates post-cut segments that cover the whole source duration", () => {
    const cutEvents = buildMusicCutEvents({
      analysis: makeBeatJoinAnalysis(),
      mode: "beats",
      includeSectionBoundaries: false,
    });
    const manifest = buildSegmentManifest({
      sourceClips: makeSourceClips(),
      cutEvents,
      totalDuration: 8,
    });

    expect(manifest.length).toBeGreaterThan(1);
    expect(manifest[0]?.start).toBe(0);
    expect(manifest.at(-1)?.end).toBe(8);
    expect(manifest.every((segment) => segment.duration > 0)).toBe(true);
  });

  test("pickBestSegmentCandidate honors music-first precedence before continuity", () => {
    const candidates = makeRankedCandidates();
    const best = pickBestSegmentCandidate(candidates);

    expect(best?.id).toBe("music-a");
    expect(compareSegmentCandidates(candidates[0], candidates[1])).toBeLessThan(0);
  });
});
