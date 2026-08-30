import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

import {
  buildSrtChunksFromDeepgram,
  measureDeepgramWordCoverage,
  summarizeDeepgramResponse,
} from "../src/components/studio/deepgramUtils";
import { parseEssentiaPayload } from "../src/components/studio/audioAnalysis";
import { listMediaFixtures } from "../src/components/studio/mediaProbe";
import {
  buildEditPlanPreviewSegments,
  createMusicVideoProject,
  DEFAULT_STORY_EDIT_SETTINGS,
  getDefaultStorySectionDrafts,
} from "../src/components/studio/musicVideoProject";
import { createPersistableStudioProjectDraft } from "../src/components/studio/projectPersistence";
import {
  createLocalReferenceAsset,
  defaultReferenceKindForRole,
  type ReferenceAsset,
  type ReferenceAssetLibraryRole,
} from "../src/components/studio/referenceAssets";
import { normalizeSplitterManifest } from "../src/components/studio/sceneSplit";
import type { BeatJoinAnalysis, UploadedVideoSource } from "../src/components/studio/types";

type JsonRecord = Record<string, unknown>;
type FixtureMode = "studio" | "trigger-smoke";
type StudioReferenceFixtureKey = "character-1" | "character-2" | "environment" | "crowd-1" | "crowd-2" | "crowd-3";

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

type FixtureLane = {
  mode: FixtureMode;
  masterAudioPath: string;
  masterAudioFile: File;
  vocalStemPath: string;
  vocalStemFile: File;
  videoInputs: PreparedVideo[];
  referenceSheetPaths: Record<StudioReferenceFixtureKey, string>;
};

const EXPECTED_STUDIO_VIDEO_COUNT = 21;
const STUDIO_REFERENCE_FIXTURES: ReadonlyArray<{
  key: StudioReferenceFixtureKey;
  role: ReferenceAssetLibraryRole;
  displayName: string;
}> = [
  { key: "character-1", role: "character-1", displayName: "Diego" },
  { key: "character-2", role: "character-2", displayName: "Valentina" },
  { key: "environment", role: "environment", displayName: "Underground Latin Club" },
  { key: "crowd-1", role: "crowd", displayName: "Underground Club Crowd 1" },
  { key: "crowd-2", role: "crowd", displayName: "Underground Club Crowd 2" },
  { key: "crowd-3", role: "crowd", displayName: "Underground Club Crowd 3" },
];

