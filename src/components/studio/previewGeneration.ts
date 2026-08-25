import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { getDefaultPreviewOutputDir } from "./previewAssetPath";
import type { SectionPreviewReadyAsset } from "./sectionRecompute";

const execFileAsync = promisify(execFile);
const PREVIEW_OUTPUT_DIR = getDefaultPreviewOutputDir();

export type ProbeFn = (filePath: string) => Promise<{ duration: number; hasVideo: boolean }>;

const stubProbeFn: ProbeFn = async () => ({ duration: 0, hasVideo: false });

export type PreviewGenerationErrorCode =
  | "invalid-window"
  | "missing-input"
  | "audio-only-input"
  | "ffmpeg-failed"
  | "music-window-mismatch";

export class PreviewGenerationError extends Error {
  code: PreviewGenerationErrorCode;

  constructor(code: PreviewGenerationErrorCode, message: string) {
    super(message);
    this.name = "PreviewGenerationError";
    this.code = code;
  }
}

export interface PreviewGenerationParams {
  inputPath: string;
  outputPath?: string;
  requestKey: string;
  startTime: number;
  endTime: number;
  ffmpegPath?: string;
  probeFn?: ProbeFn;
}

export interface GeneratedPreviewAsset extends SectionPreviewReadyAsset {
  inputPath: string;
  outputPath: string;
  startTime: number;
  endTime: number;
}

export function buildPreviewOutputPath(params: {
  requestKey: string;
  outputDir?: string;
  extension?: string;
}) {
  const outputDir = params.outputDir ?? PREVIEW_OUTPUT_DIR;
  const extension = params.extension ?? ".mp4";
  return path.join(/*turbopackIgnore: true*/ outputDir, `${sanitizeFileName(params.requestKey)}${extension}`);
}

export async function generateSectionPreview(params: PreviewGenerationParams): Promise<GeneratedPreviewAsset> {
  const ffmpegPath = params.ffmpegPath ?? process.env.FFMPEG_PATH ?? "ffmpeg";
  const probeFn = params.probeFn ?? stubProbeFn;
  const outputPath = params.outputPath ?? buildPreviewOutputPath({ requestKey: params.requestKey });
  const startTime = clampTime(params.startTime);
  const endTime = clampTime(params.endTime);

  validatePreviewWindow(startTime, endTime);
  await mkdir(path.dirname(outputPath), { recursive: true });

  const inputMetadata = await safeProbeInput(params.inputPath, probeFn);
  if (!inputMetadata.hasVideo) {
    throw new PreviewGenerationError("audio-only-input", "Preview generation requires a video source.");
  }

  try {
    await execFileAsync(ffmpegPath, [
      "-y",
      "-ss",
      `${startTime}`,
      "-to",
      `${endTime}`,
      "-i",
      params.inputPath,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "20",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      outputPath,
    ]);
  } catch (error) {
    throw new PreviewGenerationError(
      "ffmpeg-failed",
      error instanceof Error ? error.message : "ffmpeg preview generation failed",
    );
  }

  const metadata = await probeFn(outputPath);
  const requestedDuration = roundDuration(endTime - startTime);
  if (!isPreviewDurationWithinTolerance(metadata.duration, requestedDuration)) {
    throw new PreviewGenerationError(
      "music-window-mismatch",
      `Preview duration ${metadata.duration.toFixed(3)}s drifted outside the requested ${requestedDuration.toFixed(3)}s window.`,
    );
  }

  return {
    requestKey: params.requestKey,
    assetKey: outputPath,
    generatedAt: new Date().toISOString(),
    duration: metadata.duration,
    inputPath: params.inputPath,
    outputPath,
    startTime,
    endTime,
  } satisfies GeneratedPreviewAsset;
}

export interface ConcatPreviewSegment {
  inputPath: string;
  startTime: number;
  endTime: number;
}

