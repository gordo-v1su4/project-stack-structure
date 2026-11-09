import { describe, expect, test } from "bun:test";

import { buildStutterRuntimePlan } from "@/components/studio/stutterShaderCatalog";
import {
  buildStutterCanvas2dStyle,
  buildStutterUniforms,
  selectActiveStutterRuntimePlan,
  StutterWebGpuPreviewRenderer,
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

test("WebGPU effects import the canonical canvas through a temporary frame and close it even when submission fails", async () => {
  const keys = ["navigator", "VideoFrame", "GPUBufferUsage", "GPUTextureUsage"] as const;
  const original = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let opened = 0, closed = 0, imported: unknown = null, failSubmit = false;
  const source = { width: 1344, height: 768 } as HTMLCanvasElement;
  class SnapshotFrame {
    constructor(readonly input: unknown) { expect(input).toBe(source); opened++; }
    close() { closed++; }
  }
  const pass = { setPipeline() {}, setBindGroup() {}, draw() {}, end() {} };
  const device = {
    createSampler: () => ({}), createBuffer: () => ({}), createShaderModule: () => ({}),
    createRenderPipeline: () => ({ getBindGroupLayout: () => ({}) }),
    importExternalTexture: ({ source: input }: { source: unknown }) => { imported = input; return {}; },
    createBindGroup: () => ({}), createCommandEncoder: () => ({ beginRenderPass: () => pass, finish: () => ({}) }),
    queue: { writeBuffer() {}, submit() { if (failSubmit) throw Error("submit failed"); } },
  };
  const gpuContext = { configure() {}, getCurrentTexture: () => ({ createView: () => ({}) }) };
  const canvas = { width: 1, height: 1, dataset: {} as Record<string, string>, clientWidth: 640, clientHeight: 360, getContext: () => gpuContext } as unknown as HTMLCanvasElement;
  const renderer = new StutterWebGpuPreviewRenderer();
  try {
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { gpu: {
      requestAdapter: async () => ({ requestDevice: async () => device }), getPreferredCanvasFormat: () => "rgba8unorm",
    } } });
    Object.defineProperty(globalThis, "VideoFrame", { configurable: true, value: SnapshotFrame });
    Object.defineProperty(globalThis, "GPUBufferUsage", { configurable: true, value: { UNIFORM: 1, COPY_DST: 2 } });
    Object.defineProperty(globalThis, "GPUTextureUsage", { configurable: true, value: { RENDER_ATTACHMENT: 1 } });
    expect(await renderer.init(canvas, canvas)).toBe("webgpu");
    renderer.render(source, null, .5);
    expect(imported).toBeInstanceOf(SnapshotFrame); expect(opened).toBe(1); expect(closed).toBe(1);
    expect([canvas.width, canvas.height]).toEqual([1344, 768]);
    canvas.dataset.stutterCaptureResolution = "720p";
    renderer.render(source, null, .55);
    expect([canvas.width, canvas.height]).toEqual([1280, 720]);
    failSubmit = true;
    expect(() => renderer.render(source, null, .6)).toThrow("submit failed");
    expect(opened).toBe(3); expect(closed).toBe(3);
  } finally {
    renderer.dispose();
    for (const key of keys) { const descriptor = original.get(key); if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
