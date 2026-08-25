import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import { getDefaultPreviewOutputDir } from "./previewAssetPath";
import {
  buildPreviewOutputPath,
  generateConcatPreview,
  type ConcatPreviewSegment,
  type GeneratedPreviewAsset,
  type ProbeFn,
} from "./previewGeneration";

import {
  buildAutoShaderCues as buildSharedAutoShaderCues,
  buildFfmpegShaderFilter,
  normalizeShaderCue,
  type ShaderAccentKinds,
  type ShaderEffectCue,
} from "./shaderEffectPlan";

const execFileAsync = promisify(execFile);

export { buildFfmpegShaderFilter } from "./shaderEffectPlan";
export type { ShaderEffectCue } from "./shaderEffectPlan";

export interface ExportTimelineSegment extends ConcatPreviewSegment {
  musicStart?: number;
  musicEnd?: number;
  label?: string;
}

export interface MusicVideoExportAsset extends GeneratedPreviewAsset {
  audioPath: string;
  audioMode: "windowed-slices" | "legacy-from-zero";
  effectCues: ShaderEffectCue[];
  effectFilter: string | null;
  hasAudio: boolean;
  hasVideo: boolean;
  downloadFileName: string;
}

export interface ShaderCaptureExportAsset {
  requestKey: string;
  assetKey: string;
  outputPath: string;
  generatedAt: string;
  duration: number;
  hasAudio: boolean;
  hasVideo: boolean;
  downloadFileName: string;
}

export type ExportAudioAssemblyPlan =
  | { mode: "legacy-from-zero" }
  | { mode: "windowed-slices"; slices: Array<{ start: number; end: number }> };

export interface MasterAudioSlice {
  start: number;
  end: number;
}

export function getCanonicalExportDuration(segments: ExportTimelineSegment[]): number {
  return roundTime(
    normalizeExportSegments(segments).reduce(
      (total, segment) => total + (segment.endTime - segment.startTime),
      0,
    ),
  );
}

/**
 * Decides the export audio source from RAW segments (pre-normalization): segments with
 * real [musicStart, musicEnd] windows produce ordered master-audio slices so the export
 * matches the browser preview; inputs without windows keep legacy full-audio-from-zero.
 * normalizeExportSegments fills window defaults, so this check must run first.
 */
export function planExportAudioAssembly(segments: ExportTimelineSegment[]): ExportAudioAssemblyPlan {
  const exportable = segments.filter((segment) => {
    if (!segment.inputPath) return false;
    const startTime = Math.max(0, Number(segment.startTime) || 0);
    return roundTime(Math.max(startTime, Number(segment.endTime) || 0)) > roundTime(startTime);
  });
  if (!exportable.length) return { mode: "legacy-from-zero" };

  const hasAnyWindow = exportable.some(
    (segment) =>
      Number.isFinite(segment.musicStart) &&
      Number.isFinite(segment.musicEnd) &&
      (segment.musicEnd as number) > (segment.musicStart as number),
  );
  if (!hasAnyWindow) return { mode: "legacy-from-zero" };

  const slices: MasterAudioSlice[] = [];
  let outputCursor = 0;
  for (const segment of exportable) {
    const duration = roundTime(Math.max(0.05, segment.endTime - segment.startTime));
    const musicStart = Number.isFinite(segment.musicStart)
      ? Math.max(0, segment.musicStart as number)
      : outputCursor;
    const musicEnd = Number.isFinite(segment.musicEnd) && (segment.musicEnd as number) > musicStart
      ? segment.musicEnd as number
      : musicStart + duration;
    slices.push({ start: roundTime(musicStart), end: roundTime(musicEnd) });
    outputCursor = roundTime(outputCursor + duration);
  }

  return { mode: "windowed-slices", slices };
}

