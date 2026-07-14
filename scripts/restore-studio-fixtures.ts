import { loadEnvConfig } from "@next/env";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { parseEssentiaPayload } from "../src/components/studio/audioAnalysis";
import { normalizeSplitterManifest } from "../src/components/studio/sceneSplit";
import { getDefaultStorySectionDrafts, createMusicVideoProject, DEFAULT_STORY_EDIT_SETTINGS } from "../src/components/studio/musicVideoProject";
import { getMediaFixturesDir, listMediaFixtures, probeMediaFile } from "../src/components/studio/mediaProbe";
import { createPersistableStudioProjectDraft, type PersistedStudioProjectDraft } from "../src/components/studio/projectPersistence";
import type { BeatJoinAnalysis, UploadedVideoSource } from "../src/components/studio/types";
import { createMediaGatewayVideoJob, getMediaGatewayVideoJob, getMediaGatewayVideoJobResult, uploadFileToMediaGateway } from "../src/lib/mediaGateway";

loadEnvConfig(process.cwd());

const DEV_SERVER_URL = process.env.STUDIO_DEV_SERVER_URL ?? "http://127.0.0.1:3000";
const VIDEO_LIMIT = Number(process.env.RESTORE_VIDEO_LIMIT || "0");
const POLL_INTERVAL_MS = 2500;
const VIDEO_JOB_TIMEOUT_MS = Number(process.env.RESTORE_VIDEO_JOB_TIMEOUT_MS || "240000");

const audioFixture = path.join(
  getMediaFixturesDir(),
  "Love me tonight (Remastered x2) Stems (132BPM)",
  "Love me tonight (fullsong).wav",
);

const existingDraft = await loadExistingDraft();
const generatedAssets = existingDraft?.generatedAssets ?? [];
const referenceAssets = existingDraft?.referenceAssets ?? [];

console.log("Restoring studio fixtures to RustFS + server draft...");
console.log(`Audio: ${path.relative(process.cwd(), audioFixture)}`);

const audioAnalysis = await analyzeAndUploadAudio(audioFixture);
const inventory = listMediaFixtures(getMediaFixturesDir());
const videoPaths = inventory.video.filter((filePath) => filePath.includes(`${path.sep}videos-to-test-with${path.sep}`));
const selectedVideoPaths = VIDEO_LIMIT > 0 ? videoPaths.slice(0, VIDEO_LIMIT) : videoPaths;
console.log(`Videos: ${selectedVideoPaths.length}`);

const videoSources: UploadedVideoSource[] = [];
for (const [index, videoPath] of selectedVideoPaths.entries()) {
  videoSources.push(await uploadAndAnalyzeVideo(videoPath, index));
}

const storyBeats = getDefaultStorySectionDrafts().map((draft, index) => ({
  id: draft.id ?? `section-${index + 1}`,
  label: draft.label,
  prompt: draft.prompt ?? "Describe the visual idea for this song section",
}));
const musicVideoProject = createMusicVideoProject({
  analysis: audioAnalysis,
  duration: audioAnalysis.duration,
  storyDrafts: storyBeats,
  videoSources,
  createdAt: new Date().toISOString(),
});

const draft = createPersistableStudioProjectDraft({
  analysis: audioAnalysis,
  videoSources,
  storyState: {
    vocalStemName: "",
    transcriptSummary: null,
    storyBeats,
    activeBeatId: storyBeats[0]?.id ?? "intro",
    storyGenerated: true,
    editSettings: DEFAULT_STORY_EDIT_SETTINGS,
  },
  musicVideoProject,
  referenceAssets,
  generatedAssets,
  captionSettings: { mode: "fast" },
  workflowUiSettings: {
    activeTab: "story",
    splitMode: "scene",
    matchMode: "semantic",
    colorGradient: "Sunset",
    shaderPresetId: "high-energy-glitch",
    useSourceAudio: false,
    isPreviewExpanded: false,
  },
});

const saved = await saveDraftToDevServer(draft);
console.log(JSON.stringify({
  ok: true,
  draftSavedAt: saved.savedAt,
  audio: {
    sourceLabel: audioAnalysis.sourceLabel,
    duration: audioAnalysis.duration,
    storagePath: audioAnalysis.storagePath,
  },
  videoCount: videoSources.length,
  sceneCount: videoSources.reduce((sum, source) => sum + (source.scenes?.length ?? 0), 0),
  generatedAssetCount: generatedAssets.length,
  draftEndpoint: `${DEV_SERVER_URL}/api/studio/draft`,
}, null, 2));

