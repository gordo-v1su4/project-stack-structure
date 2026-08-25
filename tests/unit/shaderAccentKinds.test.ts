import { describe, expect, test } from "bun:test";

import {
  buildAutoShaderCues,
  MUSIC_VIDEO_SHADER_PRESETS,
  SHADER_CUE_KINDS,
  type ShaderCueKind,
} from "@/components/studio/shaderEffectPlan";

describe("accent kind overrides", () => {
  const segments = [
    { startTime: 0, endTime: 2, musicStart: 10, musicEnd: 12, label: "Intro" },
  ];

  test("exposes every shader cue kind for UI selection", () => {
    expect([...SHADER_CUE_KINDS].sort()).toEqual(
      [
        "beat-flash",
        "section-warmth",
        "lyric-glow",
        "glitch-cut",
        "datamosh-lite",
        "film-halation",
        "duotone-pulse",
      ].sort() as ShaderCueKind[],
    );
  });

  test("without overrides cues follow the preset's fixed beat/section/lyric kinds", () => {
    const preset = MUSIC_VIDEO_SHADER_PRESETS.find((entry) => entry.id === "high-energy-glitch")!;
    const cues = buildAutoShaderCues({ segments, beats: [10.5], presetId: "high-energy-glitch" });

    expect(cues.some((cue) => cue.sync === "section" && cue.kind === preset.sectionKind)).toBe(true);
    expect(cues.some((cue) => cue.sync === "beat" && cue.kind === preset.beatKind)).toBe(true);
  });

  test("overrides swap the accent kind per sync lane while keeping timing and intensity", () => {
    const preset = MUSIC_VIDEO_SHADER_PRESETS.find((entry) => entry.id === "high-energy-glitch")!;
    const baseline = buildAutoShaderCues({ segments, beats: [10.5], presetId: "high-energy-glitch" });
    const overridden = buildAutoShaderCues({
      segments,
      beats: [10.5],
      presetId: "high-energy-glitch",
      accentKinds: { beat: "beat-flash", lyric: "film-halation", section: "duotone-pulse" },
    });

    const baselineBeat = baseline.find((cue) => cue.sync === "beat")!;
    const overriddenBeat = overridden.find((cue) => cue.sync === "beat")!;
    expect(overriddenBeat.kind).toBe("beat-flash");
    // Kind override swaps the ffmpeg filter lane; runtime shader rotation stays with the treatment.
    expect(preset.shaderPresetIds).toContain(overriddenBeat.presetId!);
    expect([overriddenBeat.start, overriddenBeat.end]).toEqual([baselineBeat.start, baselineBeat.end]);

    expect(overridden.find((cue) => cue.sync === "lyric")).toBe(undefined); // no lyric chunks supplied
    const section = overridden.find((cue) => cue.sync === "section")!;
    expect(section.kind).toBe("duotone-pulse");
    expect(section.shaderId !== undefined).toBe(true);
  });

  test("partial overrides leave other lanes on the preset defaults", () => {
    const preset = MUSIC_VIDEO_SHADER_PRESETS.find((entry) => entry.id === "high-energy-glitch")!;
    const cues = buildAutoShaderCues({
      segments,
      beats: [10.5],
      presetId: "high-energy-glitch",
      accentKinds: { beat: "beat-flash" },
    });

    expect(cues.find((cue) => cue.sync === "beat")!.kind).toBe("beat-flash");
    expect(cues.find((cue) => cue.sync === "section")!.kind).toBe(preset.sectionKind);
  });
});
