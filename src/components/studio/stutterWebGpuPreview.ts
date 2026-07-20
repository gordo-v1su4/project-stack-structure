import type { ShaderEffectCue } from "./shaderEffectPlan";
import {
  STUTTER_WGSL_COMPOSITOR_SOURCE,
  type StutterColumnId,
  type StutterEffectId,
  type StutterShaderColumn,
  type StutterShaderRuntimePlan,
} from "./stutterShaderCatalog";

export type StutterPreviewMode = "disabled" | "webgpu" | "canvas2d";

export interface StutterCanvas2dStyle {
  filter: string;
  scale: number;
  translateX: number;
  translateY: number;
  scanlineOpacity: number;
}

const STUTTER_VERTEX_SHADER = /* wgsl */ `
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f
};

@vertex
fn main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var positions = array<vec2f, 6>(
    vec2f(-1.0, -1.0),
    vec2f( 1.0, -1.0),
    vec2f(-1.0,  1.0),
    vec2f(-1.0,  1.0),
    vec2f( 1.0, -1.0),
    vec2f( 1.0,  1.0)
  );

  var uvs = array<vec2f, 6>(
    vec2f(0.0, 1.0),
    vec2f(1.0, 1.0),
    vec2f(0.0, 0.0),
    vec2f(0.0, 0.0),
    vec2f(1.0, 1.0),
    vec2f(1.0, 0.0)
  );

  var output: VertexOutput;
  output.position = vec4f(positions[vertexIndex], 0.0, 1.0);
  output.uv = uvs[vertexIndex];
  return output;
}
`;

type WebGpuGlobals = {
  GPUBufferUsage?: { UNIFORM: number; COPY_DST: number };
  GPUTextureUsage?: { RENDER_ATTACHMENT: number };
};

type GpuNavigator = Navigator & {
  gpu?: {
    requestAdapter: () => Promise<{
      requestDevice: () => Promise<GpuDeviceLike>;
    } | null>;
    getPreferredCanvasFormat: () => string;
  };
};

type GpuDeviceLike = {
  createSampler: (descriptor: Record<string, string>) => unknown;
  createBuffer: (descriptor: { size: number; usage: number }) => unknown;
  createShaderModule: (descriptor: { code: string }) => unknown;
  createRenderPipeline: (descriptor: Record<string, unknown>) => GpuRenderPipelineLike;
  importExternalTexture: (descriptor: { source: HTMLVideoElement }) => unknown;
  createBindGroup: (descriptor: Record<string, unknown>) => unknown;
  createCommandEncoder: () => GpuCommandEncoderLike;
  queue: {
    writeBuffer: (buffer: unknown, offset: number, data: ArrayBufferLike, dataOffset: number, size: number) => void;
    submit: (commands: unknown[]) => void;
  };
};

type GpuCanvasContextLike = {
  configure: (descriptor: Record<string, unknown>) => void;
  getCurrentTexture: () => { createView: () => unknown };
};

type GpuRenderPipelineLike = {
  getBindGroupLayout: (index: number) => unknown;
};

type GpuCommandEncoderLike = {
  beginRenderPass: (descriptor: Record<string, unknown>) => GpuRenderPassLike;
  finish: () => unknown;
};

type GpuRenderPassLike = {
  setPipeline: (pipeline: unknown) => void;
  setBindGroup: (index: number, bindGroup: unknown) => void;
  draw: (vertexCount: number) => void;
  end: () => void;
};

export function selectActiveStutterRuntimePlan(
  cues: Array<Pick<ShaderEffectCue, "start" | "end" | "sync" | "runtimePlan">>,
  outputTime: number,
): StutterShaderRuntimePlan | null {
  const active = cues
    .filter((cue) => cue.runtimePlan && outputTime >= cue.start && outputTime < cue.end)
    .sort((left, right) => cuePriority(right.sync) - cuePriority(left.sync) || (left.end - left.start) - (right.end - right.start));
  return active[0]?.runtimePlan ?? null;
}

