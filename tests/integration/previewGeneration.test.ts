import { describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { hasAudioVideoFixtures, listMediaFixtures, mediaFixtureTest } from "../helpers/mediaFixtures";
import { probeMediaFile } from "../../src/components/studio/mediaProbe";
import {
  PreviewGenerationError,
  concatPreviewDurationTolerance,
  createTempPreviewPath,
  frameAlignedDuration,
  generateConcatPreview,
  generateSectionPreview,
  isPreviewDurationWithinTolerance,
  type ProbeFn,
} from "../../src/components/studio/previewGeneration";
import {
  createSectionRecomputeState,
  markSectionReady,
  startSectionRecompute,
  swapReadySection,
} from "../../src/components/studio/sectionRecompute";

const execFileAsync = promisify(execFile);

const testProbeFn: ProbeFn = async (filePath) => {
  const result = await probeMediaFile(filePath);
  return { duration: result.duration, hasVideo: result.hasVideo };
};

describe("previewGeneration integration", () => {
  mediaFixtureTest(hasAudioVideoFixtures())("generates a prepared preview asset from a real video fixture", async () => {
    const inventory = listMediaFixtures();
    const inputPath = inventory.video[0]!;
    const outputPath = createTempPreviewPath("preview-test");

    const asset = await generateSectionPreview({
      inputPath,
      outputPath,
      requestKey: "preview-test",
      startTime: 0,
      endTime: 1,
      probeFn: testProbeFn,
    });

    const metadata = await probeMediaFile(asset.outputPath);

    expect(asset.requestKey).toBe("preview-test");
    expect(asset.assetKey).toBe(outputPath);
    expect(metadata.hasVideo).toBe(true);
    expect(metadata.duration).toBeGreaterThan(0.5);
    expect(metadata.duration).toBeLessThan(1.5);

    await rm(outputPath, { force: true });
  });

  mediaFixtureTest(hasAudioVideoFixtures())("returns metadata that fits a section-scoped request", async () => {
    const inventory = listMediaFixtures();
    const inputPath = inventory.video[0]!;
    const outputPath = createTempPreviewPath("preview-section");

    const asset = await generateSectionPreview({
      inputPath,
      outputPath,
      requestKey: "preview-section",
      startTime: 0.5,
      endTime: 1.25,
      probeFn: testProbeFn,
    });

    expect(asset.startTime).toBe(0.5);
    expect(asset.endTime).toBe(1.25);
    expect(asset.duration).toBeGreaterThan(0.5);
    expect(asset.duration).toBeLessThan(1.1);

    await rm(outputPath, { force: true });
  });

  mediaFixtureTest(hasAudioVideoFixtures())("fails cleanly on an invalid time window", async () => {
    const inventory = listMediaFixtures();
    const error = await capturePreviewError(() =>
      generateSectionPreview({
        inputPath: inventory.video[0]!,
        requestKey: "bad-window",
        startTime: 1,
        endTime: 1,
        probeFn: testProbeFn,
      }),
    );

    expect(error).toBeInstanceOf(PreviewGenerationError);
    expect(error?.code).toBe("invalid-window");
  });

  test("fails cleanly on a missing input file", async () => {
    const error = await capturePreviewError(() =>
      generateSectionPreview({
        inputPath: "/tmp/does-not-exist.mp4",
        requestKey: "missing-input",
        startTime: 0,
        endTime: 1,
        probeFn: testProbeFn,
      }),
    );

    expect(error).toBeInstanceOf(PreviewGenerationError);
    expect(error?.code).toBe("missing-input");
  });

  test("frame-aligns segment durations and uses a constant two-frame concat tolerance", () => {
    expect(frameAlignedDuration(0.5)).toBe(0.5);
    expect(frameAlignedDuration(0.52)).toBe(0.5);
    expect(frameAlignedDuration(0)).toBeGreaterThan(0);
    expect(frameAlignedDuration(246.685)).toBeCloseTo(246.667, 3);

    expect(concatPreviewDurationTolerance(1)).toBeCloseTo(2 / 24, 3);
    expect(concatPreviewDurationTolerance(155)).toBeCloseTo(2 / 24, 3);
  });

  mediaFixtureTest(hasAudioVideoFixtures())("rejects audio-only input for video preview generation", async () => {
    const inventory = listMediaFixtures();
    const error = await capturePreviewError(() =>
      generateSectionPreview({
        inputPath: inventory.audio[0]!,
        requestKey: "audio-only",
        startTime: 0,
        endTime: 1,
        probeFn: testProbeFn,
      }),
    );

    expect(error).toBeInstanceOf(PreviewGenerationError);
    expect(error?.code).toBe("audio-only-input");
  });


  mediaFixtureTest(hasAudioVideoFixtures())("matches the requested music window within tolerance", async () => {
    const inventory = listMediaFixtures();
    const outputPath = createTempPreviewPath("preview-music-window");

    const asset = await generateSectionPreview({
      inputPath: inventory.video[0]!,
      outputPath,
      requestKey: "preview-music-window",
      startTime: 0,
      endTime: 1,
      probeFn: testProbeFn,
    });

    expect(isPreviewDurationWithinTolerance(asset.duration, 1)).toBe(true);

    await rm(outputPath, { force: true });
  });

  mediaFixtureTest(hasAudioVideoFixtures())("normalizes mixed source formats without accumulating concat timestamp drift", async () => {
    const inventory = listMediaFixtures();
    const source = inventory.video.find((entry) => path.basename(entry) === "real-original-video-a.mp4") ?? inventory.video[0]!;
    const workspace = await mkdtemp(path.join(tmpdir(), "preview-mixed-concat-"));
    try {
      const transcoded = path.join(workspace, "source-30fps-640x360.mp4");
      await execFileAsync("ffmpeg", [
        "-hide_banner", "-loglevel", "error", "-y", "-i", source,
        "-t", "4", "-vf", "fps=30,scale=640:360", "-an", "-c:v", "libx264", transcoded,
      ]);

      const segments = Array.from({ length: 12 }, (_, index) => ({
        inputPath: index % 2 === 0 ? source : transcoded,
        startTime: (index % 4) * 0.1,
        endTime: (index % 4) * 0.1 + 0.5,
      }));
      const outputPath = path.join(workspace, "mixed-preview.mp4");
      const asset = await generateConcatPreview({
        segments,
        requestKey: "mixed-format-duration-regression",
        outputPath,
        probeFn: testProbeFn,
      });

      expect(asset.duration).toBeCloseTo(6, 1);
      const metadata = await probeMediaFile(outputPath);
      expect(metadata.hasVideo).toBe(true);
      expect(metadata.duration).toBeCloseTo(6, 1);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }, 180_000);

  mediaFixtureTest(hasAudioVideoFixtures())("ready-only flow swaps only after a generated asset is marked ready", async () => {
    const inventory = listMediaFixtures();
    const outputPath = createTempPreviewPath("preview-ready-flow");
    const running = startSectionRecompute(createSectionRecomputeState(), {
      requestKey: "preview-ready-flow",
      sectionId: "verse",
      continuityMode: "motion",
      paramsHash: "hash-1",
      startedAt: new Date(0).toISOString(),
      progress: 0,
    });

    const asset = await generateSectionPreview({
      inputPath: inventory.video[0]!,
      outputPath,
      requestKey: "preview-ready-flow",
      startTime: 0,
      endTime: 1,
      probeFn: testProbeFn,
    });

    const ready = markSectionReady(running, asset);
    const swapped = swapReadySection(ready, asset.requestKey);

    expect(ready.currentAssetKey).toBeNull();
    expect(swapped.currentAssetKey).toBe(asset.assetKey);
    expect(swapped.stage).toBe("swapped");

    await rm(outputPath, { force: true });
  });
});


async function capturePreviewError(run: () => Promise<unknown>) {
  try {
    await run();
    throw new Error("Expected preview generation to fail.");
  } catch (error) {
    if (error instanceof PreviewGenerationError) return error;
    throw error;
  }
}
