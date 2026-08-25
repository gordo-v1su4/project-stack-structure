import {
  buildStutterRuntimePlan,
  mapPresetTokenToStutterShaderId,
  STUTTER_SHADER_CATALOG,
  type StutterShaderRuntimePlan,
} from "./stutterShaderCatalog";

export type ShaderCueKind =
  | "beat-flash"
  | "section-warmth"
  | "lyric-glow"
  | "glitch-cut"
  | "datamosh-lite"
  | "film-halation"
  | "duotone-pulse";

export type ShaderCueSync = "beat" | "section" | "lyric";

export const SHADER_CUE_KINDS = [
  "beat-flash",
  "section-warmth",
  "lyric-glow",
  "glitch-cut",
  "datamosh-lite",
  "film-halation",
  "duotone-pulse",
] as const;

export interface ShaderAccentKinds {
  beat?: ShaderCueKind;
  section?: ShaderCueKind;
  lyric?: ShaderCueKind;
}

export interface ShaderEffectCue {
  id: string;
  kind: ShaderCueKind;
  start: number;
  end: number;
  intensity: number;
  sync: ShaderCueSync;
  label?: string;
  shaderId?: string;
  presetId?: string;
  runtimePlan?: StutterShaderRuntimePlan;
}

export interface ShaderTimelineSegment {
  startTime: number;
  endTime: number;
  musicStart?: number;
  musicEnd?: number;
  label?: string;
}

export interface ShaderLyricChunk {
  id?: string;
  index?: number;
  start: number;
  end: number;
  text?: string;
}

export interface ShaderEffectPreset {
  id: "balanced-music-video" | "high-energy-glitch" | "dream-sync" | "analog-tape";
  label: string;
  description: string;
  sectionKind: ShaderCueKind;
  beatKind: ShaderCueKind;
  lyricKind: ShaderCueKind;
  shaderPresetIds: string[];
  triggerIntensity: number;
  beatWindow: number;
}

// Adapted from the local svelte-video-shaders auto-edit/shader catalog vocabulary.
// Stack Structure uses this as metadata for both browser cue previews and ffmpeg export filters.
export const MUSIC_VIDEO_SHADER_PRESETS: ShaderEffectPreset[] = [
  {
    id: "balanced-music-video",
    label: "Balanced Music Video",
    description: "Moderate cuts, cinematic color, musical but not chaotic.",
    sectionKind: "film-halation",
    beatKind: "beat-flash",
    lyricKind: "lyric-glow",
    shaderPresetIds: ["cinema-grade", "dream-bloom", "warm-halation"],
    triggerIntensity: 0.45,
    beatWindow: 0.18,
  },
  {
    id: "high-energy-glitch",
    label: "High Energy Glitch",
    description: "Dense cuts, datamosh/glitch looks, strong transient hits.",
    sectionKind: "duotone-pulse",
    beatKind: "glitch-cut",
    lyricKind: "datamosh-lite",
    shaderPresetIds: ["block-tear", "glitch-cut", "tape-tracking-storm"],
    triggerIntensity: 0.85,
    beatWindow: 0.22,
  },
  {
    id: "dream-sync",
    label: "Dream Sync",
    description: "Slower cuts, bloom/halation/anamorphic looks, soft transitions.",
    sectionKind: "section-warmth",
    beatKind: "film-halation",
    lyricKind: "lyric-glow",
    shaderPresetIds: ["dream-bloom", "anamorphic-dream", "warm-halation"],
    triggerIntensity: 0.28,
    beatWindow: 0.16,
  },
  {
    id: "analog-tape",
    label: "Analog Tape",
    description: "VHS/CRT/film grain with tape tracking hits on strong beats.",
    sectionKind: "film-halation",
    beatKind: "glitch-cut",
    lyricKind: "lyric-glow",
    shaderPresetIds: ["vhs-classic", "clean-crt", "dirty-16mm"],
    triggerIntensity: 0.62,
    beatWindow: 0.2,
  },
];

export function getMusicVideoShaderPreset(id?: string | null): ShaderEffectPreset {
  return MUSIC_VIDEO_SHADER_PRESETS.find((preset) => preset.id === id) ?? MUSIC_VIDEO_SHADER_PRESETS[0];
}

