export type StutterShaderEngine = "webgpu-wgsl";

export type StutterColumnId = "time" | "color" | "space" | "generate";

export type StutterEffectId =
  | "grade"
  | "brightness-contrast"
  | "hue-saturation"
  | "vignette"
  | "crop"
  | "pan"
  | "zoom"
  | "glitch"
  | "chromatic-aberration"
  | "scanline"
  | "vhs"
  | "feedback"
  | "particles";

export interface StutterShaderColumn {
  id: StutterColumnId;
  effect: StutterEffectId;
  mix: number;
  intensity: number;
  audioReactive: number;
  params: Record<string, number>;
}

export interface StutterShaderDefinition {
  id: string;
  label: string;
  engine: StutterShaderEngine;
  family: "color" | "space" | "generate" | "hybrid";
  description: string;
  columns: StutterShaderColumn[];
  wgslEntry: "stutterCompositor";
  wgslSource: string;
  ffmpegExportKinds: string[];
}

export interface StutterShaderRuntimePlan {
  presetId?: string;
  shaderId?: string;
  shaderLabel: string;
  engine: StutterShaderEngine;
  family: StutterShaderDefinition["family"];
  wgslEntry: StutterShaderDefinition["wgslEntry"];
  cueId: string;
  start: number;
  end: number;
  intensity: number;
  columns: StutterShaderColumn[];
  ffmpegExportKinds: string[];
}

// WebGPU/WGSL runtime contract adapted from the local stutter-blaster compositor:
// external video texture + sampler + 8 vec4 uniforms for time/color/space/generate columns.
export const STUTTER_WGSL_COMPOSITOR_SOURCE = /* wgsl */ `
struct Uniforms {
  timeFx: vec4f,
  colorFx: vec4f,
  colorParamsA: vec4f,
  colorParamsB: vec4f,
  spaceFx: vec4f,
  generateFx: vec4f,
  generateParamsA: vec4f,
  generateParamsB: vec4f
};

@group(0) @binding(0) var videoSampler: sampler;
@group(0) @binding(1) var videoTexture: texture_external;
@group(0) @binding(2) var<uniform> uniforms: Uniforms;

fn random(value: vec2f) -> f32 {
  return fract(sin(dot(value, vec2f(12.9898, 78.233))) * 43758.5453);
}

fn sampleVideo(uv: vec2f) -> vec4f {
  return textureSampleBaseClampToEdge(videoTexture, videoSampler, clamp(uv, vec2f(0.0), vec2f(1.0)));
}

fn luma(color: vec3f) -> f32 {
  return dot(color, vec3f(0.2126, 0.7152, 0.0722));
}

@fragment
fn stutterCompositor(@location(0) uv: vec2f) -> @location(0) vec4f {
  let zoom = max(uniforms.spaceFx.z, 0.05);
  var sampleUv = (uv - 0.5) / zoom + 0.5 + uniforms.spaceFx.xy;
  if (uniforms.spaceFx.w == 0.0) {
    let crop = min(max(uniforms.spaceFx.x, 0.0), 0.49);
    sampleUv = sampleUv * (1.0 - crop * 2.0) + vec2f(crop, crop);
  }

  let source = sampleVideo(sampleUv);
  var color = source.rgb;
  let colorMix = clamp(uniforms.colorFx.x, 0.0, 1.0);
  let colorCode = uniforms.colorFx.y;
  let gain = max(uniforms.colorFx.z, 0.0);
  let contrast = uniforms.colorFx.w;
  let brightness = uniforms.colorParamsA.x;
  let hue = uniforms.colorParamsA.y;
  let saturation = uniforms.colorParamsA.z;
  let vignetteOffset = uniforms.colorParamsA.w;
  let vignetteDarkness = uniforms.colorParamsB.x;
  var colorFiltered = color;

  if (colorCode == 0.0) {
    colorFiltered = ((color - 0.5) * (1.0 + contrast) + 0.5) * (0.75 + gain);
  } else if (colorCode == 1.0) {
    colorFiltered = (color + vec3f(brightness) - 0.5) * (1.0 + contrast) + 0.5;
  } else if (colorCode == 2.0) {
    let rotated = vec3f(color.r + hue * (color.g - color.b), color.g + hue * (color.b - color.r), color.b + hue * (color.r - color.g));
    let grey = vec3f(luma(rotated));
    colorFiltered = clamp(mix(grey, rotated, 1.0 + saturation), vec3f(0.0), vec3f(1.0));
  } else if (colorCode == 5.0) {
    let vignette = 1.0 - smoothstep(vignetteOffset, 1.0, distance(sampleUv, vec2f(0.5)));
    colorFiltered = color * mix(1.0, vignette, vignetteDarkness);
  }
  color = mix(color, clamp(colorFiltered, vec3f(0.0), vec3f(1.0)), colorMix);

  let generateCode = uniforms.generateFx.x;
  let generateMix = clamp(uniforms.generateFx.y, 0.0, 1.0);
  let generateIntensity = uniforms.generateFx.z;
  let generateNoise = uniforms.generateFx.w;
  let aberrationOffset = uniforms.generateParamsA.x;
  let scanlineDensity = uniforms.generateParamsA.z;
  let scanlineIntensity = uniforms.generateParamsA.w;
  let scanlineSpeed = uniforms.generateParamsB.x;
  let distortion = uniforms.generateParamsB.y;
  let rgbShift = uniforms.generateParamsB.z;
  let flicker = uniforms.generateParamsB.w;
  var generated = color;

  if (generateCode == 0.0) {
    let stripe = floor(sampleUv.y * (12.0 + generateIntensity * 48.0));
    let blockNoise = random(vec2f(stripe, floor(uniforms.timeFx.x * 20.0)));
    let shiftedUv = sampleUv + vec2f((blockNoise - 0.5) * generateIntensity * 0.08, 0.0);
    generated = vec3f(sampleVideo(shiftedUv + vec2f(rgbShift, 0.0)).r, sampleVideo(shiftedUv).g, sampleVideo(shiftedUv - vec2f(rgbShift, 0.0)).b);
    generated += vec3f((random(sampleUv + uniforms.timeFx.x) - 0.5) * generateNoise * 0.35);
  } else if (generateCode == 1.0) {
    generated = vec3f(sampleVideo(sampleUv + vec2f(aberrationOffset)).r, sampleVideo(sampleUv).g, sampleVideo(sampleUv - vec2f(aberrationOffset)).b);
  } else if (generateCode == 2.0) {
    let scan = sin(sampleUv.y * (160.0 + scanlineDensity * 640.0) + uniforms.timeFx.x * scanlineSpeed * 6.0) * 0.5 + 0.5;
    generated = color * mix(1.0, pow(scan, 1.4), scanlineIntensity);
  } else if (generateCode == 3.0) {
    let center = sampleUv - 0.5;
    let warpedUv = sampleUv + center * dot(center, center) * distortion;
    generated = vec3f(sampleVideo(warpedUv + vec2f(rgbShift, 0.0)).r, sampleVideo(warpedUv).g, sampleVideo(warpedUv - vec2f(rgbShift, 0.0)).b);
    generated *= 1.0 - flicker * 0.25 + sin(uniforms.timeFx.x * 28.0) * flicker * 0.12;
  } else if (generateCode == 4.0) {
    generated = mix(color, color.bgr, generateIntensity);
  } else if (generateCode == 5.0) {
    let sparkle = step(0.97 - generateIntensity * 0.4, random(sampleUv * 12.0 + uniforms.timeFx.x));
    generated = color + vec3f(sparkle) * (0.15 + generateNoise * 0.5);
  }

  color = mix(color, clamp(generated, vec3f(0.0), vec3f(1.0)), generateMix);
  return vec4f(clamp(color, vec3f(0.0), vec3f(1.0)), 1.0);
}
`;

