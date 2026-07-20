import { describe, expect, test } from "bun:test";

import { buildStutterRuntimePlan } from "@/components/studio/stutterShaderCatalog";
import {
  buildStutterCanvas2dStyle,
  buildStutterUniforms,
  selectActiveStutterRuntimePlan,
} from "@/components/studio/stutterWebGpuPreview";
import type { ShaderEffectCue } from "@/components/studio/shaderEffectPlan";

describe("Stutter WebGPU preview runtime", () => {
  test("selects the strongest active runtime cue for the output playhead", () => {
    const sectionPlan = buildStutterRuntimePlan({
      cueId: "section",
      presetId: "cinema-grade",
      start: 0,
      end: 8,
      intensity: 0.4,
    });
    const beatPlan = buildStutterRuntimePlan({
      cueId: "beat",
      presetId: "glitch-cut",
      start: 2,
      end: 2.2,
      intensity: 0.8,
    });
    const cues: ShaderEffectCue[] = [
      {
        id: "section",
        kind: "film-halation",
        sync: "section",
        start: 0,
        end: 8,
        intensity: 0.4,
        runtimePlan: sectionPlan,
      },
      {
        id: "beat",
        kind: "glitch-cut",
        sync: "beat",
        start: 2,
        end: 2.2,
        intensity: 0.8,
        runtimePlan: beatPlan,
      },
    ];

    expect(selectActiveStutterRuntimePlan(cues, 1)?.cueId).toBe("section");
    expect(selectActiveStutterRuntimePlan(cues, 2.05)?.cueId).toBe("beat");
    expect(selectActiveStutterRuntimePlan(cues, 9)).toBeNull();
  });

  test("packs Stutter cue columns into the 8 vec4 uniform contract", () => {
    const plan = buildStutterRuntimePlan({
      cueId: "glitch",
      presetId: "glitch-cut",
      start: 10,
      end: 11,
      intensity: 0.75,
    });

    const uniforms = buildStutterUniforms(plan, 10.5);

    expect(uniforms).toBeInstanceOf(Float32Array);
    expect(uniforms.length).toBe(32);
    expect(uniforms[0]).toBe(10.5);
    expect(uniforms[20]).toBe(0); // generate glitch effect code
    expect(uniforms[21]).toBeGreaterThan(0); // generate mix
    expect(uniforms[22]).toBeGreaterThan(0); // generate intensity
    expect(uniforms.byteLength).toBe(128);
  });

  test("builds a visible software fallback when WebGPU is unavailable", () => {
    const plan = buildStutterRuntimePlan({
      cueId: "software-fallback",
      presetId: "glitch-cut",
      start: 2,
      end: 3,
      intensity: 0.8,
    });

    const style = buildStutterCanvas2dStyle(plan, 2.25);

    expect(style.filter).not.toBe("none");
    expect(style.scale).toBeGreaterThan(0);
    expect(Math.abs(style.translateX) + Math.abs(style.translateY)).toBeGreaterThan(0);
  });
});