export function buildMasterAudioSliceFilterComplex(slices: MasterAudioSlice[]): { filterComplex: string; mapLabel: string } {
  const branches = slices.map((slice, index) => {
    const label = `a${index}`;
    return {
      label,
      graph: `[0:a]atrim=start=${roundTime(slice.start)}:end=${roundTime(slice.end)},asetpts=N/SR/TB[${label}]`,
    };
  });

  if (branches.length === 1) {
    return { filterComplex: branches[0]!.graph, mapLabel: `[${branches[0]!.label}]` };
  }

  const concatInputs = branches.map((branch) => `[${branch.label}]`).join("");
  return {
    filterComplex: `${branches.map((branch) => branch.graph).join(";")};${concatInputs}concat=n=${branches.length}:v=0:a=1[out]`,
    mapLabel: "[out]",
  };
}

export async function assembleWindowedMasterAudio(params: {
  audioPath: string;
  slices: MasterAudioSlice[];
  outputPath: string;
  ffmpegPath?: string;
}): Promise<string> {
  const ffmpegPath = params.ffmpegPath ?? process.env.FFMPEG_PATH ?? "ffmpeg";
  if (!params.slices.length) throw new Error("Windowed audio assembly requires at least one slice.");
  const { filterComplex, mapLabel } = buildMasterAudioSliceFilterComplex(params.slices);
  await execFileAsync(ffmpegPath, [
    "-y",
    "-i", params.audioPath,
    "-filter_complex", filterComplex,
    "-map", mapLabel,
    "-c:a", "pcm_s16le",
    params.outputPath,
  ]);
  return params.outputPath;
}

export async function generateMusicVideoExport(params: {
  segments: ExportTimelineSegment[];
  audioPath: string;
  requestKey: string;
  outputPath?: string;
  effectCues?: ShaderEffectCue[];
  ffmpegPath?: string;
  probeFn?: ProbeFn;
  beats?: number[];
  lyricChunks?: Array<{ id?: string; index?: number; start: number; end: number; text?: string }>;
  shaderPresetId?: string | null;
  accentKinds?: ShaderAccentKinds;
}): Promise<MusicVideoExportAsset> {
  const ffmpegPath = params.ffmpegPath ?? process.env.FFMPEG_PATH ?? "ffmpeg";
  const probeFn = params.probeFn ?? (async () => ({ duration: 0, hasVideo: false }));
  const outputPath = params.outputPath ?? buildPreviewOutputPath({
    requestKey: `${params.requestKey}-export`,
    outputDir: getDefaultPreviewOutputDir(),
  });
  const intermediatePath = buildPreviewOutputPath({
    requestKey: `${params.requestKey}-export-video`,
    outputDir: getDefaultPreviewOutputDir(),
  });
  const segments = normalizeExportSegments(params.segments);
  const canonicalDuration = getCanonicalExportDuration(segments);

  const videoAsset = await generateConcatPreview({
    segments,
    requestKey: `${params.requestKey}-export-video`,
    outputPath: intermediatePath,
    ffmpegPath,
    probeFn,
  });

  const effectCues = (params.effectCues?.length
    ? params.effectCues
    : buildAutoShaderCues(segments, {
        beats: params.beats,
        lyricChunks: params.lyricChunks,
        presetId: params.shaderPresetId,
        accentKinds: params.accentKinds,
      }))
    .map(normalizeShaderCue)
    .filter((cue): cue is ShaderEffectCue => cue !== null);
  const effectFilter = buildFfmpegShaderFilter(effectCues);

  const audioAssembly = planExportAudioAssembly(params.segments);
  let muxAudioPath = params.audioPath;
  if (audioAssembly.mode === "windowed-slices") {
    muxAudioPath = await assembleWindowedMasterAudio({
      audioPath: params.audioPath,
      slices: audioAssembly.slices,
      outputPath: buildPreviewOutputPath({
        requestKey: `${params.requestKey}-export-audio`,
        outputDir: getDefaultPreviewOutputDir(),
      }),
      ffmpegPath,
    });
  }

  const args = [
    "-y",
    "-i", videoAsset.outputPath,
    "-i", muxAudioPath,
  ];

  if (effectFilter) {
    args.push("-filter:v", effectFilter);
  }

  args.push(
    "-map", "0:v:0",
    "-map", "1:a:0",
    "-t", `${Math.max(0.05, canonicalDuration)}`,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-c:a", "aac",
    "-shortest",
    "-movflags", "+faststart",
    outputPath,
  );

  await execFileAsync(ffmpegPath, args);

  const outputMetadata = await probeFn(outputPath);
  return {
    requestKey: params.requestKey,
    assetKey: outputPath,
    generatedAt: new Date().toISOString(),
    duration: outputMetadata.duration,
    inputPath: segments[0]?.inputPath ?? "",
    outputPath,
    startTime: segments[0]?.startTime ?? 0,
    endTime: segments[segments.length - 1]?.endTime ?? 0,
    audioPath: muxAudioPath,
    audioMode: audioAssembly.mode,
    effectCues,
    effectFilter,
    hasAudio: "hasAudio" in outputMetadata ? Boolean((outputMetadata as { hasAudio?: boolean }).hasAudio) : true,
    hasVideo: outputMetadata.hasVideo,
    downloadFileName: `${sanitizeFileName(params.requestKey || "music-video")}.mp4`,
  };
}

