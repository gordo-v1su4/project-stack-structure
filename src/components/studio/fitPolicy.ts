export type FitDecision = "accept" | "trim" | "speed-ramp" | "overlap" | "reject";

export interface FitPolicyResult {
  decision: FitDecision;
  penalty: number;
  targetDuration: number;
  sourceDuration: number;
  adjustedDuration: number;
  speedRatio: number;
  overlapDuration: number;
  trimAmount: number;
  reason: string;
}

export interface FitPolicyParams {
  sourceDuration: number;
  targetDuration: number;
  exactTolerance?: number;
  trimTolerance?: number;
  maxSpeedRampDelta?: number;
  allowTrim?: boolean;
  allowSpeedRamp?: boolean;
  allowOverlap?: boolean;
  canOverlap?: boolean;
}

export function resolveFitPolicy(params: FitPolicyParams): FitPolicyResult {
  const {
    sourceDuration,
    targetDuration,
    exactTolerance = 0.02,
    trimTolerance = 0.2,
    maxSpeedRampDelta = 0.15,
    allowTrim = true,
    allowSpeedRamp = true,
    allowOverlap = true,
    canOverlap = false,
  } = params;

  const safeSourceDuration = Math.max(0, sourceDuration);
  const safeTargetDuration = Math.max(0, targetDuration);
  const durationDelta = safeSourceDuration - safeTargetDuration;
  const absDelta = Math.abs(durationDelta);

  if (safeSourceDuration <= 0 || safeTargetDuration <= 0) {
    return buildResult({
      decision: "reject",
      penalty: 1,
      sourceDuration: safeSourceDuration,
      targetDuration: safeTargetDuration,
      adjustedDuration: safeSourceDuration,
      speedRatio: 1,
      overlapDuration: 0,
      trimAmount: 0,
      reason: "Source or target duration is invalid.",
    });
  }

  if (absDelta <= exactTolerance) {
    return buildResult({
      decision: "accept",
      penalty: 0,
      sourceDuration: safeSourceDuration,
      targetDuration: safeTargetDuration,
      adjustedDuration: safeSourceDuration,
      speedRatio: 1,
      overlapDuration: 0,
      trimAmount: 0,
      reason: "Source duration already fits the target window.",
    });
  }

  if (allowTrim && absDelta <= trimTolerance) {
    return buildResult({
      decision: "trim",
      penalty: roundPenalty(absDelta / Math.max(trimTolerance, 0.0001) * 0.35),
      sourceDuration: safeSourceDuration,
      targetDuration: safeTargetDuration,
      adjustedDuration: safeTargetDuration,
      speedRatio: 1,
      overlapDuration: 0,
      trimAmount: absDelta,
      reason: "Trim can make the segment fit without violating musicality.",
    });
  }

  const speedRatio = safeTargetDuration / safeSourceDuration;
  const speedDelta = Math.abs(1 - speedRatio);
  if (allowSpeedRamp && speedDelta <= maxSpeedRampDelta) {
    return buildResult({
      decision: "speed-ramp",
      penalty: roundPenalty(speedDelta * 0.8),
      sourceDuration: safeSourceDuration,
      targetDuration: safeTargetDuration,
      adjustedDuration: safeTargetDuration,
      speedRatio: roundPenalty(speedRatio),
      overlapDuration: 0,
      trimAmount: 0,
      reason: "A bounded speed ramp can preserve the musical hit while fitting the target.",
    });
  }

  if (allowOverlap && canOverlap && durationDelta > 0) {
    return buildResult({
      decision: "overlap",
      penalty: roundPenalty(Math.min(0.75, durationDelta / safeSourceDuration)),
      sourceDuration: safeSourceDuration,
      targetDuration: safeTargetDuration,
      adjustedDuration: safeTargetDuration,
      speedRatio: 1,
      overlapDuration: durationDelta,
      trimAmount: 0,
      reason: "Overlap is required because trim and speed ramp exceed the allowed fit budget.",
    });
  }

  return buildResult({
    decision: "reject",
    penalty: 1,
    sourceDuration: safeSourceDuration,
    targetDuration: safeTargetDuration,
    adjustedDuration: safeSourceDuration,
    speedRatio: 1,
    overlapDuration: 0,
    trimAmount: 0,
    reason: "The segment cannot fit the target within the current trim/ramp/overlap policy.",
  });
}

function buildResult(result: FitPolicyResult): FitPolicyResult {
  return result;
}

function roundPenalty(value: number) {
  return Math.round(value * 1000) / 1000;
}
