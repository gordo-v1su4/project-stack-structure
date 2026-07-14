import { describe, expect } from "bun:test";
import { rm } from "node:fs/promises";

import { generateMusicVideoExport, type ShaderEffectCue } from "@/components/studio/exportGeneration";
import { createTempPreviewPath, type ProbeFn } from "@/components/studio/previewGeneration";
import { probeMediaFile } from "@/components/studio/mediaProbe";
import { hasAudioVideoFixtures, listMediaFixtures, mediaFixtureTest } from "../helpers/mediaFixtures";

const exportProbeFn: ProbeFn = async (filePath) => {
  const result = await probeMediaFile(filePath);
  return { duration: result.duration, hasVideo: result.hasVideo, hasAudio: result.hasAudio };
};

describe("music video final export integration", () => {
  mediaFixtureTest(hasAudioVideoFixtures())("renders a downloadable video export with master audio and synced shader cues", async () => {
    const inventory = listMediaFixtures();
    const audioPath = inventory.audio[0];
    const videoPath = inventory.video[0];

    expect(Boolean(audioPath)).toBe(true);
    expect(Boolean(videoPath)).toBe(true);

    const outputPath = createTempPreviewPath("final-export-integration");
    const cues: ShaderEffectCue[] = [
      { id: "intro-flash", kind: "beat-flash", start: 0, end: 0.2, intensity: 0.6, sync: "beat", label: "Intro" },
      { id: "intro-warmth", kind: "section-warmth", start: 0, end: 1, intensity: 0.35, sync: "section", label: "Intro" },
    ];

    const asset = await generateMusicVideoExport({
      requestKey: "final-export-integration",
      audioPath: audioPath!,
      outputPath,
      segments: [
        {
          inputPath: videoPath!,
          startTime: 0,
          endTime: 1,
          musicStart: 0,
          musicEnd: 1,
          label: "Intro",
        },
      ],
      effectCues: cues,
      probeFn: exportProbeFn,
    });

    const metadata = await probeMediaFile(asset.outputPath);

    expect(asset.assetKey).toBe(outputPath);
    expect(asset.effectCues).toHaveLength(2);
    expect(asset.effectFilter).toContain("eq=");
    expect(asset.downloadFileName).toBe("final-export-integration.mp4");
    expect(metadata.hasVideo).toBe(true);
    expect(metadata.hasAudio).toBe(true);
    expect(metadata.duration).toBeGreaterThan(0.5);
    expect(metadata.duration).toBeLessThan(1.5);

    await rm(outputPath, { force: true });
  });
});