export const STUTTER_SHADER_CATALOG: StutterShaderDefinition[] = [
  {
    id: "stutter-glitch",
    label: "Stutter Glitch",
    engine: "webgpu-wgsl",
    family: "generate",
    description: "Block displacement, RGB split, noise, and transient-reactive glitching.",
    columns: [
      column("generate", "glitch", 0.82, 0.86, 0.85, { noise: 0.62, rgbShift: 0.035 }),
      column("space", "pan", 0.28, 0.45, 0.35, { panAmountMin: 0.0, panAmountMax: 0.08 }),
    ],
    wgslEntry: "stutterCompositor",
    wgslSource: STUTTER_WGSL_COMPOSITOR_SOURCE,
    ffmpegExportKinds: ["glitch-cut", "datamosh-lite"],
  },
  {
    id: "stutter-vhs",
    label: "Stutter VHS",
    engine: "webgpu-wgsl",
    family: "hybrid",
    description: "CRT/VHS scanlines, warping, flicker, and tape-style color drift.",
    columns: [
      column("generate", "vhs", 0.72, 0.68, 0.65, { scanlineIntensity: 0.55, distortion: 0.14, rgbShift: 0.028, flicker: 0.28 }),
      column("color", "brightness-contrast", 0.58, 0.5, 0.35, { brightness: -0.02, contrast: 0.28, saturation: 0.18 }),
    ],
    wgslEntry: "stutterCompositor",
    wgslSource: STUTTER_WGSL_COMPOSITOR_SOURCE,
    ffmpegExportKinds: ["film-halation", "glitch-cut"],
  },
  {
    id: "stutter-bloom",
    label: "Stutter Bloom",
    engine: "webgpu-wgsl",
    family: "color",
    description: "Dreamy chromatic bloom/aberration with gentle lyric glow.",
    columns: [
      column("generate", "chromatic-aberration", 0.48, 0.45, 0.42, { aberrationOffset: 0.006, aberrationRadial: 0.55 }),
      column("color", "grade", 0.7, 0.5, 0.3, { gain: 1.08, contrast: 0.12, saturation: 0.2 }),
    ],
    wgslEntry: "stutterCompositor",
    wgslSource: STUTTER_WGSL_COMPOSITOR_SOURCE,
    ffmpegExportKinds: ["film-halation", "lyric-glow"],
  },
  {
    id: "stutter-crt",
    label: "Stutter CRT",
    engine: "webgpu-wgsl",
    family: "hybrid",
    description: "Clean CRT scanlines and hue/saturation response for analog sections.",
    columns: [
      column("generate", "scanline", 0.56, 0.5, 0.55, { scanlineDensity: 1.8, scanlineIntensity: 0.42, scanlineSpeed: 0.75 }),
      column("color", "hue-saturation", 0.55, 0.45, 0.42, { hue: 0.08, saturation: 0.28 }),
    ],
    wgslEntry: "stutterCompositor",
    wgslSource: STUTTER_WGSL_COMPOSITOR_SOURCE,
    ffmpegExportKinds: ["duotone-pulse", "beat-flash"],
  },
  {
    id: "stutter-feedback",
    label: "Stutter Feedback",
    engine: "webgpu-wgsl",
    family: "generate",
    description: "BGR feedback smears for bridge/build sections and sustained phrases.",
    columns: [
      column("generate", "feedback", 0.5, 0.55, 0.4, {}),
      column("space", "zoom", 0.28, 0.36, 0.28, { zoomMin: 0.96, zoomMax: 1.08 }),
    ],
    wgslEntry: "stutterCompositor",
    wgslSource: STUTTER_WGSL_COMPOSITOR_SOURCE,
    ffmpegExportKinds: ["section-warmth", "film-halation"],
  },
  {
    id: "stutter-particles",
    label: "Stutter Particles",
    engine: "webgpu-wgsl",
    family: "generate",
    description: "Sparkle/particle hits for lyric reveals and final chorus lift.",
    columns: [
      column("generate", "particles", 0.62, 0.6, 0.7, { noise: 0.35 }),
      column("color", "vignette", 0.45, 0.32, 0.25, { vignetteOffset: 0.68, vignetteDarkness: 0.35 }),
    ],
    wgslEntry: "stutterCompositor",
    wgslSource: STUTTER_WGSL_COMPOSITOR_SOURCE,
    ffmpegExportKinds: ["lyric-glow", "beat-flash"],
  },
];

