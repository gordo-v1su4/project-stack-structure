import { describe, expect, test } from "bun:test";

import {
  buildAutoShaderCues,
  buildFfmpegShaderFilter,
  normalizeExportSegments,
} from "@/components/studio/exportGeneration";

describe("exportGeneration shader cue planning", () => {
  test("normalizes edit-plan segments and derives beat/section synced shader cues", () => {
    const segments = normalizeExportSegments([
      { inputPath: "/tmp/a.mp4", startTime: -1, endTime: 1.25, musicStart: 10, musicEnd: 11.25, label: "Intro" },
      { inputPath: "/tmp/b.mp4", startTime: 2, endTime: 4, musicStart: 11.25, musicEnd: 13.25, label: "Chorus" },
      { inputPath: "", startTime: 0, endTime: 1 },
    ]);

    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ startTime: 0, endTime: 1.25, musicStart: 10, musicEnd: 11.25 });

    const cues = buildAutoShaderCues(segments, { beats: [10, 11.5], lyricChunks: [{ id: "hook", start: 10.2, end: 10.7, text: "love" }], presetId: "high-energy-glitch" });

    expect(cues.length).toBeGreaterThanOrEqual(5);
    expect(cues[0]).toMatchObject({ kind: "duotone-pulse", sync: "section", start: 0, end: 1.25, presetId: "block-tear" });
    expect(cues.some((cue) => cue.kind === "glitch-cut" && cue.sync === "beat" && cue.presetId === "glitch-cut")).toBe(true);
    expect(cues.some((cue) => cue.kind === "datamosh-lite" && cue.sync === "lyric" && cue.presetId === "tape-tracking-storm")).toBe(true);
  });

  test("builds an ffmpeg filter chain from shader-style cues", () => {
    const filter = buildFfmpegShaderFilter([
      { id: "beat", kind: "beat-flash", start: 0, end: 0.2, intensity: 0.8, sync: "beat" },
      { id: "section", kind: "film-halation", start: 0, end: 2, intensity: 0.3, sync: "section", presetId: "warm-halation" },
      { id: "glitch", kind: "glitch-cut", start: 0.4, end: 0.6, intensity: 0.8, sync: "beat", presetId: "glitch-cut" },
      { id: "bad", kind: "lyric-glow", start: 2, end: 2, intensity: 1, sync: "lyric" },
    ]);

    expect(filter).toContain("eq=");
    expect(filter).toContain("gamma_r=");
    expect(filter).toContain("rgbashift=");
    expect(filter).toContain("between(t");
    expect(filter).not.toContain("bad");
  });
});
