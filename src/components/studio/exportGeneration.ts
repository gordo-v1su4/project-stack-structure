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
      }))
    .map(normalizeShaderCue)
    .filter((cue): cue is ShaderEffectCue => cue !== null);
  const effectFilter = buildFfmpegShaderFilter(effectCues);

  const args = [
    "-y",
    "-i", videoAsset.outputPath,
    "-i", params.audioPath,
  ];

  if (effectFilter) {
    args.push("-filter:v", effectFilter);
  }

  args.push(
    "-map", "0:v:0",
    "-map", "1:a:0",
    "-t", `${Math.max(0.05, videoAsset.duration)}`,
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
    audioPath: params.audioPath,
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
  options: { beats?: number[]; lyricChunks?: Array<{ id?: string; index?: number; start: number; end: number; text?: string }>; presetId?: string | null } = {},
): ShaderEffectCue[] {
  return buildSharedAutoShaderCues({
    segments,
    beats: options.beats,
    lyricChunks: options.lyricChunks,
    presetId: options.presetId,
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
