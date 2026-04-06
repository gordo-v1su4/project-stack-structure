import { resolveFitPolicy, type FitPolicyParams, type FitPolicyResult } from "./fitPolicy";
import { compareSegmentCandidates } from "./segmentManifest";
import { getAuthoritativeMotionDescriptor } from "./motionDescriptors";
import { scoreMotionContinuity } from "./motionRanking";
import type { MotionDescriptor } from "./types";
import type { RankedSegmentCandidate, SegmentManifestItem } from "./segmentManifest";

export type ContinuityMode = "motion" | "color" | "random";

export interface ManifestRankingInput {
  id: string;
  segment: SegmentManifestItem;
  musicalScore: number;
  fitPenalty?: number;
  targetDuration?: number;
  fitPolicy?: Omit<FitPolicyParams, "sourceDuration" | "targetDuration">;
  fileDescriptor?: MotionDescriptor | null;
  colorContinuityScore?: number | null;
}

export interface RankedManifestCandidate extends RankedSegmentCandidate {
  segmentId: number;
  continuityMode: ContinuityMode;
  effectiveMotionDescriptor: MotionDescriptor | null;
  fitResult: FitPolicyResult;
}

export function buildManifestRankingCandidate(params: {
  mode: ContinuityMode;
  input: ManifestRankingInput;
  previousDescriptor?: MotionDescriptor | null;
  randomSeed?: string | number;
}): RankedManifestCandidate {
  const { mode, input, previousDescriptor = null, randomSeed = 0 } = params;
  const fitResult = resolveFitPolicy({
    sourceDuration: input.segment.duration,
    targetDuration: input.targetDuration ?? input.segment.duration,
    ...(input.fitPolicy ?? {}),
  });
  const effectiveMotionDescriptor = getAuthoritativeMotionDescriptor({
    segmentDescriptor: input.segment.motionDescriptor,
    fileDescriptor: input.fileDescriptor,
  });

  return {
    id: input.id,
    segmentId: input.segment.id,
    musicalScore: input.musicalScore,
    fitPenalty: input.fitPenalty ?? fitResult.penalty,
    continuityMode: mode,
    effectiveMotionDescriptor,
    fitResult,
    continuityScore: resolveContinuityScore({
      mode,
      previousDescriptor,
      candidateDescriptor: effectiveMotionDescriptor,
      colorContinuityScore: input.colorContinuityScore,
      candidateId: input.id,
      randomSeed,
    }),
  };
}

export function rankManifestCandidates(params: {
  mode: ContinuityMode;
  candidates: ManifestRankingInput[];
  previousDescriptor?: MotionDescriptor | null;
  randomSeed?: string | number;
}) {
  const { mode, candidates, previousDescriptor = null, randomSeed = 0 } = params;
  return candidates
    .map((input) => buildManifestRankingCandidate({ mode, input, previousDescriptor, randomSeed }))
    .sort(compareSegmentCandidates);
}

function resolveContinuityScore(params: {
  mode: ContinuityMode;
  previousDescriptor: MotionDescriptor | null;
  candidateDescriptor: MotionDescriptor | null;
  colorContinuityScore?: number | null;
  candidateId: string;
  randomSeed: string | number;
}) {
  const { mode, previousDescriptor, candidateDescriptor, colorContinuityScore = null, candidateId, randomSeed } = params;

  if (mode === "motion") {
    return scoreMotionContinuity({ from: previousDescriptor, to: candidateDescriptor });
  }

  if (mode === "color") {
    return clampScore(colorContinuityScore ?? 0);
  }

  return seededRandomScore(candidateId, randomSeed);
}

function seededRandomScore(id: string, seed: string | number) {
  const source = `${seed}:${id}`;
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return clampScore(((hash >>> 0) % 1000) / 1000);
}

function clampScore(value: number) {
  return Math.max(0, Math.min(1, value));
}