export function buildStutterUniforms(
  plan: StutterShaderRuntimePlan,
  outputTime: number,
  musicalEnvelope = 1,
): Float32Array {
  const color = getColumn(plan.columns, "color");
  const space = getColumn(plan.columns, "space");
  const generate = getColumn(plan.columns, "generate");
  const timeInCue = Math.max(0, outputTime - plan.start);
  const envelope = clamp(musicalEnvelope, 0, 1);

  const colorMix = clamp((color?.mix ?? 0) * envelope, 0, 1);
  const colorCode = color ? colorEffectCode(color.effect) : -1;
  const gain = color?.params.gain ?? 1;
  const contrast = color?.params.contrast ?? 0;
  const brightness = color?.params.brightness ?? 0;
  const hue = color?.params.hue ?? 0;
  const saturation = color?.params.saturation ?? 0;
  const vignetteOffset = color?.params.vignetteOffset ?? 0.5;
  const vignetteDarkness = color?.params.vignetteDarkness ?? 0.5;

  const spaceValues = computeSpaceValues(space, timeInCue, envelope);
  const generateCode = generate ? generateEffectCode(generate.effect) : -1;
  const generateMix = clamp((generate?.mix ?? 0) * envelope, 0, 1);
  const generateIntensity = clamp((generate?.intensity ?? 0) * envelope, 0, 1);

  return new Float32Array([
    outputTime,
    plan.intensity,
    1,
    0,
    colorMix,
    colorCode,
    gain,
    contrast,
    brightness,
    hue,
    saturation,
    vignetteOffset,
    vignetteDarkness,
    0,
    0,
    0,
    spaceValues.x,
    spaceValues.y,
    spaceValues.zoom,
    spaceValues.effectCode,
    generateCode,
    generateMix,
    generateIntensity,
    generate?.params.noise ?? 0,
    generate?.params.aberrationOffset ?? 0.002,
    generate?.params.aberrationRadial ?? 0,
    generate?.params.scanlineDensity ?? 1.25,
    generate?.params.scanlineIntensity ?? 0.3,
    generate?.params.scanlineSpeed ?? 0,
    generate?.params.distortion ?? 0.1,
    generate?.params.rgbShift ?? 0.02,
    generate?.params.flicker ?? 0.05,
  ]);
}

export function buildStutterCanvas2dStyle(
  plan: StutterShaderRuntimePlan | null,
  outputTime: number,
): StutterCanvas2dStyle {
  if (!plan) {
    return { filter: "none", scale: 1, translateX: 0, translateY: 0, scanlineOpacity: 0 };
  }

  const color = getColumn(plan.columns, "color");
  const space = getColumn(plan.columns, "space");
  const generate = getColumn(plan.columns, "generate");
  const timeInCue = Math.max(0, outputTime - plan.start);
  const intensity = clamp(plan.intensity, 0, 1);
  const colorMix = clamp((color?.mix ?? 0) * intensity, 0, 1);
  const generateMix = clamp((generate?.mix ?? 0) * intensity, 0, 1);
  const filters: string[] = [];

  if (color?.effect === "grade") {
    filters.push(`brightness(${1 + ((color.params.gain ?? 1) - 1) * colorMix})`);
    filters.push(`contrast(${1 + (color.params.contrast ?? 0) * colorMix})`);
  } else if (color?.effect === "brightness-contrast") {
    filters.push(`brightness(${1 + (color.params.brightness ?? 0) * colorMix})`);
    filters.push(`contrast(${1 + (color.params.contrast ?? 0) * colorMix})`);
  } else if (color?.effect === "hue-saturation") {
    filters.push(`hue-rotate(${(color.params.hue ?? 0) * colorMix * 180}deg)`);
    filters.push(`saturate(${1 + (color.params.saturation ?? 0) * colorMix})`);
  } else if (color?.effect === "vignette") {
    filters.push(`brightness(${1 - (color.params.vignetteDarkness ?? 0.5) * colorMix * 0.25})`);
    filters.push(`contrast(${1 + colorMix * 0.18})`);
  }

  if (generate) {
    if (generate.effect === "glitch" || generate.effect === "chromatic-aberration") {
      filters.push(`saturate(${1 + generateMix * 0.9})`);
      filters.push(`hue-rotate(${Math.sin(outputTime * 34) * generateMix * 12}deg)`);
    } else if (generate.effect === "vhs") {
      filters.push(`contrast(${1 + generateMix * 0.28})`);
      filters.push(`saturate(${1 - generateMix * 0.22})`);
    } else if (generate.effect === "feedback") {
      filters.push(`contrast(${1 + generateMix * 0.22})`);
      filters.push(`hue-rotate(${generateMix * 18}deg)`);
    } else if (generate.effect === "particles") {
      filters.push(`brightness(${1 + generateMix * 0.12})`);
    }
  }

  const spaceValues = computeSpaceValues(space, timeInCue, intensity);
  const glitchOffset = generate?.effect === "glitch"
    ? Math.sin(outputTime * 73) * generateMix * 0.018
    : 0;

  return {
    filter: filters.length ? filters.join(" ") : "none",
    scale: space?.effect === "crop" ? 1 + spaceValues.x * 2 : spaceValues.zoom,
    translateX: spaceValues.x + glitchOffset,
    translateY: spaceValues.y,
    scanlineOpacity: generate?.effect === "scanline" || generate?.effect === "vhs"
      ? generateMix * (generate.params.scanlineIntensity ?? 0.3)
      : 0,
  };
}