export function getStutterShaderDefinition(id?: string | null): StutterShaderDefinition {
  return STUTTER_SHADER_CATALOG.find((shader) => shader.id === id) ?? STUTTER_SHADER_CATALOG[0];
}

export function mapPresetTokenToStutterShaderId(token?: string | null) {
  if (!token) return "stutter-bloom";
  if (token.includes("block-tear") || token.includes("glitch") || token.includes("tracking")) return "stutter-glitch";
  if (token.includes("vhs") || token.includes("dirty-16mm")) return "stutter-vhs";
  if (token.includes("crt")) return "stutter-crt";
  if (token.includes("dream") || token.includes("anamorphic") || token.includes("warm-halation")) return "stutter-bloom";
  if (token.includes("cinema")) return "stutter-feedback";
  return "stutter-bloom";
}

export function buildStutterRuntimePlan(params: {
  cueId: string;
  presetId?: string;
  shaderId?: string;
  start: number;
  end: number;
  intensity: number;
}): StutterShaderRuntimePlan {
  const shader = getStutterShaderDefinition(params.shaderId ?? mapPresetTokenToStutterShaderId(params.presetId));
  const intensity = clamp(Number(params.intensity) || 0, 0, 1);
  return {
    presetId: params.presetId,
    shaderId: shader.id,
    shaderLabel: shader.label,
    engine: shader.engine,
    family: shader.family,
    wgslEntry: shader.wgslEntry,
    cueId: params.cueId,
    start: roundTime(Math.max(0, params.start)),
    end: roundTime(Math.max(params.start, params.end)),
    intensity,
    columns: shader.columns.map((shaderColumn) => ({
      ...shaderColumn,
      mix: roundTime(clamp(shaderColumn.mix * (0.35 + intensity * 0.85), 0, 1)),
      intensity: roundTime(clamp(shaderColumn.intensity * (0.4 + intensity * 0.9), 0, 1)),
      params: scaleNumericParams(shaderColumn.params, intensity),
    })),
    ffmpegExportKinds: shader.ffmpegExportKinds,
  };
}

function column(
  id: StutterColumnId,
  effect: StutterEffectId,
  mix: number,
  intensity: number,
  audioReactive: number,
  params: Record<string, number>,
): StutterShaderColumn {
  return { id, effect, mix, intensity, audioReactive, params };
}

function scaleNumericParams(params: Record<string, number>, intensity: number) {
  return Object.fromEntries(Object.entries(params).map(([key, value]) => [key, roundTime(value * (0.55 + intensity * 0.75))]));
}

function roundTime(value: number) {
  return Math.round(value * 1000) / 1000;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
