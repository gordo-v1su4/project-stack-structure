import { execFile } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { attachMotionDescriptorToFile } from "./motionDescriptors";
import type { MotionDescriptor } from "./types";

const execFileAsync = promisify(execFile);

const AUDIO_EXTENSIONS = new Set([".wav", ".mp3", ".m4a", ".aac", ".aif", ".aiff", ".flac", ".ogg"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv"]);

interface FfprobeStreamPayload {
  index?: number;
  codec_type?: string;
  codec_name?: string;
  codec_long_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  sample_rate?: string;
  channels?: number;
  duration?: string;
  bit_rate?: string;
}

interface FfprobeFormatPayload {
  format_name?: string;
  format_long_name?: string;
  duration?: string;
  size?: string;
  bit_rate?: string;
}

interface FfprobePayload {
  streams?: FfprobeStreamPayload[];
  format?: FfprobeFormatPayload;
}

export interface MediaFixtureInventory {
  rootDir: string;
  audio: string[];
  video: string[];
  other: string[];
}

export interface ProbedMediaStream {
  index: number;
  codecType: string;
  codecName: string | null;
  codecLongName: string | null;
  duration: number | null;
  bitRate: number | null;
  width: number | null;
  height: number | null;
  frameRate: number | null;
  sampleRate: number | null;
  channels: number | null;
}

export interface ProbedMediaFile {
  inputPath: string;
  fileName: string;
  extension: string;
  formatName: string | null;
  formatLongName: string | null;
  duration: number;
  size: number;
  bitRate: number | null;
  audioStreams: ProbedMediaStream[];
  videoStreams: ProbedMediaStream[];
  otherStreams: ProbedMediaStream[];
  hasAudio: boolean;
  hasVideo: boolean;
  primaryAudioStream: ProbedMediaStream | null;
  primaryVideoStream: ProbedMediaStream | null;
  motionDescriptor: MotionDescriptor | null;
}

export interface MediaProbeManifestItem {
  id: number;
  inputPath: string;
  fileName: string;
  duration: number;
  size: number;
  hasAudio: boolean;
  hasVideo: boolean;
  width: number | null;
  height: number | null;
  frameRate: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  motionDescriptor: MotionDescriptor | null;
}

export interface MediaProbeManifest {
  rootDir: string;
  generatedAt: string;
  itemCount: number;
  totalDuration: number;
  items: MediaProbeManifestItem[];
}

export function getMediaFixturesDir() {
  const configuredDir = process.env.TEST_MEDIA_DIR?.trim();
  if (configuredDir) {
    return path.resolve(configuredDir);
  }

  return path.join(process.cwd(), ".local-fixtures", "media");
}

export function listMediaFixtures(dir = getMediaFixturesDir()): MediaFixtureInventory {
  if (!existsSync(dir)) {
    return { rootDir: dir, audio: [], video: [], other: [] };
  }

  const entries = readdirSync(dir)
    .filter((name) => !name.startsWith("."))
    .map((name) => path.join(dir, name))
    .filter((entry) => statSync(entry).isFile())
    .sort((left, right) => left.localeCompare(right));

  const audio: string[] = [];
  const video: string[] = [];
  const other: string[] = [];

  for (const entry of entries) {
    const extension = path.extname(entry).toLowerCase();
    if (AUDIO_EXTENSIONS.has(extension)) {
      audio.push(entry);
      continue;
    }
    if (VIDEO_EXTENSIONS.has(extension)) {
      video.push(entry);
      continue;
    }
    other.push(entry);
  }

  return { rootDir: dir, audio, video, other };
}

export async function probeMediaFile(filePath: string, ffprobePath = process.env.FFPROBE_PATH || "ffprobe") {
  const resolved = path.resolve(filePath);
  const { stdout } = await execFileAsync(ffprobePath, [
    "-v",
    "error",
    "-show_format",
    "-show_streams",
    "-print_format",
    "json",
    resolved,
  ]);

  return parseMediaProbePayload(JSON.parse(stdout) as FfprobePayload, resolved);
}

export async function probeFixtureInventory(dir = getMediaFixturesDir()) {
  const inventory = listMediaFixtures(dir);
  const targets = [...inventory.audio, ...inventory.video];
  const files = await Promise.all(targets.map((filePath) => probeMediaFile(filePath)));

  return {
    inventory,
    files,
    manifest: buildMediaProbeManifest(files, inventory.rootDir),
  };
}

export function parseMediaProbePayload(payload: FfprobePayload, inputPath: string): ProbedMediaFile {
  const streams = (payload.streams ?? []).map(normalizeStream);
  const format = payload.format ?? {};
  const audioStreams = streams.filter((stream) => stream.codecType === "audio");
  const videoStreams = streams.filter((stream) => stream.codecType === "video");
  const otherStreams = streams.filter((stream) => stream.codecType !== "audio" && stream.codecType !== "video");

  const stats = statSync(inputPath);
  const duration = coerceNumber(format.duration) ?? videoStreams[0]?.duration ?? audioStreams[0]?.duration ?? 0;

  const baseFile: ProbedMediaFile = {
    inputPath,
    fileName: path.basename(inputPath),
    extension: path.extname(inputPath).toLowerCase(),
    formatName: normalizeString(format.format_name),
    formatLongName: normalizeString(format.format_long_name),
    duration,
    size: coerceInteger(format.size) ?? stats.size,
    bitRate: coerceInteger(format.bit_rate),
    audioStreams,
    videoStreams,
    otherStreams,
    hasAudio: audioStreams.length > 0,
    hasVideo: videoStreams.length > 0,
    primaryAudioStream: audioStreams[0] ?? null,
    primaryVideoStream: videoStreams[0] ?? null,
    motionDescriptor: null,
  };

  return videoStreams.length > 0 ? attachMotionDescriptorToFile(baseFile) : baseFile;
}

export function buildMediaProbeManifest(files: ProbedMediaFile[], rootDir = getMediaFixturesDir()): MediaProbeManifest {
  const items = files
    .slice()
    .sort((left, right) => left.fileName.localeCompare(right.fileName))
    .map((file, index) => ({
      id: index,
      inputPath: file.inputPath,
      fileName: file.fileName,
      duration: file.duration,
      size: file.size,
      hasAudio: file.hasAudio,
      hasVideo: file.hasVideo,
      width: file.primaryVideoStream?.width ?? null,
      height: file.primaryVideoStream?.height ?? null,
      frameRate: file.primaryVideoStream?.frameRate ?? null,
      videoCodec: file.primaryVideoStream?.codecName ?? null,
      audioCodec: file.primaryAudioStream?.codecName ?? null,
      motionDescriptor: file.motionDescriptor,
    }));

  return {
    rootDir,
    generatedAt: new Date().toISOString(),
    itemCount: items.length,
    totalDuration: items.reduce((sum, item) => sum + item.duration, 0),
    items,
  };
}

function normalizeStream(stream: FfprobeStreamPayload): ProbedMediaStream {
  return {
    index: stream.index ?? 0,
    codecType: normalizeString(stream.codec_type) ?? "unknown",
    codecName: normalizeString(stream.codec_name),
    codecLongName: normalizeString(stream.codec_long_name),
    duration: coerceNumber(stream.duration),
    bitRate: coerceInteger(stream.bit_rate),
    width: stream.width ?? null,
    height: stream.height ?? null,
    frameRate: parseFrameRate(stream.avg_frame_rate ?? stream.r_frame_rate),
    sampleRate: coerceInteger(stream.sample_rate),
    channels: stream.channels ?? null,
  };
}

function parseFrameRate(value: string | undefined) {
  if (!value || value === "0/0") return null;
  const [numeratorRaw, denominatorRaw] = value.split("/");
  const numerator = Number(numeratorRaw);
  const denominator = Number(denominatorRaw ?? 1);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return numerator / denominator;
}

function coerceNumber(value: string | number | undefined) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function coerceInteger(value: string | number | undefined) {
  const parsed = coerceNumber(value);
  return parsed === null ? null : Math.round(parsed);
}

function normalizeString(value: string | undefined) {
  return value && value.trim() ? value : null;
}
