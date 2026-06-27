import { loadEnvConfig } from "@next/env";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { parseEssentiaPayload } from "../src/components/studio/audioAnalysis";
import { getDefaultStorySectionDrafts, createMusicVideoProject, DEFAULT_STORY_EDIT_SETTINGS } from "../src/components/studio/musicVideoProject";
import { getMediaFixturesDir, listMediaFixtures, probeMediaFile } from "../src/components/studio/mediaProbe";
import { createPersistableStudioProjectDraft, type PersistedStudioProjectDraft } from "../src/components/studio/projectPersistence";
import type { BeatJoinAnalysis, UploadedVideoSource } from "../src/components/studio/types";
import { uploadFileToMediaGateway } from "../src/lib/mediaGateway";

loadEnvConfig(process.cwd());

const DEV_SERVER_URL = process.env.STUDIO_DEV_SERVER_URL ?? "http://127.0.0.1:3000";
const VIDEO_LIMIT = Number(process.env.SEED_VIDEO_LIMIT || "8");
const audioFixture = path.join(
  getMediaFixturesDir(),
  "Love me tonight (Remastered x2) Stems (132BPM)",
  "Love me tonight (fullsong).wav",
);

const existingDraft = await loadExistingDraft();
const generatedAssets = existingDraft?.generatedAssets ?? [];
const referenceAssets = existingDraft?.referenceAssets ?? [];

console.log("Fast-seeding studio draft with durable RustFS media...");
const analysis = await analyzeAndUploadAudio(audioFixture);
const videoPaths = listMediaFixtures(getMediaFixturesDir()).video
  .filter((filePath) => filePath.includes(`${path.sep}videos-to-test-with${path.sep}`))
  .slice(0, VIDEO_LIMIT);

const videoSources: UploadedVideoSource[] = [];
for (const [index, videoPath] of videoPaths.entries()) {
  videoSources.push(await uploadVideo(videoPath, index));
  console.log(`Seeded video ${index + 1}/${videoPaths.length}`);
}

const storyBeats = getDefaultStorySectionDrafts().map((draft, index) => ({
  id: draft.id ?? `section-${index + 1}`,
  label: draft.label,
  prompt: draft.prompt ?? "Describe the visual idea for this song section",
}));
const musicVideoProject = createMusicVideoProject({
  analysis,
  duration: analysis.duration,
  storyDrafts: storyBeats,
  videoSources,
});
const draft = createPersistableStudioProjectDraft({
  analysis,
  videoSources,
  storyState: {
    vocalStemName: "",
    transcriptSummary: null,
    storyBeats,
    activeBeatId: storyBeats[0]?.id ?? "intro",
    storyGenerated: false,
    editSettings: DEFAULT_STORY_EDIT_SETTINGS,
  },
  musicVideoProject,
  referenceAssets,
  generatedAssets,
  captionSettings: { mode: "fast" },
  workflowUiSettings: {
    activeTab: "review",
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
  savedAt: saved.savedAt,
  audio: analysis.sourceLabel,
  videos: videoSources.length,
  generatedAssets: generatedAssets.length,
  draftEndpoint: `${DEV_SERVER_URL}/api/studio/draft`,
}, null, 2));

async function analyzeAndUploadAudio(filePath: string): Promise<BeatJoinAnalysis> {
  const file = await fileFromPath(filePath, "audio/wav");
  const form = new FormData();
  form.set("file", file, file.name);
  const response = await fetch(`${DEV_SERVER_URL}/api/essentia/full?mode=fast`, { method: "POST", body: form });
  const payload = await response.json();
  if (!response.ok) throw new Error(`Essentia failed (${response.status}): ${JSON.stringify(payload).slice(0, 300)}`);
  const upload = await uploadFileToMediaGateway({ file, folder: "media-uploads/source-audio" });
  const parsed = parseEssentiaPayload({ payload, fileName: file.name, waveform: [], waveformDuration: 0, audioUrl: upload.mediaUrl ?? upload.publicUrl });
  if (!parsed) throw new Error("Essentia returned no usable audio analysis.");
  return {
    ...parsed,
    audioUrl: upload.mediaUrl ?? upload.publicUrl,
    storageProvider: "rustfs",
    storageBucket: upload.bucket,
    storagePath: upload.storagePath,
    storageUrl: upload.mediaUrl ?? upload.publicUrl,
    storageStatus: "uploaded",
    storageError: null,
  };
}

async function uploadVideo(filePath: string, index: number): Promise<UploadedVideoSource> {
  const probed = await probeMediaFile(filePath);
  const file = await fileFromPath(filePath, "video/mp4");
  const upload = await uploadFileToMediaGateway({ file, folder: "media-uploads/source-video" });
  return {
    id: index,
    name: file.name,
    duration: probed.duration,
    size: file.size,
    thumbnailUrl: upload.mediaUrl ?? upload.publicUrl,
    videoUrl: upload.mediaUrl ?? upload.publicUrl,
    storageProvider: "rustfs",
    storageBucket: upload.bucket,
    storagePath: upload.storagePath,
    storageUrl: upload.mediaUrl ?? upload.publicUrl,
    storageStatus: "uploaded",
    storageError: null,
    scenes: [],
    sceneStatus: "idle",
    sceneError: null,
    captionStatus: "idle",
    captionError: null,
  };
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
  if (!response.ok || !payload.success || !payload.draft) throw new Error(payload.error || `Studio draft save failed (${response.status})`);
  return payload.draft;
}
