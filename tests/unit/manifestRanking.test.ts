import { describe, expect, test } from "bun:test";

import { buildManifestRankingCandidate, rankManifestCandidates } from "../../src/components/studio/manifestRanking";
import { buildSegmentManifest, buildMusicCutEvents } from "../../src/components/studio/segmentManifest";
import { makeBeatJoinAnalysis, makeMotionDescriptor, makeSourceClips } from "../helpers/studioFixtures";

function makeManifestInput(id: string, segmentIndex: number, overrides: Partial<Parameters<typeof buildManifestRankingCandidate>[0]["input"]> = {}) {
  const segments = buildSegmentManifest({
    sourceClips: makeSourceClips(),
    cutEvents: buildMusicCutEvents({ analysis: makeBeatJoinAnalysis(), mode: "beats" }),
    totalDuration: 8,
  });

  return {
    id,
    segment: segments[segmentIndex]!,
    musicalScore: 0.9,
    fitPenalty: undefined,
    ...overrides,
  };
}

describe("manifestRanking", () => {
  test("music-first precedence beats stronger continuity", () => {
    const previousDescriptor = makeMotionDescriptor();
    const musicFirst = makeManifestInput("music-first", 0, {
      musicalScore: 0.98,
      segment: {
        ...makeManifestInput("base-a", 0).segment,
        motionDescriptor: makeMotionDescriptor({ id: "weak", dominantAngleDeg: 200, dominantMagnitude: 0.2, motionCoherence: 0.1, cameraMotionType: "tilt" }),
      },
      fitPenalty: 0.02,
    });
    const continuityFirst = makeManifestInput("continuity-first", 1, {
      musicalScore: 0.91,
      segment: {
        ...makeManifestInput("base-b", 1).segment,
        motionDescriptor: makeMotionDescriptor({ id: "strong", dominantAngleDeg: 45, dominantMagnitude: 0.7, motionCoherence: 0.9, cameraMotionType: "pan" }),
      },
      fitPenalty: 0.01,
    });

    const ranked = rankManifestCandidates({
      mode: "motion",
      candidates: [continuityFirst, musicFirst],
      previousDescriptor,
    });

    expect(ranked[0]?.id).toBe("music-first");
  });

  test("segment descriptor outranks file descriptor fallback", () => {
    const input = makeManifestInput("candidate", 0, {
      fileDescriptor: makeMotionDescriptor({ id: "file", targetKind: "file", filePath: "/tmp/file.mp4", dominantAngleDeg: 10 }),
      segment: {
        ...makeManifestInput("base", 0).segment,
        motionDescriptor: makeMotionDescriptor({ id: "segment", targetKind: "segment", filePath: "/tmp/file.mp4", segmentId: 0, start: 0, end: 2, dominantAngleDeg: 45 }),
      },
    });

    const candidate = buildManifestRankingCandidate({
      mode: "motion",
      input,
      previousDescriptor: makeMotionDescriptor({ dominantAngleDeg: 45 }),
    });

    expect(candidate.effectiveMotionDescriptor?.id).toBe("segment");
  });

  test("random mode is deterministic when seeded", () => {
    const candidates = [makeManifestInput("a", 0), makeManifestInput("b", 1), makeManifestInput("c", 2)];

    const first = rankManifestCandidates({ mode: "random", candidates, randomSeed: 42 }).map((candidate) => candidate.id);
    const second = rankManifestCandidates({ mode: "random", candidates, randomSeed: 42 }).map((candidate) => candidate.id);
    const third = rankManifestCandidates({ mode: "random", candidates, randomSeed: 99 }).map((candidate) => candidate.id);

    expect(first).toEqual(second);
    expect(first).not.toEqual(third);
  });

  test("color mode hook does not override stronger musical fit", () => {
    const highMusic = makeManifestInput("high-music", 0, { musicalScore: 0.97, colorContinuityScore: 0.1 });
    const highColor = makeManifestInput("high-color", 1, { musicalScore: 0.9, colorContinuityScore: 0.99 });

    const ranked = rankManifestCandidates({ mode: "color", candidates: [highColor, highMusic] });

    expect(ranked[0]?.id).toBe("high-music");
  });

  test("low-confidence motion data is downweighted", () => {
    const previous = makeMotionDescriptor();
    const highConfidence = buildManifestRankingCandidate({
      mode: "motion",
      previousDescriptor: previous,
      input: makeManifestInput("high", 0, {
        segment: {
          ...makeManifestInput("base-high", 0).segment,
          motionDescriptor: makeMotionDescriptor({ id: "high-desc", confidence: { overall: 0.9, camera: 0.8, residual: 0.8 } }),
        },
      }),
    });
    const lowConfidence = buildManifestRankingCandidate({
      mode: "motion",
      previousDescriptor: previous,
      input: makeManifestInput("low", 1, {
        segment: {
          ...makeManifestInput("base-low", 1).segment,
          motionDescriptor: makeMotionDescriptor({ id: "low-desc", confidence: { overall: 0.1, camera: 0.1, residual: 0.1 } }),
        },
      }),
    });

    expect(highConfidence.continuityScore).toBeGreaterThan(lowConfidence.continuityScore);
  });

  test("missing descriptors degrade gracefully", () => {
    const candidate = buildManifestRankingCandidate({
      mode: "motion",
      previousDescriptor: makeMotionDescriptor(),
      input: makeManifestInput("missing", 0, {
        segment: {
          ...makeManifestInput("base-missing", 0).segment,
          motionDescriptor: null,
        },
        fileDescriptor: null,
      }),
    });

    expect(candidate.continuityScore).toBe(0);
    expect(candidate.effectiveMotionDescriptor).toBeNull();
  });

  test("fit penalty is inferred from fit policy when target duration differs", () => {
    const input = makeManifestInput("fit-policy", 0);
    const candidate = buildManifestRankingCandidate({
      mode: "motion",
      previousDescriptor: makeMotionDescriptor(),
      input: {
        ...input,
        targetDuration: input.segment.duration - 0.15,
        fitPolicy: { trimTolerance: 0.2 },
      },
    });

    expect(candidate.fitResult.decision).toBe("trim");
    expect(candidate.fitPenalty).toBeGreaterThan(0);
  });

  test("fit policy can force rejection when no legal strategy exists", () => {
    const candidate = buildManifestRankingCandidate({
      mode: "motion",
      previousDescriptor: makeMotionDescriptor(),
      input: makeManifestInput("reject", 0, {
        targetDuration: 3,
        fitPolicy: { allowTrim: false, allowSpeedRamp: false, allowOverlap: false, canOverlap: false },
      }),
    });

    expect(candidate.fitResult.decision).toBe("reject");
    expect(candidate.fitPenalty).toBe(1);
  });

  test("explicit fitPenalty still overrides inferred fit policy penalty", () => {
    const input = makeManifestInput("manual-penalty", 0);
    const candidate = buildManifestRankingCandidate({
      mode: "motion",
      previousDescriptor: makeMotionDescriptor(),
      input: {
        ...input,
        targetDuration: input.segment.duration - 0.15,
        fitPenalty: 0.01,
        fitPolicy: { trimTolerance: 0.2 },
      },
    });

    expect(candidate.fitResult.decision).toBe("trim");
    expect(candidate.fitPenalty).toBe(0.01);
  });
});