export class StutterWebGpuPreviewRenderer {
  private canvas: HTMLCanvasElement | null = null;
  private device: GpuDeviceLike | null = null;
  private context: GpuCanvasContextLike | null = null;
  private context2d: CanvasRenderingContext2D | null = null;
  private pipeline: GpuRenderPipelineLike | null = null;
  private sampler: unknown = null;
  private uniformBuffer: unknown = null;
  private mode: StutterPreviewMode = "disabled";
  private initialized = false;

  async init(
    webGpuCanvas: HTMLCanvasElement,
    canvas2dFallback: HTMLCanvasElement,
  ): Promise<StutterPreviewMode> {
    this.dispose();
    this.canvas = webGpuCanvas;
    resizeCanvasToDisplaySize(webGpuCanvas);

    const globals = globalThis as typeof globalThis & WebGpuGlobals;
    const gpu = (navigator as GpuNavigator).gpu;
    const bufferUsage = globals.GPUBufferUsage;
    const textureUsage = globals.GPUTextureUsage;
    if (!gpu || !bufferUsage || !textureUsage) {
      return this.enableCanvas2dFallback(canvas2dFallback);
    }

    try {
      const adapter = await gpu.requestAdapter();
      const device = await adapter?.requestDevice();
      const context = webGpuCanvas.getContext("webgpu") as unknown as GpuCanvasContextLike | null;
      if (!device || !context) return this.enableCanvas2dFallback(canvas2dFallback);

      const format = gpu.getPreferredCanvasFormat();
      context.configure({
        device,
        format,
        alphaMode: "opaque",
        usage: textureUsage.RENDER_ATTACHMENT,
      });

      this.device = device;
      this.context = context;
      this.sampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });
      this.uniformBuffer = device.createBuffer({
        size: 128,
        usage: bufferUsage.UNIFORM | bufferUsage.COPY_DST,
      });
      this.pipeline = device.createRenderPipeline({
        layout: "auto",
        vertex: {
          module: device.createShaderModule({ code: STUTTER_VERTEX_SHADER }),
          entryPoint: "main",
        },
        fragment: {
          module: device.createShaderModule({ code: STUTTER_WGSL_COMPOSITOR_SOURCE }),
          entryPoint: "stutterCompositor",
          targets: [{ format }],
        },
        primitive: { topology: "triangle-list" },
      });
      this.mode = "webgpu";
      this.initialized = true;
      return this.mode;
    } catch {
      return this.enableCanvas2dFallback(canvas2dFallback);
    }
  }

  getMode(): StutterPreviewMode {
    return this.mode;
  }

  render(video: HTMLVideoElement, plan: StutterShaderRuntimePlan | null, outputTime: number) {
    if (!this.canvas || !this.initialized) return;
    resizeCanvasToDisplaySize(this.canvas);

    if (
      this.mode === "webgpu" &&
      this.device &&
      this.context &&
      this.pipeline &&
      this.sampler &&
      this.uniformBuffer &&
      video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
    ) {
      const uniforms = plan ? buildStutterUniforms(plan, outputTime) : buildPassthroughUniforms(outputTime);
      this.device.queue.writeBuffer(this.uniformBuffer, 0, uniforms.buffer, uniforms.byteOffset, uniforms.byteLength);
      const externalTexture = this.device.importExternalTexture({ source: video });
      const bindGroup = this.device.createBindGroup({
        layout: this.pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: this.sampler },
          { binding: 1, resource: externalTexture },
          { binding: 2, resource: { buffer: this.uniformBuffer } },
        ],
      });
      const commandEncoder = this.device.createCommandEncoder();
      const renderPass = commandEncoder.beginRenderPass({
        colorAttachments: [
          {
            view: this.context.getCurrentTexture().createView(),
            clearValue: { r: 0.02, g: 0.02, b: 0.02, a: 1 },
            loadOp: "clear",
            storeOp: "store",
          },
        ],
      });
      renderPass.setPipeline(this.pipeline);
      renderPass.setBindGroup(0, bindGroup);
      renderPass.draw(6);
      renderPass.end();
      this.device.queue.submit([commandEncoder.finish()]);
      return;
    }

    if (
      this.mode === "canvas2d" &&
      this.context2d &&
      video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
    ) {
      const style = buildStutterCanvas2dStyle(plan, outputTime);
      const width = this.canvas.width;
      const height = this.canvas.height;
      const context = this.context2d;
      context.save();
      context.clearRect(0, 0, width, height);
      context.filter = style.filter;
      context.translate(width * (0.5 + style.translateX), height * (0.5 + style.translateY));
      context.scale(style.scale, style.scale);
      context.drawImage(video, -width / 2, -height / 2, width, height);
      context.restore();

      if (style.scanlineOpacity > 0) {
        context.save();
        context.globalAlpha = style.scanlineOpacity;
        context.fillStyle = "#000";
        for (let y = 0; y < height; y += 4) context.fillRect(0, y, width, 1);
        context.restore();
      }
    }
  }

  clear() {
    if (this.canvas && this.context2d) this.context2d.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  dispose() {
    this.clear();
    this.canvas = null;
    this.device = null;
    this.context = null;
    this.context2d = null;
    this.pipeline = null;
    this.sampler = null;
    this.uniformBuffer = null;
    this.initialized = false;
    this.mode = "disabled";
  }

  private enableCanvas2dFallback(canvas: HTMLCanvasElement): StutterPreviewMode {
    this.canvas = canvas;
    resizeCanvasToDisplaySize(canvas);
    const context = canvas.getContext("2d");
    if (!context) {
      this.mode = "disabled";
      throw new Error("WebGPU and Canvas 2D preview contexts unavailable.");
    }
    this.context2d = context;
    this.mode = "canvas2d";
    this.initialized = true;
    return this.mode;
  }
}