export async function generateConcatPreview(params: {
  segments: ConcatPreviewSegment[];
  requestKey: string;
  outputPath?: string;
  ffmpegPath?: string;
  probeFn?: ProbeFn;
}): Promise<GeneratedPreviewAsset> {
  const ffmpegPath = params.ffmpegPath ?? process.env.FFMPEG_PATH ?? "ffmpeg";
  const probeFn = params.probeFn ?? stubProbeFn;
  const outputPath = params.outputPath ?? buildPreviewOutputPath({ requestKey: params.requestKey });
  const segments = params.segments.filter(
    (segment) => segment.inputPath && segment.endTime > segment.startTime
  );

  if (segments.length === 0) {
    throw new PreviewGenerationError("invalid-window", "No valid segments for concat preview.");
  }

  if (segments.length === 1) {
    const segment = segments[0];
    return generateSectionPreview({
      inputPath: segment.inputPath,
      requestKey: params.requestKey,
      startTime: segment.startTime,
      endTime: segment.endTime,
      outputPath,
      ffmpegPath,
      probeFn,
    });
  }

  await mkdir(path.dirname(outputPath), { recursive: true });

  const segmentPaths: string[] = [];
  const outputDir = path.dirname(outputPath);
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]!;
    const segmentOutputPath = buildPreviewOutputPath({
      requestKey: `${sanitizeFileName(params.requestKey)}-part${index}`,
      outputDir,
    });
    await mkdir(path.dirname(segmentOutputPath), { recursive: true });

    const inputMetadata = await safeProbeInput(segment.inputPath, probeFn);
    if (!inputMetadata.hasVideo) {
      throw new PreviewGenerationError("audio-only-input", `Concat segment ${index} has no video stream.`);
    }

    const segmentDuration = roundDuration(clampTime(segment.endTime) - clampTime(segment.startTime));
    try {
      await execFileAsync(ffmpegPath, [
        "-y",
        "-ss", `${clampTime(segment.startTime)}`,
        "-i", segment.inputPath,
        "-t", `${segmentDuration}`,
        "-map", "0:v:0",
        "-vf", "fps=24,scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,setpts=PTS-STARTPTS",
        "-an",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "20",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        segmentOutputPath,
      ]);
    } catch (segmentError) {
      throw new PreviewGenerationError(
        "ffmpeg-failed",
        segmentError instanceof Error ? segmentError.message : `ffmpeg concat segment ${index} failed`,
      );
    }

    segmentPaths.push(segmentOutputPath);
  }

  const concatListPath = buildPreviewOutputPath({
    requestKey: `${sanitizeFileName(params.requestKey)}-concat-list`,
    outputDir,
    extension: ".txt",
  });

  const concatEntries = segmentPaths
    .map((segmentPath) => `file '${segmentPath.replace(/'/g, "''")}'`)
    .join("\n");
  await writeFile(concatListPath, concatEntries, "utf-8");

  const expectedDuration = roundDuration(
    segments.reduce((total, segment) => total + (clampTime(segment.endTime) - clampTime(segment.startTime)), 0),
  );

  try {
    await execFileAsync(ffmpegPath, [
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", concatListPath,
      "-map", "0:v:0",
      "-an",
      "-t", `${expectedDuration}`,
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "20",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      outputPath,
    ]);
  } catch (error) {
    throw new PreviewGenerationError(
      "ffmpeg-failed",
      error instanceof Error ? error.message : "ffmpeg concat merge failed",
    );
  }

  const metadata = await probeFn(outputPath);
  if (!isPreviewDurationWithinTolerance(metadata.duration, expectedDuration)) {
    throw new PreviewGenerationError(
      "music-window-mismatch",
      `Concat preview duration ${metadata.duration.toFixed(3)}s drifted outside the canonical ${expectedDuration.toFixed(3)}s timeline.`,
    );
  }

  return {
    requestKey: params.requestKey,
    assetKey: outputPath,
    generatedAt: new Date().toISOString(),
    duration: metadata.duration,
    inputPath: segments[0].inputPath,
    outputPath,
    startTime: segments[0].startTime,
    endTime: segments[segments.length - 1].endTime,
  } satisfies GeneratedPreviewAsset;
}

export function isPreviewDurationWithinTolerance(actualDuration: number, requestedDuration: number, tolerance = 0.15) {
  return Math.abs(actualDuration - requestedDuration) <= tolerance;
}

export function createTempPreviewPath(requestKey: string) {
  return buildPreviewOutputPath({
    requestKey,
    outputDir: PREVIEW_OUTPUT_DIR,
  });
}

function validatePreviewWindow(startTime: number, endTime: number) {
  if (startTime < 0 || endTime <= startTime) {
    throw new PreviewGenerationError(
      "invalid-window",
      "Preview generation requires a positive time window where endTime > startTime.",
    );
  }
}

async function safeProbeInput(inputPath: string, probeFn: ProbeFn) {
  try {
    return await probeFn(inputPath);
  } catch (error) {
    if (error instanceof Error && /no such file|not found|cannot find/i.test(error.message)) {
      throw new PreviewGenerationError("missing-input", `Preview input not found: ${inputPath}`);
    }

    if (error instanceof Error && /No such file or directory/i.test(error.message)) {
      throw new PreviewGenerationError("missing-input", `Preview input not found: ${inputPath}`);
    }

    throw error;
  }
}

function roundDuration(value: number) {
  return Math.round(value * 1000) / 1000;
}

function clampTime(value: number) {
  return Math.round(value * 1000) / 1000;
}

function sanitizeFileName(value: string) {
  return value.replace(/[^a-z0-9._-]+/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "preview";
}
