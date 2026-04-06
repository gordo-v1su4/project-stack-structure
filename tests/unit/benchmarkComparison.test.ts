import { describe, expect, test } from "bun:test";

import { compareBenchmarks } from "../../src/components/studio/benchmarkComparison";
import type { LatencyBenchmarkResult } from "../../src/components/studio/latencyBenchmark";

function makeBenchmark(overrides: Partial<LatencyBenchmarkResult> = {}): LatencyBenchmarkResult {
  return {
    requestKey: "req",
    inputPath: "/tmp/input.mp4",
    outputPath: "/tmp/output.mp4",
    fixtureRootDir: "/tmp/fixtures",
    hardwareLane: "local-macos",
    success: true,
    errorCode: null,
    errorMessage: null,
    probeStartedAt: new Date(0).toISOString(),
    probeCompletedAt: new Date(1).toISOString(),
    previewStartedAt: new Date(1).toISOString(),
    previewCompletedAt: new Date(2).toISOString(),
    probeDurationMs: 100,
    previewDurationMs: 200,
    readyToPlayDurationMs: 200,
    outputDuration: 1,
    sectionWindow: { startTime: 0, endTime: 1 },
    notes: [],
    ...overrides,
  };
}

describe("benchmarkComparison", () => {
  test("computes deltas and identifies the faster lane", () => {
    const local = makeBenchmark({ hardwareLane: "local-macos", previewDurationMs: 200, readyToPlayDurationMs: 200 });
    const remote = makeBenchmark({ hardwareLane: "remote-tailscale-rtx5090", previewDurationMs: 120, readyToPlayDurationMs: 120 });

    const result = compareBenchmarks(local, remote);

    expect(result.deltas.previewGenerationMs).toBe(80);
    expect(result.fasterLane).toBe("remote");
  });
});