function buildPassthroughUniforms(outputTime: number): Float32Array {
  return new Float32Array([
    outputTime, 0, 1, 0,
    0, -1, 1, 0,
    0, 0, 0, 0.5,
    0.5, 0, 0, 0,
    0, 0, 1, -1,
    -1, 0, 0, 0,
    0.002, 0, 1.25, 0.3,
    0, 0.1, 0.02, 0.05,
  ]);
}

function computeSpaceValues(column: StutterShaderColumn | undefined, timeSeconds: number, envelope: number) {
  if (!column) return { x: 0, y: 0, zoom: 1, effectCode: -1 };
  const pulse = (Math.sin(timeSeconds * Math.PI * 2 * (1 + column.intensity * 2)) + 1) / 2;
  const mix = clamp(column.mix * envelope, 0, 1);
  if (column.effect === "crop") {
    return { x: clamp((column.params.crop ?? 0.12) * mix, 0, 0.49), y: 0, zoom: 1, effectCode: 0 };
  }
  if (column.effect === "pan") {
    const min = column.params.panAmountMin ?? 0;
    const max = column.params.panAmountMax ?? 0.12;
    const amount = (min + (max - min) * pulse) * mix;
    return { x: Math.cos(timeSeconds * 2.4) * amount, y: Math.sin(timeSeconds * 1.7) * amount, zoom: 1, effectCode: 1 };
  }
  if (column.effect === "zoom") {
    const min = column.params.zoomMin ?? 0.95;
    const max = column.params.zoomMax ?? 1.12;
    return { x: 0, y: 0, zoom: min + (max - min) * pulse * mix, effectCode: 2 };
  }
  return { x: 0, y: 0, zoom: 1, effectCode: -1 };
}

function resizeCanvasToDisplaySize(canvas: HTMLCanvasElement) {
  const useExportResolution = canvas.dataset.stutterCaptureResolution === "720p";
  const displayWidth = useExportResolution
    ? 1280
    : makeEven(Math.max(2, Math.floor(canvas.clientWidth || canvas.parentElement?.clientWidth || 640)));
  const displayHeight = useExportResolution
    ? 720
    : makeEven(Math.max(2, Math.floor(canvas.clientHeight || canvas.parentElement?.clientHeight || displayWidth * 0.5625)));
  if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
    canvas.width = displayWidth;
    canvas.height = displayHeight;
  }
}

function makeEven(value: number) {
  return value % 2 === 0 ? value : value + 1;
}

function getColumn(columns: StutterShaderColumn[], id: StutterColumnId) {
  return columns.find((column) => column.id === id);
}

function colorEffectCode(effect: StutterEffectId): number {
  if (effect === "grade") return 0;
  if (effect === "brightness-contrast") return 1;
  if (effect === "hue-saturation") return 2;
  if (effect === "vignette") return 5;
  return -1;
}

function generateEffectCode(effect: StutterEffectId): number {
  if (effect === "glitch") return 0;
  if (effect === "chromatic-aberration") return 1;
  if (effect === "scanline") return 2;
  if (effect === "vhs") return 3;
  if (effect === "feedback") return 4;
  if (effect === "particles") return 5;
  return -1;
}

function cuePriority(sync?: ShaderEffectCue["sync"]) {
  if (sync === "lyric") return 3;
  if (sync === "beat") return 2;
  if (sync === "section") return 1;
  return 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
