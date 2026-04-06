import { readFile } from "node:fs/promises";

import type { LatencyBenchmarkResult } from "./latencyBenchmark";

export interface BenchmarkComparisonResult {
  local: LatencyBenchmarkResult;
  remote: LatencyBenchmarkResult;
  deltas: {
    probeMs: number;
    previewGenerationMs: number;
    readyToPlayMs: number;
  };
  fasterLane: "local" | "remote" | "tie";
}

export async function compareBenchmarkFiles(localPath: string, remotePath: string) {
  const [local, remote] = await Promise.all([readBenchmarkFile(localPath), readBenchmarkFile(remotePath)]);
  return compareBenchmarks(local, remote);
}

export function compareBenchmarks(local: LatencyBenchmarkResult, remote: LatencyBenchmarkResult): BenchmarkComparisonResult {
  const deltas = {
    probeMs: roundDelta(local.probeDurationMs - remote.probeDurationMs),
    previewGenerationMs: roundDelta((local.previewDurationMs ?? 0) - (remote.previewDurationMs ?? 0)),
    readyToPlayMs: roundDelta((local.readyToPlayDurationMs ?? 0) - (remote.readyToPlayDurationMs ?? 0)),
  };

  const fasterLane = deltas.readyToPlayMs === 0 ? "tie" : deltas.readyToPlayMs < 0 ? "local" : "remote";

  return {
    local,
    remote,
    deltas,
    fasterLane,
  };
}

async function readBenchmarkFile(filePath: string): Promise<LatencyBenchmarkResult> {
  const raw = await readFile(filePath, "utf8");
  const start = raw.indexOf("{");
  return JSON.parse(start >= 0 ? raw.slice(start) : raw) as LatencyBenchmarkResult;
}

function roundDelta(value: number) {
  return Math.round(value * 100) / 100;
}
