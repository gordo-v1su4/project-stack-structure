import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ComposeTab } from "@/components/studio/panels/ComposeTab";
import {
  describeMusicVideoShaderPreset,
  MUSIC_VIDEO_SHADER_PRESETS,
  SHADER_CUE_KINDS,
  type ShaderEffectCue,
} from "@/components/studio/shaderEffectPlan";

function renderCompose(props: Partial<Parameters<typeof ComposeTab>[0]> = {}) {
  const baseProps = {
    analysis: null,
    storyGenerated: true,
    editSlotCount: 3,
    storySegmentCount: 4,
    lyricChunkCount: 2,
    videoSourceCount: 3,
    shaderPresetId: "high-energy-glitch",
    shaderPresetSummary: describeMusicVideoShaderPreset("high-energy-glitch"),
    finalExportStatus: "idle",
    finalExportError: null,
    finalExportUrl: null,
    finalExportName: null,
    finalExportCueCount: 0,
    finalExportDisabledReason: null,
    isFinalExporting: false,
    isShaderCaptureExporting: false,
    onShaderPresetId: () => {},
    onFinalExport: () => {},
    onWebGpuExport: () => {},
    onSelectStory: () => {},
  };
  return renderToStaticMarkup(createElement(ComposeTab, { ...baseProps, ...props }));
}

const sampleCues: ShaderEffectCue[] = [
  { id: "section-0", kind: "duotone-pulse", start: 0, end: 1.5, intensity: 0.65, sync: "section" },
  { id: "beat-0-1", kind: "glitch-cut", start: 0.25, end: 0.47, intensity: 0.85, sync: "beat" },
  { id: "lyric-0", kind: "datamosh-lite", start: 0.5, end: 1.1, intensity: 1, sync: "lyric" },
];

describe("ComposeTab effects UI", () => {
  test("S4a: explains the selected treatment with its description and engine", () => {
    const markup = renderCompose();
    const preset = MUSIC_VIDEO_SHADER_PRESETS.find((entry) => entry.id === "high-energy-glitch")!;

    expect(markup).toContain(preset.label);
    expect(markup).toContain(preset.description);
    expect(markup).toContain("WebGPU/WGSL + FFmpeg server export");
  });

  test("S4b: renders compact chips for every preview effect cue", () => {
    const markup = renderCompose({ shaderEffectCues: sampleCues });

    const chipCount = markup.split('data-cue-chip=').length - 1;
    expect(chipCount).toBe(sampleCues.length);
    expect(markup).toContain("duotone-pulse");
    expect(markup).toContain("glitch-cut");
    expect(markup).toContain("lyric");
  });

  test("S4c: offers beat/section/lyric accent selects covering every shader cue kind", () => {
    const markup = renderCompose({
      shaderEffectCues: sampleCues,
      accentKinds: { beat: "glitch-cut" },
    });

    for (const lane of ["beat", "section", "lyric"]) {
      expect(markup).toContain(`data-accent-select="${lane}"`);
    }
    for (const kind of SHADER_CUE_KINDS) {
      expect(markup).toContain(`value="${kind}"`);
    }
    // Explicit override wins over the preset default for that lane.
    expect(markup).toMatch(/data-accent-select="beat"[^]*?selected[^]*?value="glitch-cut"|value="glitch-cut"[^]*?selected/);
  });

  test("keeps the stutter shader runtime chips for the selected treatment", () => {
    const markup = renderCompose();

    expect(markup).toContain("Stutter shader runtime");
    expect(markup).toContain("Stutter Glitch"); // block-tear/glitch tokens map to the stutter-glitch family
  });
});
