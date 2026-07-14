import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

import { buildSrtChunksFromDeepgram, measureDeepgramWordCoverage } from "../src/components/studio/deepgramUtils";
import { parseEssentiaPayload } from "../src/components/studio/audioAnalysis";
import {
  buildEditPlanPreviewSegments,
  createMusicVideoProject,
  getDefaultStorySectionDrafts,
} from "../src/components/studio/musicVideoProject";
import { normalizeSplitterManifest } from "../src/components/studio/sceneSplit";
import type { BeatJoinAnalysis, UploadedVideoSource } from "../src/components/studio/types";

type JsonRecord = Record<string, unknown>;
const execFileAsync = promisify(execFile);

type StoredUpload = {
  bucket: string;
  objectKey: string;
  mediaUrl?: string;
  publicUrl?: string;
  mime?: string;
};

type PreparedVideo = {
  name: string;
  path: string;
  mime: string;
  file: File;
};

const baseUrl = (process.env.STACK_STRUCTURE_E2E_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
const runKey = process.env.STACK_STRUCTURE_E2E_RUN_KEY || `full-media-e2e-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const workspace = path.resolve(process.cwd(), ".tmp", "e2e-validation", runKey);
const fixtureRoot = path.resolve(process.cwd(), ".local-fixtures", "media");
const reportPath = path.join(workspace, "report.json");
const finalOutputPath = path.join(workspace, `${runKey}-final.mp4`);
const previewOutputPath = path.join(workspace, `${runKey}-preview.mp4`);

await mkdir(workspace, { recursive: true });

console.info(`[e2e] run ${runKey}`);
console.info(`[e2e] workspace ${workspace}`);

const videoInputs = await prepareVideos();
const audioPath = path.join(fixtureRoot, "trigger-verification-speech.wav");
const audioFile = await fileFromPath(audioPath, "audio/wav");

console.info("[e2e] uploading three fresh source videos");
const uploadedVideos = await Promise.all(videoInputs.map(async (video) => ({
  video,
  storage: await uploadFile(video.file, `media-uploads/e2e-validation/${runKey}/sources`),
})));

console.info("[e2e] dispatching media parents, Essentia, and Deepgram");
const mediaStarts = await Promise.all(uploadedVideos.map(async ({ storage }) => {
  const response = await postJson("/api/media/video/jobs", {
    bucket: storage.bucket,
    objectKey: storage.objectKey,
    metadata: { validationRun: runKey },
  });
  return requireRecord(response.job, "media job");
}));

const essentiaStart = await postForm("/api/essentia/full?mode=full", formWithFile("file", audioFile));
const deepgramStart = await postBytes("/api/deepgram/transcribe", audioFile, {
  "content-type": "audio/wav",
  "x-audio-filename": audioFile.name,
});

const mediaResultsPromise = Promise.all(mediaStarts.map(async (job, index) => {
  const runId = requireString(job.job_id, "media job id");
  const result = await waitForMediaPipeline(runId, 55 * 60_000);
  return { runId, result, sourceIndex: index };
}));
const essentiaRunId = requireString(essentiaStart.runId, "Essentia run id");
const deepgramRunId = requireString(deepgramStart.runId, "Deepgram run id");
const [mediaResults, essentiaOutput, deepgramOutput] = await Promise.all([
  mediaResultsPromise,
  waitForTriggerRun(essentiaRunId, 12 * 60_000),
  waitForTriggerRun(deepgramRunId, 12 * 60_000),
]);

console.info("[e2e] normalizing scene manifests and captions");
const sources: UploadedVideoSource[] = mediaResults.map(({ result, runId, sourceIndex }) => {
  const upload = uploadedVideos[sourceIndex]!.storage;
  const input = uploadedVideos[sourceIndex]!.video;
  const scenes = normalizeSplitterManifest(result, sourceIndex, "");
  if (!scenes.length) throw new Error(`${input.name} returned no detected scenes.`);
  if (scenes.some((scene) => !scene.caption?.trim())) throw new Error(`${input.name} contains an uncaptioned scene.`);
  const manifest = requireRecord(result, "media manifest");
  return {
    id: sourceIndex,
    name: input.name,
    duration: requireNumber(manifest.duration_seconds, `${input.name} duration`),
    size: input.file.size,
    thumbnailUrl: scenes[0]?.thumbnailUrl || "",
    videoUrl: requireString(upload.mediaUrl || upload.publicUrl, `${input.name} storage URL`),
    storageProvider: "rustfs",
    storageBucket: upload.bucket,
    storagePath: upload.objectKey,
    storageUrl: upload.mediaUrl || upload.publicUrl,
    storageStatus: "uploaded",
    storageError: null,
    scenes,
    sceneStatus: "ready",
    sceneJobId: runId,
    sceneError: null,
    captionStatus: "ready",
    captionError: null,
  };
});

const essentia = requireRecord(essentiaOutput, "Essentia output");
const analysis = parseEssentiaPayload({
  payload: essentia,
  fileName: audioFile.name,
  waveform: numberArray(essentia.energy).length ? numberArray(essentia.energy) : [0.5],
  waveformDuration: requireNumber(essentia.duration, "Essentia duration"),
  audioUrl: "e2e://master-audio",
});
if (!analysis) throw new Error("Essentia output could not be normalized into a BeatJoin analysis.");
applyAudioStorage(analysis, requireRecord(essentiaStart.storage, "Essentia source storage"));

const deepgram = requireRecord(deepgramOutput, "Deepgram output");
const lyricChunks = buildSrtChunksFromDeepgram(deepgram, { duration: analysis.duration, chunkDuration: 3 });
const defaults = getDefaultStorySectionDrafts();
const storyDrafts = analysis.sections.map((section, index) => {
  const template = defaults[index % defaults.length]!;
  return {
    id: `e2e-section-${index + 1}`,
    label: section.label || template.label,
    prompt: `${template.prompt || section.label}. Match the strongest captioned motion and visual content.`,
  };
});

console.info("[e2e] building semantic match plan");
const project = createMusicVideoProject({
  id: runKey,
  analysis,
  duration: analysis.duration,
  lyricChunks,
  storyDrafts,
  videoSources: sources,
  createdAt: new Date().toISOString(),
});
const projectErrors = project.reviewFindings.filter((finding) => finding.severity === "error");
if (projectErrors.length) {
  throw new Error(`Music-video project validation failed: ${projectErrors.map((finding) => finding.message).join(" | ")}`);
}

const previewSegments = buildEditPlanPreviewSegments({ project, videoSources: sources });
if (previewSegments.length < 2) throw new Error("Semantic edit plan did not produce a multi-segment join.");
const exportSegments = previewSegments.map((segment) => {
  const sourceIndex = sources.findIndex((source) => source.videoUrl === segment.videoUrl);
  if (sourceIndex < 0) throw new Error(`Unable to map preview segment ${segment.label} to a source video.`);
  return {
    sourceIndex,
    startTime: segment.startTime,
    endTime: segment.endTime,
    musicStart: segment.musicStart,
    musicEnd: segment.musicEnd,
    label: segment.label,
  };
});
const joinedDuration = exportSegments.reduce((sum, segment) => sum + segment.endTime - segment.startTime, 0);
if (Math.abs(joinedDuration - analysis.duration) > 0.2) {
  throw new Error(`Edit plan covers ${joinedDuration.toFixed(3)}s but audio is ${analysis.duration.toFixed(3)}s.`);
}

console.info(`[e2e] joining ${exportSegments.length} matched segments into a preview`);
const previewForm = new FormData();
previewForm.set("file", videoInputs[0]!.file);
videoInputs.forEach((video, index) => previewForm.set(`file:${index}`, video.file));
previewForm.set("segments", JSON.stringify(exportSegments));
previewForm.set("requestKey", `${runKey}-joined-preview`);
const previewStart = await postForm("/api/preview/gateway", previewForm);
const previewRunId = requireString(previewStart.runId, "preview run id");
const previewOutput = requireRecord(await waitForTriggerRun(previewRunId, 12 * 60_000), "preview output");
await downloadDurableAsset(previewOutput, previewOutputPath);
const previewProbe = await probeMedia(previewOutputPath);
if (!previewProbe.hasVideo || previewProbe.duration <= 0) throw new Error("Joined preview has no valid video stream.");

console.info("[e2e] exporting final edited music video with master audio");
const exportForm = new FormData();
exportForm.set("audio", audioFile);
videoInputs.forEach((video, index) => exportForm.set(`file:${index}`, video.file));
exportForm.set("segments", JSON.stringify(exportSegments));
exportForm.set("requestKey", `${runKey}-final`);
exportForm.set("beats", JSON.stringify(analysis.beats));
exportForm.set("lyricChunks", JSON.stringify(project.lyricChunks));
exportForm.set("shaderPresetId", "balanced-music-video");
const exportStart = await postForm("/api/export/final", exportForm);
const exportRunId = requireString(exportStart.runId, "final export run id");
const exportOutput = requireRecord(await waitForTriggerRun(exportRunId, 30 * 60_000), "final export output");
await downloadDurableAsset(exportOutput, finalOutputPath);
const finalProbe = await probeMedia(finalOutputPath);
if (!finalProbe.hasVideo || !finalProbe.hasAudio) throw new Error("Final export must contain both video and audio streams.");
if (Math.abs(finalProbe.duration - analysis.duration) > 0.25) {
  throw new Error(`Final duration ${finalProbe.duration.toFixed(3)}s does not match ${analysis.duration.toFixed(3)}s.`);
}

const report = {
  schema: "stack-structure.full-media-e2e.v1",
  runKey,
  completedAt: new Date().toISOString(),
  baseUrl,
  inputs: {
    audio: { path: audioPath, duration: analysis.duration },
    videos: videoInputs.map((video, index) => ({
      name: video.name,
      path: video.path,
      storage: uploadedVideos[index]!.storage,
    })),
  },
  triggerRuns: {
    mediaParents: mediaResults.map((entry) => entry.runId),
    essentia: essentiaRunId,
    deepgram: deepgramRunId,
    preview: previewRunId,
    finalExport: exportRunId,
  },
  analysis: {
    bpm: essentia.bpm,
    duration: analysis.duration,
    beatCount: analysis.beats.length,
    onsetCount: analysis.onsets.length,
    sections: analysis.sections,
  },
  transcription: {
    coverage: measureDeepgramWordCoverage(deepgram),
    lyricChunks,
  },
  scenes: sources.map((source) => ({
    sourceId: source.id,
    sourceName: source.name,
    sceneCount: source.scenes?.length ?? 0,
    captions: source.scenes?.map((scene) => ({
      sceneId: scene.id,
      start: scene.start,
      end: scene.end,
      caption: scene.caption,
      captionModel: scene.captionModel,
      contentHash: scene.contentHash,
    })),
  })),
  matching: {
    projectId: project.id,
    storySections: project.storySections.map((section) => ({
      id: section.id,
      label: section.label,
      start: section.start,
      end: section.end,
      selectedMomentId: section.videoMomentIds[0],
      score: section.semanticMatch?.score,
      reasons: section.semanticMatch?.reasons,
    })),
    reviewFindings: project.reviewFindings,
    sourceMomentCount: project.videoMoments.length,
    joinedSegmentCount: exportSegments.length,
    joinedDuration,
  },
  preview: {
    localPath: previewOutputPath,
    probe: previewProbe,
    storage: previewOutput.storage,
  },
  finalExport: {
    localPath: finalOutputPath,
    probe: finalProbe,
    storage: exportOutput.storage,
    videoUrl: exportOutput.videoUrl,
  },
};

await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
console.info(JSON.stringify({
  ok: true,
  runKey,
  reportPath,
  finalOutputPath,
  finalDuration: finalProbe.duration,
  scenes: sources.reduce((sum, source) => sum + (source.scenes?.length ?? 0), 0),
  captions: sources.reduce((sum, source) => sum + (source.scenes?.filter((scene) => scene.caption).length ?? 0), 0),
  matchedSegments: exportSegments.length,
  triggerRuns: report.triggerRuns,
}, null, 2));

async function prepareVideos(): Promise<PreparedVideo[]> {
  const inputs = [
    { source: path.join(fixtureRoot, "trigger-verification-video.mp4"), name: "performance-source.mp4", mime: "video/mp4", transcode: false },
    { source: path.join(fixtureRoot, "trigger-verification-ffglitch.avi"), name: "glitch-source.mp4", mime: "video/mp4", transcode: true },
    { source: path.join(fixtureRoot, "trigger-verification-shader.webm"), name: "shader-source.mp4", mime: "video/mp4", transcode: true },
  ];

  const prepared: PreparedVideo[] = [];
  for (const input of inputs) {
    const target = input.transcode ? path.join(workspace, input.name) : input.source;
    if (input.transcode) {
      const args = [
        "-hide_banner", "-loglevel", "error", "-y", "-i", input.source,
        "-map", "0:v:0", "-an", "-vf", "fps=30,scale=640:360,format=yuv420p",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-movflags", "+faststart", target,
      ];
      try {
        await execFileAsync("ffmpeg", args, { maxBuffer: 4 * 1024 * 1024 });
      } catch (error) {
        const stderr = typeof error === "object" && error && "stderr" in error ? String(error.stderr) : String(error);
        throw new Error(`Failed to prepare ${input.name}: ${stderr.slice(-1_000)}`);
      }
    }
    prepared.push({ name: input.name, path: target, mime: input.mime, file: await fileFromPath(target, input.mime, input.name) });
  }
  return prepared;
}

async function fileFromPath(filePath: string, mime: string, name = path.basename(filePath)) {
  await access(filePath).catch(() => { throw new Error(`Fixture not found: ${filePath}`); });
  return new File([await readFile(filePath)], name, { type: mime });
}

function formWithFile(field: string, file: File) {
  const form = new FormData();
  form.set(field, file);
  return form;
}

async function uploadFile(file: File, folder: string): Promise<StoredUpload> {
  const form = formWithFile("file", file);
  form.set("folder", folder);
  const payload = await postForm("/api/storage/upload", form);
  return {
    bucket: requireString(payload.bucket, "upload bucket"),
    objectKey: requireString(payload.objectKey, "upload object key"),
    mediaUrl: optionalString(payload.mediaUrl),
    publicUrl: optionalString(payload.publicUrl),
    mime: optionalString(payload.mime),
  };
}

async function waitForMediaPipeline(runId: string, timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const state = await getJson(`/api/media/video/jobs/${encodeURIComponent(runId)}`);
    if (state.status === "completed") return getJson(`/api/media/video/jobs/${encodeURIComponent(runId)}/result`);
    if (state.status === "failed") throw new Error(`Media pipeline ${runId} failed: ${String(state.error || state.stage)}`);
    await sleep(2_000);
  }
  throw new Error(`Media pipeline ${runId} timed out after ${Math.round(timeoutMs / 1_000)}s.`);
}

async function waitForTriggerRun(runId: string, timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const state = await getJson(`/api/orchestration/runs/${encodeURIComponent(runId)}`);
    if (state.isCompleted === true) {
      if (state.isSuccess === true) return state.output;
      throw new Error(`Trigger run ${runId} ended ${String(state.status)}: ${String(state.error || "unknown error")}`);
    }
    await sleep(1_500);
  }
  throw new Error(`Trigger run ${runId} timed out after ${Math.round(timeoutMs / 1_000)}s.`);
}

async function postJson(endpoint: string, body: unknown) {
  return requestJson(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

async function postForm(endpoint: string, body: FormData) {
  return requestJson(endpoint, { method: "POST", body });
}

async function postBytes(endpoint: string, file: File, headers: Record<string, string>) {
  return requestJson(endpoint, { method: "POST", headers, body: await file.arrayBuffer() });
}

async function getJson(endpoint: string) {
  return requestJson(endpoint, { method: "GET" });
}

async function requestJson(endpoint: string, init: RequestInit): Promise<JsonRecord> {
  const response = await fetch(`${baseUrl}${endpoint}`, { ...init, signal: AbortSignal.timeout(10 * 60_000) });
  const text = await response.text();
  let payload: unknown = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { error: text.slice(0, 1_000) };
  }
  if (!response.ok) throw new Error(`${init.method || "GET"} ${endpoint} failed (${response.status}): ${JSON.stringify(payload).slice(0, 1_000)}`);
  return requireRecord(payload, `${endpoint} response`);
}

async function downloadDurableAsset(output: JsonRecord, targetPath: string) {
  const storage = requireRecord(output.storage, "durable storage pointer");
  const url = requireString(output.videoUrl || storage.mediaUrl || storage.publicUrl, "durable asset URL");
  const response = await fetch(url, { signal: AbortSignal.timeout(5 * 60_000) });
  if (!response.ok) throw new Error(`Durable asset download failed (${response.status}) from ${url}`);
  await writeFile(targetPath, Buffer.from(await response.arrayBuffer()));
}

async function probeMedia(filePath: string) {
  const args = ["-v", "error", "-show_entries", "format=duration,size:stream=codec_type,codec_name,width,height,sample_rate,channels", "-of", "json", filePath];
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync("ffprobe", args, { maxBuffer: 4 * 1024 * 1024 }));
  } catch (error) {
    const stderr = typeof error === "object" && error && "stderr" in error ? String(error.stderr) : String(error);
    throw new Error(`ffprobe failed for ${filePath}: ${stderr.slice(-1_000)}`);
  }
  const payload = JSON.parse(stdout) as { format?: { duration?: string; size?: string }; streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number; sample_rate?: string; channels?: number }> };
  const streams = payload.streams ?? [];
  return {
    duration: Number(payload.format?.duration || 0),
    size: Number(payload.format?.size || 0),
    hasVideo: streams.some((stream) => stream.codec_type === "video"),
    hasAudio: streams.some((stream) => stream.codec_type === "audio"),
    streams,
  };
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function applyAudioStorage(analysis: BeatJoinAnalysis, storage: JsonRecord) {
  analysis.storageProvider = "rustfs";
  analysis.storageBucket = optionalString(storage.storageBucket);
  analysis.storagePath = optionalString(storage.storagePath);
  analysis.storageUrl = optionalString(storage.storageUrl);
  analysis.storageStatus = "uploaded";
  analysis.storageError = null;
}

function requireRecord(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is missing or invalid.`);
  return value as JsonRecord;
}

function requireString(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is missing.`);
  return value.trim();
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requireNumber(value: unknown, label: string) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} is missing or invalid.`);
  return number;
}

function numberArray(value: unknown) {
  return Array.isArray(value) ? value.map(Number).filter(Number.isFinite) : [];
}
