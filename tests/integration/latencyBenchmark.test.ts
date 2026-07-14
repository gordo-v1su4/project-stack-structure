import { describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";

import { detectHardwareLane, runLatencyBenchmark } from "../../src/components/studio/latencyBenchmark";
import { hasAudioVideoFixtures, listMediaFixtures, mediaFixtureTest } from "../helpers/mediaFixtures";

describe("latencyBenchmark integration", () => {
  test("detects the local hardware lane", () => {
    const expected = process.env.TEST_HARDWARE_LANE || (process.platform === "darwin" ? "local-macos" : process.platform === "win32" ? "local-windows" : process.platform === "linux" ? "local-linux" : "unknown");
    expect(detectHardwareLane()).toBe(expected);
  });

  mediaFixtureTest(hasAudioVideoFixtures())("returns required timing and output fields on success", async () => {
    const result = await runLatencyBenchmark({ startTime: 0, endTime: 1, requestKey: "bench-test" });

    expect(result.requestKey).toBe("bench-test");
    expect(result.inputPath.length).toBeGreaterThan(0);
    expect(result.hardwareLane).toBe(process.env.TEST_HARDWARE_LANE || (process.platform === "darwin" ? "local-macos" : process.platform === "win32" ? "local-windows" : "local-linux"));
    expect(result.success).toBe(true);
    expect(result.outputPath).not.toBeNull();
    expect(result.probeStartedAt <= result.probeCompletedAt).toBe(true);
    expect(result.previewStartedAt !== null).toBe(true);
    expect(result.previewCompletedAt !== null).toBe(true);
    expect(result.probeDurationMs).toBeGreaterThanOrEqual(0);
    expect((result.previewDurationMs ?? 0)).toBeGreaterThanOrEqual(0);
    expect((result.readyToPlayDurationMs ?? 0)).toBeGreaterThanOrEqual(result.previewDurationMs ?? 0);
    expect((result.outputDuration ?? 0)).toBeGreaterThan(0.5);
    expect(result.notes.some((note) => note.startsWith("platform="))).toBe(true);

    if (result.outputPath) {
      await rm(result.outputPath, { force: true });
    }
  });

  test("respects explicit hardware lane override", async () => {
    const result = await runLatencyBenchmark({
      requestKey: "bench-override",
      startTime: 0,
      endTime: 1,
      hardwareLane: "remote-tailscale-rtx5090",
    });

    expect(result.hardwareLane).toBe("remote-tailscale-rtx5090");

    if (result.outputPath) {
      await rm(result.outputPath, { force: true });
    }
  });

  test("reports structured failure for missing input", async () => {
    const result = await runLatencyBenchmark({
      inputPath: "/tmp/does-not-exist.mp4",
      requestKey: "bench-missing",
      startTime: 0,
      endTime: 1,
    });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("missing-input");
    expect(result.outputPath).toBeNull();
    expect(result.previewStartedAt).not.toBeNull();
    expect(result.previewDurationMs).not.toBeNull();
    expect(result.readyToPlayDurationMs).toBeNull();
  });

  mediaFixtureTest(hasAudioVideoFixtures())("reports structured failure for invalid preview window", async () => {
    const result = await runLatencyBenchmark({
      requestKey: "bench-invalid-window",
      startTime: 1,
      endTime: 1,
    });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("invalid-window");
    expect(result.outputPath).toBeNull();
  });

  mediaFixtureTest(hasAudioVideoFixtures())("reports structured failure for audio-only input", async () => {
    const inventory = listMediaFixtures();
    const inputPath = inventory.audio.find((candidate) => /stem|vocal/i.test(candidate)) ?? inventory.audio[0];
    expect(Boolean(inputPath)).toBe(true);
    const result = await runLatencyBenchmark({
      inputPath: inputPath!,
      requestKey: "bench-audio-only",
      startTime: 0,
      endTime: 1,
    });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("audio-only-input");
  });
});