export function describeMusicVideoShaderPreset(id?: string | null) {
  const preset = getMusicVideoShaderPreset(id);
  const shaderIds = [...new Set(preset.shaderPresetIds.map(mapPresetTokenToStutterShaderId))];
  const shaders = shaderIds.map((shaderId) => STUTTER_SHADER_CATALOG.find((shader) => shader.id === shaderId)).filter(Boolean);
  return {
    preset,
    engine: "WebGPU/WGSL + FFmpeg server export",
    shaders: shaders.map((shader) => ({
      id: shader!.id,
      label: shader!.label,
      family: shader!.family,
      description: shader!.description,
    })),
  };
}

export function buildAutoShaderCues(params: {
  segments: ShaderTimelineSegment[];
  beats?: number[];
  lyricChunks?: ShaderLyricChunk[];
  presetId?: string | null;
  accentKinds?: ShaderAccentKinds;
}): ShaderEffectCue[] {
  const preset = getMusicVideoShaderPreset(params.presetId);
  const sectionKind = params.accentKinds?.section ?? preset.sectionKind;
  const beatKind = params.accentKinds?.beat ?? preset.beatKind;
  const lyricKind = params.accentKinds?.lyric ?? preset.lyricKind;
  const segments = normalizeShaderTimelineSegments(params.segments);
  const cues: ShaderEffectCue[] = [];
  let outputCursor = 0;

  for (const [index, segment] of segments.entries()) {
    const sourceDuration = segment.endTime - segment.startTime;
    const outputStart = roundTime(outputCursor);
    const outputEnd = roundTime(outputStart + sourceDuration);
    outputCursor = outputEnd;

    if (sourceDuration <= 0) continue;

    const sectionPresetId = preset.shaderPresetIds[index % preset.shaderPresetIds.length] ?? preset.shaderPresetIds[0];
    cues.push({
      id: `section-${index}-${sectionPresetId}`,
      kind: sectionKind,
      start: outputStart,
      end: outputEnd,
      intensity: clamp(0.3 + preset.triggerIntensity * 0.35, 0, 1),
      sync: "section",
      label: segment.label,
      presetId: sectionPresetId,
      shaderId: shaderIdForPreset(sectionPresetId),
    });

    const musicStart = segment.musicStart ?? outputStart;
    const musicEnd = segment.musicEnd ?? outputEnd;
    const mappedBeats = (params.beats ?? [])
      .filter((beat) => beat >= musicStart && beat < musicEnd)
      .slice(0, 24);

    const beatTimes = mappedBeats.length
      ? mappedBeats.map((beat) => outputStart + (beat - musicStart))
      : [outputStart];

    for (const [beatIndex, beatTime] of beatTimes.entries()) {
      const start = roundTime(Math.max(outputStart, beatTime));
      const end = roundTime(Math.min(outputEnd, start + preset.beatWindow));
      if (end <= start) continue;
      const beatPresetId = preset.shaderPresetIds[(index + beatIndex + 1) % preset.shaderPresetIds.length] ?? sectionPresetId;
      cues.push({
        id: `beat-${index}-${beatIndex}-${beatPresetId}`,
        kind: beatKind,
        start,
        end,
        intensity: preset.triggerIntensity,
        sync: "beat",
        label: segment.label,
        presetId: beatPresetId,
        shaderId: shaderIdForPreset(beatPresetId),
      });
    }

    const lyric = (params.lyricChunks ?? []).find((chunk) => overlaps(musicStart, musicEnd, chunk.start, chunk.end));
    if (lyric) {
      const lyricStart = roundTime(Math.max(outputStart, outputStart + (lyric.start - musicStart)));
      const lyricEnd = roundTime(Math.min(outputEnd, outputStart + (lyric.end - musicStart)));
      if (lyricEnd > lyricStart) {
        const lyricPresetId = preset.shaderPresetIds[(index + 2) % preset.shaderPresetIds.length] ?? sectionPresetId;
        cues.push({
          id: `lyric-${index}-${lyric.id ?? lyric.index ?? lyricStart}-${lyricPresetId}`,
          kind: lyricKind,
          start: lyricStart,
          end: lyricEnd,
          intensity: clamp(preset.triggerIntensity + 0.18, 0, 1),
          sync: "lyric",
          label: lyric.text?.slice(0, 64) || segment.label,
          presetId: lyricPresetId,
          shaderId: shaderIdForPreset(lyricPresetId),
        });
      }
    }
  }

  return cues.map(normalizeShaderCue).filter((cue): cue is ShaderEffectCue => cue !== null);
}

