import os from "node:os";

import { probeFixtureInventory } from "./mediaProbe";
import { createTempPreviewPath, generateSectionPreview, PreviewGenerationError } from "./previewGeneration";

export type HardwareLane = string;

export interface LatencyBenchmarkResult {
  requestKey: string;
  inputPath: string;
  outputPath: string | null;
  fixtureRootDir: string;
  hardwareLane: HardwareLane;
  success: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  probeStartedAt: string;
  probeCompletedAt: string;
  previewStartedAt: string | null;
  previewCompletedAt: string | null;
  probeDurationMs: number;
  previewDurationMs: number | null;
  readyToPlayDurationMs: number | null;
  outputDuration: number | null;
  sectionWindow: {
    startTime: number;
    endTime: number;
  };
  notes: string[];
}

export interface LatencyBenchmarkParams {
  inputPath?: string;
  startTime?: number;
  endTime?: number;
  requestKey?: string;
  hardwareLane?: HardwareLane;
  notes?: string[];
}

export async function runLatencyBenchmark(params: LatencyBenchmarkParams = {}): Promise<LatencyBenchmarkResult> {
  const probeStartedAt = new Date().toISOString();
  const probeStart = performance.now();
  const probed = await probeFixtureInventory();
  const probeCompletedAt = new Date().toISOString();
  const probeDurationMs = roundMs(performance.now() - probeStart);

  const inputPath = params.inputPath ?? probed.inventory.video[0];
  const startTime = params.startTime ?? 0;
  const endTime = params.endTime ?? Math.max(1, startTime + 1);
  const requestKey = params.requestKey ?? `benchmark-${Date.now()}`;
  const hardwareLane = params.hardwareLane ?? detectHardwareLane();
  const notes = [...(params.notes ?? []), `platform=${process.platform}`, `hostname=${os.hostname()}`];

  if (!inputPath) {
    return {
      requestKey,
      inputPath: "",
      outputPath: null,
      fixtureRootDir: probed.inventory.rootDir,
      hardwareLane,
      success: false,
      errorCode: "missing-input",
      errorMessage: "No video fixture available for latency benchmarking.",
      probeStartedAt,
      probeCompletedAt,
      previewStartedAt: null,
      previewCompletedAt: null,
      probeDurationMs,
      previewDurationMs: null,
      readyToPlayDurationMs: null,
      outputDuration: null,
      sectionWindow: { startTime, endTime },
      notes,
    };
  }

  const outputPath = createTempPreviewPath(requestKey);
  const previewStartedAt = new Date().toISOString();
  const previewStart = performance.now();

  try {
    const preview = await generateSectionPreview({
      inputPath,
      requestKey,
      startTime,
      endTime,
      outputPath,
    });
    const previewCompletedAt = new Date().toISOString();
    const previewDurationMs = roundMs(performance.now() - previewStart);

    return {
      requestKey,
      inputPath,
      outputPath,
      fixtureRootDir: probed.inventory.rootDir,
      hardwareLane,
      success: true,
      errorCode: null,
      errorMessage: null,
      probeStartedAt,
      probeCompletedAt,
      previewStartedAt,
      previewCompletedAt,
      probeDurationMs,
      previewDurationMs,
      readyToPlayDurationMs: previewDurationMs,
      outputDuration: preview.duration,
      sectionWindow: { startTime, endTime },
      notes,
    };
  } catch (error) {
    const previewCompletedAt = new Date().toISOString();
    const previewDurationMs = roundMs(performance.now() - previewStart);
    const normalized = normalizeBenchmarkError(error);

    return {
      requestKey,
      inputPath,
      outputPath: null,
      fixtureRootDir: probed.inventory.rootDir,
      hardwareLane,
      success: false,
      errorCode: normalized.code,
      errorMessage: normalized.message,
      probeStartedAt,
      probeCompletedAt,
      previewStartedAt,
      previewCompletedAt,
      probeDurationMs,
      previewDurationMs,
      readyToPlayDurationMs: null,
      outputDuration: null,
      sectionWindow: { startTime, endTime },
      notes,
    };
  }
}

export function detectHardwareLane(): HardwareLane {
  if (process.env.TEST_HARDWARE_LANE?.trim()) return process.env.TEST_HARDWARE_LANE;
  if (process.platform === "darwin") return "local-macos";
  if (process.platform === "linux") return "local-linux";
  if (process.platform === "win32") return "local-windows";
  return "unknown";
}

function normalizeBenchmarkError(error: unknown) {
  if (error instanceof PreviewGenerationError) {
    return { code: error.code, message: error.message };
  }

  if (error instanceof Error) {
    return { code: "unknown", message: error.message };
  }

  return { code: "unknown", message: "Unknown benchmark failure" };
}

function roundMs(value: number) {
  return Math.round(value * 100) / 100;
}