async function analyzeAndUploadAudio(filePath: string): Promise<BeatJoinAnalysis> {
  const file = await fileFromPath(filePath, "audio/wav");
  const form = new FormData();
  form.set("file", file, file.name);

  const response = await fetch(`${DEV_SERVER_URL}/api/essentia/full?mode=full`, {
    method: "POST",
    body: form,
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`Essentia failed (${response.status}): ${JSON.stringify(payload).slice(0, 300)}`);

  const upload = await uploadFileToMediaGateway({ file, folder: "media-uploads/source-audio" });
  const parsed = parseEssentiaPayload({
    payload,
    fileName: file.name,
    waveform: [],
    waveformDuration: 0,
    audioUrl: upload.publicUrl ?? upload.mediaUrl,
  });
  if (!parsed) throw new Error("Essentia returned no usable audio analysis.");

  return {
    ...parsed,
    audioUrl: upload.mediaUrl ?? upload.publicUrl,
    storageProvider: "rustfs",
    storageBucket: upload.bucket,
    storagePath: upload.storagePath,
    storageUrl: upload.publicUrl ?? upload.mediaUrl,
    storageStatus: "uploaded",
    storageError: null,
  };
}

async function uploadAndAnalyzeVideo(filePath: string, index: number): Promise<UploadedVideoSource> {
  const probed = await probeMediaFile(filePath);
  const file = await fileFromPath(filePath, "video/mp4");
  console.log(`Uploading ${index + 1}: ${file.name}`);
  const upload = await uploadFileToMediaGateway({ file, folder: "media-uploads/source-video" });
  const sourceBase: UploadedVideoSource = {
    id: index,
    name: file.name,
    duration: probed.duration,
    size: file.size,
    thumbnailUrl: upload.publicUrl ?? upload.mediaUrl,
    videoUrl: upload.publicUrl ?? upload.mediaUrl,
    storageProvider: "rustfs",
    storageBucket: upload.bucket,
    storagePath: upload.storagePath,
    storageUrl: upload.publicUrl ?? upload.mediaUrl,
    storageStatus: "uploaded",
    storageError: null,
    scenes: [],
    sceneStatus: "detecting",
    sceneError: null,
    captionStatus: "idle",
    captionError: null,
  };

  try {
    const job = await createMediaGatewayVideoJob({
      bucket: upload.bucket,
      objectKey: upload.storagePath,
      metadata: { sourceName: file.name, restore: "studio-fixtures" },
    });
    const completed = await pollVideoJob(job.job_id);
    const result = await getMediaGatewayVideoJobResult({ jobId: completed.job_id });
    const scenes = normalizeSplitterManifest(result, index, "https://media.v1su4.dev");
    return {
      ...sourceBase,
      thumbnailUrl: scenes[0]?.thumbnailUrl ?? sourceBase.thumbnailUrl,
      scenes,
      sceneStatus: "ready",
      sceneJobId: completed.job_id,
      sceneError: null,
      captionStatus: scenes.length ? "ready" : "idle",
      captionError: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "video scene analysis failed";
    return {
      ...sourceBase,
      sceneStatus: "failed",
      sceneError: message,
      captionStatus: "failed",
      captionError: message,
    };
  }
}

async function pollVideoJob(jobId: string) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < VIDEO_JOB_TIMEOUT_MS) {
    const job = await getMediaGatewayVideoJob({ jobId });
    if (job.status === "completed") return job;
    if (job.status === "failed") throw new Error(job.error || `Video job ${jobId} failed`);
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`Video job ${jobId} timed out`);
}

async function fileFromPath(filePath: string, mime: string) {
  const buffer = await readFile(filePath);
  return new File([buffer], path.basename(filePath), { type: mime });
}

async function loadExistingDraft(): Promise<PersistedStudioProjectDraft | null> {
  try {
    const response = await fetch(`${DEV_SERVER_URL}/api/studio/draft`, { cache: "no-store" });
    const payload = await response.json() as { success?: boolean; draft?: PersistedStudioProjectDraft | null };
    return response.ok && payload.success ? payload.draft ?? null : null;
  } catch {
    return null;
  }
}

async function saveDraftToDevServer(draft: PersistedStudioProjectDraft): Promise<PersistedStudioProjectDraft> {
  const response = await fetch(`${DEV_SERVER_URL}/api/studio/draft`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ draft }),
  });
  const payload = await response.json() as { success?: boolean; draft?: PersistedStudioProjectDraft; error?: string };
  if (!response.ok || !payload.success || !payload.draft) {
    throw new Error(payload.error || `Studio draft save failed (${response.status})`);
  }
  return payload.draft;
}