export function normalizeShaderTimelineSegments(segments: ShaderTimelineSegment[]): ShaderTimelineSegment[] {
  return segments
    .map((segment): ShaderTimelineSegment | null => {
      const startTime = roundTime(Math.max(0, Number(segment.startTime) || 0));
      const endTime = roundTime(Math.max(startTime, Number(segment.endTime) || 0));
      if (endTime <= startTime) return null;
      const duration = endTime - startTime;
      const musicStart = roundTime(Math.max(0, Number(segment.musicStart) || 0));
      const musicEnd = roundTime(Math.max(musicStart + 0.05, Number(segment.musicEnd) || musicStart + duration));
      return { ...segment, startTime, endTime, musicStart, musicEnd };
    })
    .filter((segment): segment is ShaderTimelineSegment => segment !== null);
}

export function normalizeShaderCue(cue: ShaderEffectCue): ShaderEffectCue | null {
  const start = roundTime(Math.max(0, Number(cue.start) || 0));
  const end = roundTime(Math.max(start, Number(cue.end) || 0));
  if (end <= start) return null;
  const presetId = cue.presetId ? sanitizeCueToken(cue.presetId) : undefined;
  return {
    ...cue,
    id: sanitizeCueToken(cue.id || `${cue.kind}-${start}`),
    start,
    end,
    intensity: clamp(Number(cue.intensity) || 0, 0, 1),
    presetId,
    shaderId: cue.shaderId ?? shaderIdForPreset(presetId),
    runtimePlan: cue.runtimePlan ?? buildStutterRuntimePlan({
      cueId: sanitizeCueToken(cue.id || `${cue.kind}-${start}`),
      presetId,
      shaderId: cue.shaderId ?? shaderIdForPreset(presetId),
      start,
      end,
      intensity: clamp(Number(cue.intensity) || 0, 0, 1),
    }),
  };
}

export function buildFfmpegShaderFilter(cues: ShaderEffectCue[]) {
  const filters = cues
    .map(normalizeShaderCue)
    .filter((cue): cue is ShaderEffectCue => cue !== null)
    .map((cue) => {
      const enable = `between(t\\,${cue.start.toFixed(3)}\\,${cue.end.toFixed(3)})`;
      const intensity = clamp(cue.intensity, 0, 1);
      if (cue.kind === "beat-flash") {
        return `eq=brightness=${(0.08 + intensity * 0.24).toFixed(3)}:saturation=${(1 + intensity * 0.55).toFixed(3)}:enable='${enable}'`;
      }
      if (cue.kind === "glitch-cut" || cue.kind === "datamosh-lite") {
        return `rgbashift=rh=${Math.round(4 + intensity * 18)}:bh=${Math.round(-4 - intensity * 16)}:enable='${enable}',noise=alls=${Math.round(6 + intensity * 18)}:allf=t:enable='${enable}'`;
      }
      if (cue.kind === "lyric-glow") {
        return `unsharp=5:5:${(0.35 + intensity).toFixed(3)}:5:5:0.0:enable='${enable}'`;
      }
      if (cue.kind === "film-halation") {
        return `eq=contrast=${(1 + intensity * 0.08).toFixed(3)}:saturation=${(1 + intensity * 0.22).toFixed(3)}:gamma_r=${(1 + intensity * 0.1).toFixed(3)}:enable='${enable}'`;
      }
      if (cue.kind === "duotone-pulse") {
        return `colorbalance=rs=${(intensity * 0.18).toFixed(3)}:bs=${(-intensity * 0.1).toFixed(3)}:enable='${enable}'`;
      }
      return `hue=s=${(1 + intensity * 0.35).toFixed(3)}:enable='${enable}'`;
    });

  return filters.length ? filters.join(",") : null;
}

function shaderIdForPreset(presetId?: string) {
  return mapPresetTokenToStutterShaderId(presetId);
}

function overlaps(leftStart: number, leftEnd: number, rightStart: number, rightEnd: number) {
  return leftStart < rightEnd && leftEnd > rightStart;
}

function roundTime(value: number) {
  return Math.round(value * 1000) / 1000;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function sanitizeCueToken(value: string) {
  return value.replace(/[^a-z0-9._-]+/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "cue";
}