export function normalizeExportSegments(segments: ExportTimelineSegment[]): ExportTimelineSegment[] {
  return segments
    .map((segment): ExportTimelineSegment | null => {
      const startTime = roundTime(Math.max(0, Number(segment.startTime) || 0));
      const endTime = roundTime(Math.max(startTime, Number(segment.endTime) || 0));
      if (!segment.inputPath || endTime <= startTime) return null;
      const duration = endTime - startTime;
      const musicStart = roundTime(Math.max(0, Number(segment.musicStart) || 0));
      const musicEnd = roundTime(Math.max(musicStart + 0.05, Number(segment.musicEnd) || musicStart + duration));
      const normalized: ExportTimelineSegment = {
        ...segment,
        startTime,
        endTime,
        musicStart,
        musicEnd,
      };
      return normalized;
    })
    .filter((segment): segment is ExportTimelineSegment => segment !== null);
}

export function buildAutoShaderCues(
  segments: ExportTimelineSegment[],
  options: { beats?: number[]; lyricChunks?: Array<{ id?: string; index?: number; start: number; end: number; text?: string }>; presetId?: string | null; accentKinds?: ShaderAccentKinds } = {},
): ShaderEffectCue[] {
  return buildSharedAutoShaderCues({
    segments,
    beats: options.beats,
    lyricChunks: options.lyricChunks,
    presetId: options.presetId,
    accentKinds: options.accentKinds,
  });
}

export async function generateShaderCaptureMp4Export(params: {
  requestKey: string;
  shaderCapturePath: string;
  audioPath: string;
  outputPath?: string;
  ffmpegPath?: string;
  probeFn?: ProbeFn;
}): Promise<ShaderCaptureExportAsset> {
  const ffmpegPath = params.ffmpegPath ?? process.env.FFMPEG_PATH ?? "ffmpeg";
  const probeFn = params.probeFn ?? (async () => ({ duration: 0, hasVideo: false, hasAudio: false }));
  const outputPath = params.outputPath ?? buildPreviewOutputPath({
    requestKey: `${params.requestKey}-webgpu-export`,
    outputDir: getDefaultPreviewOutputDir(),
  });

  await execFileAsync(ffmpegPath, [
    "-y",
    "-i", params.shaderCapturePath,
    "-i", params.audioPath,
    "-map", "0:v:0",
    "-map", "1:a:0",
    "-vf", "fps=24,scale=ceil(iw/2)*2:ceil(ih/2)*2,setsar=1",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "18",
    "-c:a", "aac",
    "-shortest",
    "-movflags", "+faststart",
    outputPath,
  ]);

  const outputMetadata = await probeFn(outputPath);
  return {
    requestKey: params.requestKey,
    assetKey: outputPath,
    outputPath,
    generatedAt: new Date().toISOString(),
    duration: outputMetadata.duration,
    hasAudio: "hasAudio" in outputMetadata ? Boolean((outputMetadata as { hasAudio?: boolean }).hasAudio) : true,
    hasVideo: outputMetadata.hasVideo,
    downloadFileName: `${sanitizeFileName(params.requestKey || "webgpu-music-video")}.mp4`,
  };
}

function roundTime(value: number) {
  return Math.round(value * 1000) / 1000;
}

function sanitizeFileName(value: string) {
  return path.basename(value).replace(/[^a-z0-9._-]+/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "export";
}
