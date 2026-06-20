import { describe, expect, test } from "bun:test";

import {
  buildStutterRuntimePlan,
  getStutterShaderDefinition,
  mapPresetTokenToStutterShaderId,
  STUTTER_SHADER_CATALOG,
} from "@/components/studio/stutterShaderCatalog";
import { buildAutoShaderCues, describeMusicVideoShaderPreset } from "@/components/studio/shaderEffectPlan";

describe("stutter shader catalog", () => {
  test("provides WebGPU/WGSL shader definitions adapted from Stutterblaster", () => {
    expect(STUTTER_SHADER_CATALOG.length).toBeGreaterThanOrEqual(4);
    const glitch = getStutterShaderDefinition("stutter-glitch");

    expect(glitch.engine).toBe("webgpu-wgsl");
    expect(glitch.wgslEntry).toBe("stutterCompositor");
    expect(glitch.wgslSource).toContain("texture_external");
    expect(glitch.columns.some((column) => column.id === "generate" && column.effect === "glitch")).toBe(true);
  });

  test("maps music-video preset tokens to Stutter shader ids", () => {
    expect(mapPresetTokenToStutterShaderId("block-tear")).toBe("stutter-glitch");
    expect(mapPresetTokenToStutterShaderId("vhs-classic")).toBe("stutter-vhs");
    expect(mapPresetTokenToStutterShaderId("clean-crt")).toBe("stutter-crt");
    expect(mapPresetTokenToStutterShaderId("dream-bloom")).toBe("stutter-bloom");
  });

  test("builds compact cue runtime plans without duplicating WGSL source", () => {
    const plan = buildStutterRuntimePlan({
      cueId: "beat-1",
      presetId: "block-tear",
      start: 1,
      end: 1.25,
      intensity: 0.9,
    });

    expect(plan).toMatchObject({
      cueId: "beat-1",
      shaderId: "stutter-glitch",
      engine: "webgpu-wgsl",
      wgslEntry: "stutterCompositor",
    });
    expect(JSON.stringify(plan)).not.toContain("texture_external");
    expect(plan.columns[0]?.mix).toBeGreaterThan(0.5);
  });

  test("attaches Stutter runtime metadata to auto shader cues for explicit server export", () => {
    const cues = buildAutoShaderCues({
      segments: [{ startTime: 0, endTime: 2, musicStart: 0, musicEnd: 2, label: "Chorus" }],
      beats: [0, 1],
      presetId: "high-energy-glitch",
    });

    expect(cues.some((cue) => cue.runtimePlan?.shaderId === "stutter-glitch")).toBe(true);
    expect(cues.every((cue) => cue.runtimePlan?.engine === "webgpu-wgsl")).toBe(true);
  });

  test("describes selected Story export preset shader families for UI", () => {
    const summary = describeMusicVideoShaderPreset("analog-tape");

    expect(summary.engine).toContain("WebGPU/WGSL");
    expect(summary.shaders.map((shader) => shader.id)).toContain("stutter-vhs");
    expect(summary.shaders.map((shader) => shader.id)).toContain("stutter-crt");
  });
});