const baseUrl = (process.env.STACK_STRUCTURE_E2E_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
const runKey = process.env.STACK_STRUCTURE_E2E_RUN_KEY || `full-media-e2e-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const fixtureMode: FixtureMode = process.env.STACK_STRUCTURE_E2E_FIXTURE_MODE === "trigger-smoke" ? "trigger-smoke" : "studio";
const includeExport = process.env.STACK_STRUCTURE_E2E_INCLUDE_EXPORT === "true"
  || (fixtureMode === "trigger-smoke" && process.env.STACK_STRUCTURE_E2E_INCLUDE_EXPORT !== "false");
// SECURITY: every API route requires an authenticated session, so the cookie is
// attached to all requests. Dispatch and polling identities must match for the
// Trigger user-tag authorization to accept run lookups.
const e2eCookie = process.env.STACK_STRUCTURE_E2E_COOKIE || "";
const workspace = path.resolve(process.cwd(), ".tmp", "e2e-validation", runKey);
const fixtureRoot = path.resolve(process.cwd(), process.env.TEST_MEDIA_DIR || ".local-fixtures/media");
const reportPath = path.join(workspace, "report.json");
const finalOutputPath = path.join(workspace, `${runKey}-final.mp4`);
const previewOutputPath = path.join(workspace, `${runKey}-preview.mp4`);
const essentiaTimeoutMs = fixtureMode === "studio" ? 20 * 60_000 : 12 * 60_000;
const deepgramTimeoutMs = fixtureMode === "studio" ? 25 * 60_000 : 12 * 60_000;

await mkdir(workspace, { recursive: true });

console.info(`[e2e] run ${runKey}`);
console.info(`[e2e] fixture mode ${fixtureMode}`);
console.info(`[e2e] workspace ${workspace}`);

const fixtureLane = await resolveFixtureLane(fixtureMode, workspace);
const {
  masterAudioPath,
  masterAudioFile,
  vocalStemPath,
  vocalStemFile,
  videoInputs,
  referenceSheetPaths,
} = fixtureLane;

console.info(`[e2e] uploading ${videoInputs.length} source video(s)`);
const uploadFolder = `media-uploads/e2e-validation/${runKey}/sources`;
const uploadedVideos = await Promise.all(videoInputs.map(async (video) => ({
  video,
  storage: await uploadFile(video.file, uploadFolder),
})));

let referenceAssets: ReferenceAsset[] = [];
if (fixtureMode === "studio") {
  console.info("[e2e] uploading canonical reference sheets (Diego, Valentina, environment, three crowds)");
  referenceAssets = await Promise.all(
    STUDIO_REFERENCE_FIXTURES.map(async ({ key, role, displayName }) => {
      const sheetPath = referenceSheetPaths[key];
      const mime = imageMimeForPath(sheetPath);
      const file = await fileFromPath(sheetPath, mime);
      return uploadReferenceAsset(file, role, displayName);
    }),
  );
}

console.info("[e2e] dispatching media parents, Essentia (master), and Deepgram (vocal stem)");
const mediaStarts = await Promise.all(uploadedVideos.map(async ({ storage }) => {
  const response = await postJson("/api/media/video/jobs", {
    bucket: storage.bucket,
    objectKey: storage.objectKey,
    metadata: { validationRun: runKey, fixtureMode },
  });
  return requireRecord(response.job, "media job");
}));

const essentiaStart = await postForm("/api/essentia/full?mode=full", formWithFile("file", masterAudioFile));
const deepgramStart = await postBytes("/api/deepgram/transcribe", vocalStemFile, {
  "content-type": vocalStemFile.type || "audio/wav",
  "x-audio-filename": vocalStemFile.name,
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
  waitForTriggerRun(essentiaRunId, essentiaTimeoutMs),
  waitForTriggerRun(deepgramRunId, deepgramTimeoutMs),
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
  fileName: masterAudioFile.name,
  waveform: numberArray(essentia.energy).length ? numberArray(essentia.energy) : [0.5],
  waveformDuration: requireNumber(essentia.duration, "Essentia duration"),
  audioUrl: "e2e://master-audio",
});
if (!analysis) throw new Error("Essentia output could not be normalized into a BeatJoin analysis.");
applyAudioStorage(analysis, requireRecord(essentiaStart.storage, "Essentia source storage"));

const deepgram = requireRecord(deepgramOutput, "Deepgram output");
const lyricChunks = buildSrtChunksFromDeepgram(deepgram, { duration: analysis.duration, chunkDuration: 3 });
const transcriptSummary = summarizeDeepgramResponse(deepgram, { duration: analysis.duration });
const storyBeats = fixtureMode === "studio"
  ? getDefaultStorySectionDrafts().map((draft, index) => ({
    id: draft.id ?? `section-${index + 1}`,
    label: draft.label,
    prompt: draft.prompt ?? "Describe the visual idea for this song section",
  }))
  : analysis.sections.map((section, index) => {
    const template = getDefaultStorySectionDrafts()[index % getDefaultStorySectionDrafts().length]!;
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
  storyDrafts: storyBeats,
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
if (includeExport && Math.abs(joinedDuration - analysis.duration) > 0.2) {
  throw new Error(`Edit plan covers ${joinedDuration.toFixed(3)}s but audio is ${analysis.duration.toFixed(3)}s.`);
}

let previewRunId: string | undefined;
let previewOutput: JsonRecord | undefined;
let previewProbe: Awaited<ReturnType<typeof probeMedia>> | undefined;
let exportRunId: string | undefined;
let exportOutput: JsonRecord | undefined;
let finalProbe: Awaited<ReturnType<typeof probeMedia>> | undefined;

if (includeExport) {
  console.info(`[e2e] joining ${exportSegments.length} matched segments into a preview`);
  const previewForm = new FormData();
  previewForm.set("file", videoInputs[0]!.file);
  videoInputs.forEach((video, index) => previewForm.set(`file:${index}`, video.file));
  previewForm.set("segments", JSON.stringify(exportSegments));
  previewForm.set("requestKey", `${runKey}-joined-preview`);
  const previewStart = await postForm("/api/preview/gateway", previewForm);
  previewRunId = requireString(previewStart.runId, "preview run id");
  previewOutput = requireRecord(await waitForTriggerRun(previewRunId, 12 * 60_000), "preview output");
  await downloadDurableAsset(previewOutput, previewOutputPath);
  previewProbe = await probeMedia(previewOutputPath);
  if (!previewProbe.hasVideo || previewProbe.duration <= 0) throw new Error("Joined preview has no valid video stream.");

  console.info("[e2e] exporting final edited music video with master audio");
  const exportForm = new FormData();
  exportForm.set("audio", masterAudioFile);
  videoInputs.forEach((video, index) => exportForm.set(`file:${index}`, video.file));
  exportForm.set("segments", JSON.stringify(exportSegments));
  exportForm.set("requestKey", `${runKey}-final`);
  exportForm.set("beats", JSON.stringify(analysis.beats));
  exportForm.set("lyricChunks", JSON.stringify(project.lyricChunks));
  exportForm.set("shaderPresetId", "balanced-music-video");
  const exportStart = await postForm("/api/export/final", exportForm);
  exportRunId = requireString(exportStart.runId, "final export run id");
  exportOutput = requireRecord(await waitForTriggerRun(exportRunId, 30 * 60_000), "final export output");
  await downloadDurableAsset(exportOutput, finalOutputPath);
  finalProbe = await probeMedia(finalOutputPath);
  if (!finalProbe.hasVideo || !finalProbe.hasAudio) throw new Error("Final export must contain both video and audio streams.");
  if (Math.abs(finalProbe.duration - analysis.duration) > 0.25) {
    throw new Error(`Final duration ${finalProbe.duration.toFixed(3)}s does not match ${analysis.duration.toFixed(3)}s.`);
  }
} else {
  console.info("[e2e] ingest + match complete (preview/export skipped for studio lane; set STACK_STRUCTURE_E2E_INCLUDE_EXPORT=true to run export)");
}

if (fixtureMode === "studio") {
  const draft = createPersistableStudioProjectDraft({
    analysis,
    videoSources: sources,
    storyState: {
      vocalStemName: vocalStemFile.name,
      transcriptSummary,
      storyBeats,
      activeBeatId: storyBeats[0]?.id ?? "intro",
      storyGenerated: true,
      editSettings: DEFAULT_STORY_EDIT_SETTINGS,
    },
    musicVideoProject: project,
    referenceAssets,
    generatedAssets: [],
    captionSettings: { mode: "fast" },
    workflowUiSettings: {
      activeTab: "story",
      splitMode: "scene",
      matchMode: "semantic",
      colorGradient: "Sunset",
      shaderPresetId: "high-energy-glitch",
      isPreviewExpanded: false,
    },
  });
  const savedDraft = await saveStudioDraft(draft);
  console.info(`[e2e] studio draft saved at ${savedDraft.savedAt}`);
}

const report = {
  schema: "stack-structure.full-media-e2e.v2",
  runKey,
  fixtureMode,
  includeExport,
  completedAt: new Date().toISOString(),
  baseUrl,
  inputs: {
    masterAudio: { path: masterAudioPath, duration: analysis.duration },
    vocalStem: { path: vocalStemPath },
    referenceSheets: referenceAssets.map((asset) => ({
      role: asset.role,
      fileName: asset.fileName,
      storagePath: asset.storagePath,
      storageUrl: asset.storageUrl,
    })),
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
    transcriptSummary,
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
  preview: previewOutput && previewProbe ? {
    localPath: previewOutputPath,
    probe: previewProbe,
    storage: previewOutput.storage,
  } : null,
  finalExport: exportOutput && finalProbe ? {
    localPath: finalOutputPath,
    probe: finalProbe,
    storage: exportOutput.storage,
    videoUrl: exportOutput.videoUrl,
  } : null,
  studioDraft: fixtureMode === "studio" ? { endpoint: `${baseUrl}/api/studio/draft` } : null,
};

await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
console.info(JSON.stringify({
  ok: true,
  runKey,
  fixtureMode,
  includeExport,
  reportPath,
  finalOutputPath: includeExport ? finalOutputPath : null,
  finalDuration: finalProbe?.duration,
  scenes: sources.reduce((sum, source) => sum + (source.scenes?.length ?? 0), 0),
  captions: sources.reduce((sum, source) => sum + (source.scenes?.filter((scene) => scene.caption).length ?? 0), 0),
  matchedSegments: exportSegments.length,
  referenceAssets: referenceAssets.length,
  triggerRuns: report.triggerRuns,
  studioDraft: report.studioDraft,
}, null, 2));

async function resolveFixtureLane(mode: FixtureMode, workDir: string): Promise<FixtureLane> {
  if (mode === "trigger-smoke") {
    const speechPath = path.join(fixtureRoot, "trigger-verification-speech.wav");
    const speechFile = await fileFromPath(speechPath, "audio/wav");
    return {
      mode,
      masterAudioPath: speechPath,
      masterAudioFile: speechFile,
      vocalStemPath: speechPath,
      vocalStemFile: speechFile,
      videoInputs: await prepareTriggerSmokeVideos(workDir),
      referenceSheetPaths: {
        "character-1": "",
        "character-2": "",
        environment: "",
        "crowd-1": "",
        "crowd-2": "",
        "crowd-3": "",
      },
    };
  }

  const stemFolder = path.join(fixtureRoot, "Love me tonight (Remastered x2) Stems (132BPM)");
  const masterAudioPath = path.join(stemFolder, "Love me tonight (fullsong).wav");
  const vocalStemPath = path.join(stemFolder, "Love me tonight - stem-only-Lead Vocal.wav");
  const masterAudioFile = await fileFromPath(masterAudioPath, "audio/wav");
  const vocalStemFile = await fileFromPath(vocalStemPath, "audio/wav");

  const studioVideoDir = path.join(fixtureRoot, "videos-to-test-with");
  const videoPaths = listMediaFixtures(studioVideoDir).video
    .filter((filePath) => path.dirname(filePath) === studioVideoDir)
    .sort();
  if (videoPaths.length !== EXPECTED_STUDIO_VIDEO_COUNT) {
    throw new Error(
      `Expected exactly ${EXPECTED_STUDIO_VIDEO_COUNT} studio source videos under ${studioVideoDir}, found ${videoPaths.length}. Restore the canonical 2026-08-30 fixture bundle before running the E2E.`,
    );
  }

  const videoInputs = await Promise.all(videoPaths.map(async (filePath) => {
    const name = path.basename(filePath);
    const file = await fileFromPath(filePath, "video/mp4", name);
    return { name, path: filePath, mime: "video/mp4", file };
  }));

  const referenceSheetPaths = {
    "character-1": await resolveReferenceSheetPath("character-1"),
    "character-2": await resolveReferenceSheetPath("character-2"),
    environment: await resolveReferenceSheetPath("environment"),
    "crowd-1": await resolveReferenceSheetPath("crowd-1"),
    "crowd-2": await resolveReferenceSheetPath("crowd-2"),
    "crowd-3": await resolveReferenceSheetPath("crowd-3"),
  };

  return {
    mode,
    masterAudioPath,
    masterAudioFile,
    vocalStemPath,
    vocalStemFile,
    videoInputs,
    referenceSheetPaths,
  };
}

async function resolveReferenceSheetPath(key: StudioReferenceFixtureKey): Promise<string> {
  const sheetDir = path.join(fixtureRoot, "reference-sheets");
  const candidate = path.join(sheetDir, `${key}.png`);
  await access(candidate).catch(() => {
    throw new Error(
      `Missing canonical ${key} reference sheet at ${candidate}. Install the 2026-08-30 fixture bundle; older or similarly named sheets are intentionally not accepted.`,
    );
  });
  return candidate;
}

async function prepareTriggerSmokeVideos(workDir: string): Promise<PreparedVideo[]> {
  const inputs = [
    { source: path.join(fixtureRoot, "trigger-verification-video.mp4"), name: "performance-source.mp4", mime: "video/mp4", transcode: false },
    { source: path.join(fixtureRoot, "trigger-verification-ffglitch.avi"), name: "glitch-source.mp4", mime: "video/mp4", transcode: true },
    { source: path.join(fixtureRoot, "trigger-verification-shader.webm"), name: "shader-source.mp4", mime: "video/mp4", transcode: true },
  ];

  const prepared: PreparedVideo[] = [];
  for (const input of inputs) {
    const target = input.transcode ? path.join(workDir, input.name) : input.source;
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

async function uploadReferenceAsset(
  file: File,
  role: ReferenceAssetLibraryRole,
  displayName: string,
): Promise<ReferenceAsset> {
  const folder = `reference-assets/${role}/e2e-validation/${runKey}`;
  const form = formWithFile("file", file);
  form.set("folder", folder);
  const payload = await postForm("/api/storage/upload", form);
  const storageUrl = requireString(payload.publicUrl || payload.mediaUrl, `${role} storage URL`);
  const storagePath = requireString(payload.objectKey || payload.storagePath, `${role} storage path`);
  const local = createLocalReferenceAsset({
    role,
    file,
    previewUrl: storageUrl,
    kind: defaultReferenceKindForRole(role),
    displayName,
  });
  return {
    ...local,
    previewUrl: storageUrl,
    storageProvider: "rustfs",
    storageBucket: optionalString(payload.bucket),
    storagePath,
    storageUrl,
    storageStatus: "uploaded",
    storageError: null,
  };
}

async function saveStudioDraft(draft: ReturnType<typeof createPersistableStudioProjectDraft>) {
  const response = await requestJson("/api/studio/draft", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ draft }),
  });
  if (!response.success) throw new Error(`Studio draft save failed: ${String(response.error || "unknown error")}`);
  const savedAt = requireString(requireRecord(response.draft, "saved studio draft").savedAt, "saved studio draft timestamp");
  return { savedAt };
}

function imageMimeForPath(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  return "image/jpeg";
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
  const headers = new Headers(init.headers);
  if (e2eCookie) headers.set("cookie", e2eCookie);
  const response = await fetch(`${baseUrl}${endpoint}`, { ...init, headers, signal: AbortSignal.timeout(10 * 60_000) });
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
