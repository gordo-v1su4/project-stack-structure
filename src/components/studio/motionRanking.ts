import type { MotionDescriptor } from "./types";
import type { RankedSegmentCandidate } from "./segmentManifest";

export function scoreMotionContinuity(params: {
  from: MotionDescriptor | null;
  to: MotionDescriptor | null;
}) {
  const { from, to } = params;
  if (!from || !to) return 0;

  const confidence = Math.min(from.confidence.overall, to.confidence.overall);
  const angleScore = scoreAngleContinuity(from.dominantAngleDeg, to.dominantAngleDeg);
  const magnitudeScore = scoreMagnitudeContinuity(from.dominantMagnitude, to.dominantMagnitude);
  const coherenceScore = scorePairAverage(from.motionCoherence, to.motionCoherence, 0.5);
  const cameraTypeScore = scoreCameraMotionType(from.cameraMotionType, to.cameraMotionType);

  const rawScore = angleScore * 0.35 + magnitudeScore * 0.2 + coherenceScore * 0.2 + cameraTypeScore * 0.25;
  return roundScore(rawScore * confidence);
}

export function buildMotionRankedCandidate(params: {
  id: string;
  musicalScore: number;
  fitPenalty?: number;
  from: MotionDescriptor | null;
  to: MotionDescriptor | null;
}): RankedSegmentCandidate {
  const { id, musicalScore, fitPenalty, from, to } = params;
  return {
    id,
    musicalScore,
    continuityScore: scoreMotionContinuity({ from, to }),
    fitPenalty,
  };
}

function scoreAngleContinuity(left: number | null, right: number | null) {
  if (left === null || right === null) return 0.5;
  const delta = Math.abs(left - right);
  const wrappedDelta = Math.min(delta, 360 - delta);
  return 1 - wrappedDelta / 180;
}

function scoreMagnitudeContinuity(left: number | null, right: number | null) {
  if (left === null || right === null) return 0.5;
  return 1 - Math.min(1, Math.abs(left - right));
}

function scorePairAverage(left: number | null, right: number | null, fallback: number) {
  if (left === null || right === null) return fallback;
  return Math.max(0, Math.min(1, (left + right) / 2));
}

function scoreCameraMotionType(left: MotionDescriptor["cameraMotionType"], right: MotionDescriptor["cameraMotionType"]) {
  if (left === right) return 1;
  if (left === "unknown" || right === "unknown") return 0.5;
  if (left === "mixed" || right === "mixed") return 0.4;
  return 0.15;
}

function roundScore(value: number) {
  return Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000;
}
