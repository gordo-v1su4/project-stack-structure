import { describe, expect, test } from "bun:test";

import { resolveFitPolicy } from "../../src/components/studio/fitPolicy";

describe("fitPolicy", () => {
  test("accepts a source duration already within tolerance", () => {
    const result = resolveFitPolicy({ sourceDuration: 4.01, targetDuration: 4, exactTolerance: 0.02 });

    expect(result.decision).toBe("accept");
    expect(result.penalty).toBe(0);
  });

  test("uses trim when the duration delta is within trim tolerance", () => {
    const result = resolveFitPolicy({ sourceDuration: 4.14, targetDuration: 4, trimTolerance: 0.2 });

    expect(result.decision).toBe("trim");
    expect(result.trimAmount).toBeCloseTo(0.14, 3);
    expect(result.penalty).toBeGreaterThan(0);
  });

  test("uses speed-ramp when trim is insufficient but ramp delta is acceptable", () => {
    const result = resolveFitPolicy({
      sourceDuration: 4.6,
      targetDuration: 4,
      trimTolerance: 0.1,
      maxSpeedRampDelta: 0.2,
    });

    expect(result.decision).toBe("speed-ramp");
    expect(result.speedRatio).toBeLessThan(1);
  });

  test("uses overlap when enabled and the segment is longer than the target", () => {
    const result = resolveFitPolicy({
      sourceDuration: 5.2,
      targetDuration: 4,
      trimTolerance: 0.1,
      maxSpeedRampDelta: 0.05,
      allowOverlap: true,
      canOverlap: true,
    });

    expect(result.decision).toBe("overlap");
    expect(result.overlapDuration).toBeGreaterThan(0);
  });

  test("rejects when no fit strategy is allowed", () => {
    const result = resolveFitPolicy({
      sourceDuration: 5,
      targetDuration: 4,
      allowTrim: false,
      allowSpeedRamp: false,
      allowOverlap: false,
      canOverlap: false,
    });

    expect(result.decision).toBe("reject");
    expect(result.penalty).toBe(1);
  });
});
