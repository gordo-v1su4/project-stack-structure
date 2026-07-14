import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parseEssentiaPayload } from "../src/components/studio/audioAnalysis";
import { buildSrtChunksFromDeepgram, summarizeDeepgramResponse } from "../src/components/studio/deepgramUtils";
import { createMusicVideoProject, getDefaultStorySectionDrafts } from "../src/components/studio/musicVideoProject";
import { createPersistableStudioProjectDraft } from "../src/components/studio/projectPersistence";
import { normalizeSplitterManifest } from "../src/components/studio/sceneSplit";
import type { BeatJoinAnalysis, UploadedVideoSource } from "../src/components/studio/types";
import { uploadFileToMediaGateway } from "../src/lib/mediaGateway";
import { saveStudioProject } from "../src/lib/studioProjectStore";

type RecordValue = Record<string, unknown>;

const reportPath = process.argv[2] || path.join(process.cwd(), ".tmp", "e2e-validation", "full-media-e2e-2026-07-12T20-38-24-622Z", "report.json");
const ownerId = process.argv[3] || "github-179914528";
const report = JSON.parse(await readFile(reportPath, "utf8")) as RecordValue;
const runKey = requiredString(report.runKey, "run key");
const triggerRuns = record(report.triggerRuns, "trigger runs");
const inputs = record(report.inputs, "inputs");
const inputVideos = array(inputs.videos, "input videos");
const mediaRunIds = stringArray(triggerRuns.mediaParents, "media run ids");
const baseUrl = requiredString(report.baseUrl, "base URL").replace(/\/$/, "");

const [essentiaOutput, deepgramOutput, ...mediaManifests] = await Promise.all([
  triggerOutput(requiredString(triggerRuns.essentia, "Essentia run id")),
  triggerOutput(requiredString(triggerRuns.deepgram, "Deepgram run id")),
  ...mediaRunIds.map((runId) => requestJson(`/api/media/video/jobs/${encodeURIComponent(runId)}/result`)),
]);

const audioInput = record(inputs.audio, "audio input");
const audioPath = requiredString(audioInput.path, "audio path");
const audioBytes = await readFile(audioPath);
const audioUpload = await uploadFileToMediaGateway({
  file: new File([audioBytes], path.basename(audioPath), { type: "audio/wav" }),
  folder: `media-uploads/e2e-validation/${runKey}/sources`,
});
const audioUrl = audioUpload.publicUrl || audioUpload.mediaUrl;
if (!audioUrl) throw new Error("Validation audio upload did not return a media URL.");

const essentia = record(essentiaOutput, "Essentia output");
const energy = numberArray(essentia.energy);
const parsedAnalysis = parseEssentiaPayload({
  payload: essentia,
  fileName: path.basename(audioPath),
  waveform: energy.length ? energy : [0.5],
  waveformDuration: requiredNumber(essentia.duration, "Essentia duration"),
  audioUrl,
});
if (!parsedAnalysis) throw new Error("Could not normalize the validation Essentia result.");
const analysis: BeatJoinAnalysis = {
  ...parsedAnalysis,
  storageProvider: "rustfs",
  storageBucket: audioUpload.bucket,
  storagePath: audioUpload.objectKey,
  storageUrl: audioUrl,
  storageStatus: "uploaded",
  storageError: null,
};

const sources: UploadedVideoSource[] = await Promise.all(mediaManifests.map(async (manifest, index) => {
  const input = record(inputVideos[index], `input video ${index}`);
  const storage = record(input.storage, `input video ${index} storage`);
  const scenes = normalizeSplitterManifest(manifest, index, "");
  const storageUrl = optionalString(storage.publicUrl) || requiredString(storage.mediaUrl, `input video ${index} URL`);
  const fileStats = await stat(requiredString(input.path, `input video ${index} path`));
  return {
    id: index,
    name: requiredString(input.name, `input video ${index} name`),
    duration: requiredNumber(manifest.duration_seconds, `input video ${index} duration`),
    size: fileStats.size,
    thumbnailUrl: scenes[0]?.thumbnailUrl || "",
    videoUrl: storageUrl,
    storageProvider: "rustfs",
    storageBucket: requiredString(storage.bucket, `input video ${index} bucket`),
    storagePath: requiredString(storage.objectKey, `input video ${index} object key`),
    storageUrl,
    storageStatus: "uploaded",
    storageError: null,
    scenes,
    sceneStatus: "ready",
    sceneJobId: mediaRunIds[index],
    sceneError: null,
    captionStatus: "ready",
    captionError: null,
  };
}));

const deepgram = record(deepgramOutput, "Deepgram output");
const transcriptSummary = summarizeDeepgramResponse(deepgram, { duration: analysis.duration });
const lyricChunks = buildSrtChunksFromDeepgram(deepgram, { duration: analysis.duration, chunkDuration: 3 });
const defaults = getDefaultStorySectionDrafts();
const storyBeats = analysis.sections.map((section, index) => {
  const template = defaults[index % defaults.length]!;
  return {
    id: `e2e-section-${index + 1}`,
    label: section.label || template.label,
    prompt: `${template.prompt || section.label}. Match the strongest captioned motion and visual content.`,
  };
});
const project = createMusicVideoProject({
  id: runKey,
  analysis,
  duration: analysis.duration,
  lyricChunks,
  storyDrafts: storyBeats,
  videoSources: sources,
  createdAt: requiredString(report.completedAt, "completion time"),
});

const draft = createPersistableStudioProjectDraft({
  analysis,
  videoSources: sources,
  storyState: {
    vocalStemName: path.basename(audioPath),
    transcriptSummary,
    storyBeats,
    activeBeatId: storyBeats[0]?.id || "",
    storyGenerated: true,
  },
  musicVideoProject: project,
  captionSettings: { mode: "fast" },
  workflowUiSettings: { activeTab: "compose", splitMode: "scene", matchMode: "semantic", shaderPresetId: "balanced-music-video" },
  savedAt: requiredString(report.completedAt, "completion time"),
});

const saved = await saveStudioProject({
  ownerId,
  projectId: runKey,
  name: "Full Media E2E Validation · July 12",
  draft,
});
console.info(JSON.stringify({ id: saved.project.id, name: saved.project.name, status: saved.project.status, videos: saved.project.videoCount, scenes: saved.project.sceneCount, captions: saved.project.captionedSceneCount }, null, 2));

async function triggerOutput(runId: string) {
  const state = await requestJson(`/api/orchestration/runs/${encodeURIComponent(runId)}`);
  return record(state.output, `${runId} output`);
}

async function requestJson(endpoint: string): Promise<RecordValue> {
  const response = await fetch(`${baseUrl}${endpoint}`, { signal: AbortSignal.timeout(60_000) });
  const payload = await response.json() as unknown;
  if (!response.ok) throw new Error(`${endpoint} failed (${response.status}).`);
  return record(payload, endpoint);
}

function record(value: unknown, label: string): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as RecordValue;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}

function stringArray(value: unknown, label: string) {
  const values = array(value, label);
  if (!values.every((entry) => typeof entry === "string")) throw new Error(`${label} must contain strings.`);
  return values as string[];
}

function requiredString(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requiredNumber(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} is required.`);
  return value;
}

function numberArray(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is number => typeof entry === "number" && Number.isFinite(entry)) : [];
}
