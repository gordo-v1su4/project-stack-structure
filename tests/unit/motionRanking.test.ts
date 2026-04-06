import { describe, expect, test } from "bun:test";

import { compareSegmentCandidates, pickBestSegmentCandidate } from "../../src/components/studio/segmentManifest";
import { buildMotionRankedCandidate, scoreMotionContinuity } from "../../src/components/studio/motionRanking";
import { makeMotionDescriptor } from "../helpers/studioFixtures";

describe("motionRanking", () => {
  test("gives a higher continuity score to similar motion descriptors", () => {
    const base = makeMotionDescriptor({ dominantAngleDeg: 45, dominantMagnitude: 0.7, motionCoherence: 0.8, cameraMotionType: "pan" });
    const similar = makeMotionDescriptor({ id: "similar", dominantAngleDeg: 55, dominantMagnitude: 0.72, motionCoherence: 0.75, cameraMotionType: "pan" });
    const different = makeMotionDescriptor({ id: "different", dominantAngleDeg: 220, dominantMagnitude: 0.2, motionCoherence: 0.2, cameraMotionType: "tilt" });

    expect(scoreMotionContinuity({ from: base, to: similar })).toBeGreaterThan(scoreMotionContinuity({ from: base, to: different }));
  });

  test("downweights continuity when confidence is weak", () => {
    const base = makeMotionDescriptor({ confidence: { overall: 0.9, camera: 0.9, residual: 0.9 } });
    const high = makeMotionDescriptor({ id: "high", confidence: { overall: 0.8, camera: 0.8, residual: 0.8 } });
    const low = makeMotionDescriptor({ id: "low", confidence: { overall: 0.2, camera: 0.2, residual: 0.2 } });

    expect(scoreMotionContinuity({ from: base, to: high })).toBeGreaterThan(scoreMotionContinuity({ from: base, to: low }));
  });

  test("music-first precedence still wins when continuity is stronger elsewhere", () => {
    const base = makeMotionDescriptor();
    const strongerContinuity = makeMotionDescriptor({ id: "stronger", dominantAngleDeg: 45, dominantMagnitude: 0.7, motionCoherence: 0.85, cameraMotionType: "pan" });
    const weakerContinuity = makeMotionDescriptor({ id: "weaker", dominantAngleDeg: 200, dominantMagnitude: 0.2, motionCoherence: 0.2, cameraMotionType: "tilt" });

    const musicFirst = buildMotionRankedCandidate({ id: "music-first", musicalScore: 0.98, from: base, to: weakerContinuity, fitPenalty: 0.02 });
    const continuityFirst = buildMotionRankedCandidate({ id: "continuity-first", musicalScore: 0.91, from: base, to: strongerContinuity, fitPenalty: 0.01 });

    expect(compareSegmentCandidates(musicFirst, continuityFirst)).toBeLessThan(0);
    expect(pickBestSegmentCandidate([continuityFirst, musicFirst])?.id).toBe("music-first");
  });
});
