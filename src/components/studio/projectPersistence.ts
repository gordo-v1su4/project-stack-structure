import type { DeepgramTranscriptSummary } from "./deepgramUtils";
import { getDefaultStorySectionDrafts, type MusicVideoProject, type StoryEditSettings, type StoryPlanDraft } from "./musicVideoProject";
import { hydrateGeneratedStudioAssets, sanitizeGeneratedStudioAssetForStorage, type GeneratedStudioAsset } from "./generatedAssets";
import { hydrateReferenceAssets, sanitizeReferenceAssetForStorage, type ReferenceAsset } from "./referenceAssets";
import type { BeatJoinAnalysis, ColorGradient, SceneCaptionSettings, Tab, UploadedVideoSource } from "./types";
import type { SplitMode } from "./sourceTimeline";
import type { SavedStudioProject, StudioProjectSummary } from "@/lib/studioProjectStore";

export const STUDIO_PROJECT_STORAGE_KEY = "project-stack-structure:studio-project:v1";
export const ACTIVE_STUDIO_PROJECT_KEY = "project-stack-structure:active-project:v1";
export const STUDIO_AUTOSAVE_INTERVAL_MS = 5 * 60 * 1_000;
const MEDIA_DB_NAME = "project-stack-structure-studio-media";
const MEDIA_STORE_NAME = "media";

export type PersistedStoryState = {
  vocalStemName: string;
  transcriptSummary: DeepgramTranscriptSummary | null;
  storyBeats: StoryPlanDraft[];
  activeBeatId: string;
  storyGenerated: boolean;
  editSettings?: StoryEditSettings;
};

export type PersistedVideoSource = Omit<UploadedVideoSource, "videoUrl"> & {
  mediaKey: string;
};

export type PersistedBeatJoinAnalysis = Omit<BeatJoinAnalysis, "audioUrl"> & {
  mediaKey: string | null;
};

export type PersistedWorkflowUiSettings = {
  activeTab?: Tab;
  splitMode?: SplitMode;
  matchMode?: string;
  matchOnsetDensity?: number;
  matchLyricCueBlend?: number;
  matchLyricMergeWindow?: number;
  colorGradient?: ColorGradient;
  shaderPresetId?: string;
  isPreviewExpanded?: boolean;
};

export interface PersistedStudioProjectDraft {
  version: 1;
  savedAt: string;
  analysis: PersistedBeatJoinAnalysis | null;
  videoSources: PersistedVideoSource[];
  storyState: PersistedStoryState;
  musicVideoProject: MusicVideoProject | null;
  referenceAssets?: ReferenceAsset[];
  generatedAssets?: GeneratedStudioAsset[];
  captionSettings?: SceneCaptionSettings;
  workflowUiSettings?: PersistedWorkflowUiSettings;
}

export interface RuntimeStudioProjectDraft {
  analysis: BeatJoinAnalysis | null;
  videoSources: UploadedVideoSource[];
  storyState: PersistedStoryState;
  musicVideoProject: MusicVideoProject | null;
  referenceAssets: ReferenceAsset[];
  generatedAssets: GeneratedStudioAsset[];
  captionSettings?: SceneCaptionSettings;
  workflowUiSettings?: PersistedWorkflowUiSettings;
}

export function createPersistableStudioProjectDraft(params: {
  analysis: BeatJoinAnalysis | null;
  videoSources: UploadedVideoSource[];
  storyState: PersistedStoryState;
  musicVideoProject: MusicVideoProject | null;
  referenceAssets?: ReferenceAsset[];
  generatedAssets?: GeneratedStudioAsset[];
  captionSettings?: SceneCaptionSettings;
  workflowUiSettings?: PersistedWorkflowUiSettings;
  savedAt?: string;
}): PersistedStudioProjectDraft {
  return {
    version: 1,
    savedAt: params.savedAt ?? new Date().toISOString(),
    analysis: params.analysis
      ? {
          sourceLabel: params.analysis.sourceLabel,
          waveform: params.analysis.waveform,
          energy: params.analysis.energy,
          beats: params.analysis.beats,
          onsets: params.analysis.onsets,
          sections: params.analysis.sections,
          duration: params.analysis.duration,
          storageProvider: params.analysis.storageProvider,
          storageBucket: params.analysis.storageBucket,
          storagePath: params.analysis.storagePath,
          storageUrl: stripRuntimeUrl(params.analysis.storageUrl),
          storageStatus: params.analysis.storageStatus,
          storageError: params.analysis.storageError,
          mediaKey: buildAudioMediaKey(params.analysis.sourceLabel),
        }
      : null,
    videoSources: params.videoSources.map((source) => ({
      id: source.id,
      name: source.name,
      duration: source.duration,
      size: source.size,
      thumbnailUrl: stripRuntimeUrl(source.thumbnailUrl),
      storageProvider: source.storageProvider,
      storageBucket: source.storageBucket,
      storagePath: source.storagePath,
      storageUrl: stripRuntimeUrl(source.storageUrl),
      storageStatus: source.storageStatus,
      storageError: source.storageError,
      uploadChunks: source.uploadChunks ?? null,
      scenes: source.scenes?.map((scene) => ({
        ...scene,
        thumbnailUrl: stripRuntimeUrl(scene.thumbnailUrl),
        firstFrameUrl: stripRuntimeUrl(scene.firstFrameUrl),
        middleFrameUrl: stripRuntimeUrl(scene.middleFrameUrl),
        lastFrameUrl: stripRuntimeUrl(scene.lastFrameUrl),
        storyboardUrl: stripRuntimeUrl(scene.storyboardUrl),
        clipUrl: stripRuntimeUrl(scene.clipUrl),
      })),
      sceneStatus: source.sceneStatus,
      sceneJobId: source.sceneJobId,
      sceneError: source.sceneError,
      captionStatus: source.captionStatus,
      captionError: source.captionError,
      captionManifestPath: source.captionManifestPath,
      captionManifestUrl: stripRuntimeUrl(source.captionManifestUrl),
      mediaKey: buildVideoMediaKey(source),
    })),
    storyState: params.storyState,
    musicVideoProject: params.musicVideoProject ? sanitizeMusicVideoProjectForStorage(params.musicVideoProject) : null,
    referenceAssets: (params.referenceAssets ?? []).map(sanitizeReferenceAssetForStorage),
    generatedAssets: (params.generatedAssets ?? []).map(sanitizeGeneratedStudioAssetForStorage),
    captionSettings: sanitizeCaptionSettings(params.captionSettings),
    workflowUiSettings: sanitizeWorkflowUiSettings(params.workflowUiSettings),
  };
}

export function hydrateStudioProjectDraft(params: {
  draft: PersistedStudioProjectDraft;
  audioUrl?: string | null;
  videoUrlsByMediaKey?: Record<string, string>;
}): RuntimeStudioProjectDraft {
  const videoUrlsByMediaKey = params.videoUrlsByMediaKey ?? {};
  return {
    analysis: params.draft.analysis
      ? {
          sourceLabel: params.draft.analysis.sourceLabel,
          audioUrl: params.audioUrl ?? params.draft.analysis.storageUrl ?? "",
          waveform: params.draft.analysis.waveform,
          energy: params.draft.analysis.energy,
          beats: params.draft.analysis.beats,
          onsets: params.draft.analysis.onsets,
          sections: params.draft.analysis.sections,
          duration: params.draft.analysis.duration,
          storageProvider: params.draft.analysis.storageProvider,
          storageBucket: params.draft.analysis.storageBucket,
          storagePath: params.draft.analysis.storagePath,
          storageUrl: params.draft.analysis.storageUrl,
          storageStatus: params.draft.analysis.storageStatus,
          storageError: params.draft.analysis.storageError,
        }
      : null,
    videoSources: params.draft.videoSources
      .map((source) => ({
        ...source,
        videoUrl: videoUrlsByMediaKey[source.mediaKey] ?? source.storageUrl ?? "",
      }))
      .filter((source) => source.videoUrl),
    storyState: params.draft.storyState,
    musicVideoProject: params.draft.musicVideoProject,
    referenceAssets: hydrateReferenceAssets(params.draft.referenceAssets ?? []),
    generatedAssets: hydrateGeneratedStudioAssets(params.draft.generatedAssets ?? []),
    captionSettings: sanitizeCaptionSettings(params.draft.captionSettings),
    workflowUiSettings: sanitizeWorkflowUiSettings(params.draft.workflowUiSettings),
  };
}

export async function saveStudioProjectDraft(
  params: Parameters<typeof createPersistableStudioProjectDraft>[0],
  media: {
    audioFile?: Blob | null;
    videoFilesByMediaKey?: Map<string, Blob>;
  } = {},
): Promise<PersistedStudioProjectDraft | null> {
  if (!hasBrowserStorage()) return null;

  const draft = createPersistableStudioProjectDraft(params);
  if (isEmptyStudioProjectDraft(draft)) {
    clearStudioProjectDraft();
    return null;
  }
  window.localStorage.setItem(STUDIO_PROJECT_STORAGE_KEY, JSON.stringify(draft));
  void saveServerStudioProjectDraft(draft).catch((error) => {
    console.warn("[Studio] Could not autosave server studio draft", error);
  });

  const writes: Promise<void>[] = [];
  if (draft.analysis?.mediaKey && media.audioFile) {
    writes.push(writeMediaBlob(draft.analysis.mediaKey, media.audioFile));
  }
  for (const [mediaKey, blob] of media.videoFilesByMediaKey ?? []) {
    writes.push(writeMediaBlob(mediaKey, blob));
  }
  await Promise.all(writes);
  return draft;
}

export async function loadStudioProjectDraft(): Promise<RuntimeStudioProjectDraft | null> {
  if (!hasBrowserStorage()) return null;

  const serverDraft = await loadServerStudioProjectDraft().catch((error) => {
    console.warn("[Studio] Could not restore server studio draft", error);
    return null;
  });
  if (serverDraft) {
    if (isEmptyStudioProjectDraft(serverDraft)) {
      clearStudioProjectDraft();
      return null;
    }
    window.localStorage.setItem(STUDIO_PROJECT_STORAGE_KEY, JSON.stringify(serverDraft));
    return hydrateStudioProjectDraft({ draft: serverDraft });
  }

  const raw = window.localStorage.getItem(STUDIO_PROJECT_STORAGE_KEY);
  if (!raw) return null;

  const draft = parsePersistedDraft(raw);
  if (!draft) return null;
  if (isEmptyStudioProjectDraft(draft)) {
    clearStudioProjectDraft();
    return null;
  }

  const audioBlob = draft.analysis?.mediaKey ? await readMediaBlob(draft.analysis.mediaKey) : null;
  const audioUrl = audioBlob ? URL.createObjectURL(audioBlob) : null;
  const videoUrlsByMediaKey: Record<string, string> = {};

  for (const source of draft.videoSources) {
    const blob = await readMediaBlob(source.mediaKey);
    if (blob) {
      videoUrlsByMediaKey[source.mediaKey] = URL.createObjectURL(blob);
    }
  }

  return hydrateStudioProjectDraft({ draft, audioUrl, videoUrlsByMediaKey });
}

export function clearStudioProjectDraft() {
  if (!hasBrowserStorage()) return;
  window.localStorage.removeItem(STUDIO_PROJECT_STORAGE_KEY);
  window.indexedDB?.deleteDatabase(MEDIA_DB_NAME);
}

export function isEmptyStudioProjectDraft(draft: PersistedStudioProjectDraft) {
  return !draft.analysis
    && draft.videoSources.length === 0
    && !draft.musicVideoProject
    && (draft.referenceAssets?.length ?? 0) === 0
    && (draft.generatedAssets?.length ?? 0) === 0
    && !draft.storyState.vocalStemName.trim()
    && !draft.storyState.transcriptSummary
    && hasOnlyDefaultStoryBeats(draft.storyState.storyBeats)
    && !draft.storyState.storyGenerated;
}

function hasOnlyDefaultStoryBeats(beats: PersistedStoryState["storyBeats"]) {
  const defaults = getDefaultStorySectionDrafts();
  return beats.length === 0 || (
    beats.length === defaults.length
    && beats.every((beat, index) => {
      const expected = defaults[index];
      return beat.id === expected?.id
        && beat.label === expected.label
        && beat.prompt === expected.prompt;
    })
  );
}

export async function saveServerStudioProjectDraft(draft: PersistedStudioProjectDraft): Promise<PersistedStudioProjectDraft | null> {
  if (typeof fetch !== "function") return null;

  const response = await fetch("/api/studio/draft", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ draft }),
  });
  const payload = await readDraftApiResponse(response);
  if (!response.ok || !payload.success) {
    throw new Error(payload.error || `Studio draft save failed (${response.status})`);
  }

  return payload.draft ?? draft;
}

export async function loadServerStudioProjectDraft(): Promise<PersistedStudioProjectDraft | null> {
  if (typeof fetch !== "function") return null;

  const response = await fetch("/api/studio/draft", { cache: "no-store" });
  const payload = await readDraftApiResponse(response);
  if (!response.ok || !payload.success) {
    throw new Error(payload.error || `Studio draft load failed (${response.status})`);
  }

  return payload.draft ?? null;
}

export async function listSavedStudioProjects(): Promise<StudioProjectSummary[]> {
  const response = await fetch("/api/studio/projects", { cache: "no-store" });
  const payload = await readProjectApiResponse<{ projects?: StudioProjectSummary[] }>(response);
  if (!response.ok || !payload.success) throw new Error(payload.error || `Project list failed (${response.status})`);
  return payload.projects ?? [];
}

export async function loadSavedStudioProject(projectId: string): Promise<SavedStudioProject> {
  const response = await fetch(`/api/studio/projects/${encodeURIComponent(projectId)}`, { cache: "no-store" });
  const payload = await readProjectApiResponse<{ saved?: SavedStudioProject }>(response);
  if (!response.ok || !payload.success || !payload.saved) throw new Error(payload.error || `Project load failed (${response.status})`);
  window.localStorage.setItem(ACTIVE_STUDIO_PROJECT_KEY, projectId);
  window.localStorage.setItem(STUDIO_PROJECT_STORAGE_KEY, JSON.stringify(payload.saved.draft));
  return payload.saved;
}

export async function saveNamedStudioProject(params: {
  projectId?: string | null;
  name: string;
  draft: PersistedStudioProjectDraft;
}): Promise<SavedStudioProject> {
  const projectId = params.projectId?.trim() || null;
  const response = await fetch(projectId ? `/api/studio/projects/${encodeURIComponent(projectId)}` : "/api/studio/projects", {
    method: projectId ? "PUT" : "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: params.name, draft: params.draft }),
  });
  const payload = await readProjectApiResponse<{ saved?: SavedStudioProject }>(response);
  if (!response.ok || !payload.success || !payload.saved) throw new Error(payload.error || `Project save failed (${response.status})`);
  window.localStorage.setItem(ACTIVE_STUDIO_PROJECT_KEY, payload.saved.project.id);
  window.localStorage.setItem(STUDIO_PROJECT_STORAGE_KEY, JSON.stringify(payload.saved.draft));
  return payload.saved;
}

export function buildAudioMediaKey(sourceLabel: string) {
  return `audio:${sourceLabel}`;
}

export function buildVideoMediaKey(source: Pick<UploadedVideoSource, "name" | "size" | "duration">) {
  return `video:${source.name}:${source.size}:${source.duration.toFixed(3)}`;
}

function sanitizeMusicVideoProjectForStorage(project: MusicVideoProject): MusicVideoProject {
  return {
    ...project,
    song: project.song
      ? {
          ...project.song,
          audioUrl: stripRuntimeUrl(project.song.audioUrl),
        }
      : null,
    videoMoments: project.videoMoments.map((moment) => ({
      ...moment,
      thumbnailUrl: stripRuntimeUrl(moment.thumbnailUrl),
      firstFrameUrl: stripRuntimeUrl(moment.firstFrameUrl),
      middleFrameUrl: stripRuntimeUrl(moment.middleFrameUrl),
      lastFrameUrl: stripRuntimeUrl(moment.lastFrameUrl),
      storyboardUrl: stripRuntimeUrl(moment.storyboardUrl),
    })),
  };
}

function stripRuntimeUrl(value: string | undefined) {
  if (!value) return "";
  return value.startsWith("data:") || value.startsWith("blob:") ? "" : value;
}

function parsePersistedDraft(raw: string): PersistedStudioProjectDraft | null {
  try {
    const parsed = JSON.parse(raw) as PersistedStudioProjectDraft;
    if (parsed?.version !== 1 || !parsed.storyState || !Array.isArray(parsed.videoSources)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function readDraftApiResponse(response: Response): Promise<{ success?: boolean; draft?: PersistedStudioProjectDraft | null; error?: string }> {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as { success?: boolean; draft?: PersistedStudioProjectDraft | null; error?: string };
  } catch {
    return { error: text.slice(0, 300) };
  }
}

async function readProjectApiResponse<T>(response: Response): Promise<T & { success?: boolean; error?: string }> {
  const text = await response.text();
  if (!text.trim()) return {} as T & { success?: boolean; error?: string };
  try {
    return JSON.parse(text) as T & { success?: boolean; error?: string };
  } catch {
    return { error: text.slice(0, 300) } as T & { success?: boolean; error?: string };
  }
}

function sanitizeWorkflowUiSettings(settings: PersistedWorkflowUiSettings | undefined): PersistedWorkflowUiSettings {
  const next: PersistedWorkflowUiSettings = {};
  if (isKnownTab(settings?.activeTab)) next.activeTab = settings.activeTab;
  if (isKnownSplitMode(settings?.splitMode)) next.splitMode = settings.splitMode;
  if (typeof settings?.matchMode === "string" && settings.matchMode.trim()) next.matchMode = settings.matchMode;
  const matchOnsetDensity = settings?.matchOnsetDensity;
  const matchLyricCueBlend = settings?.matchLyricCueBlend;
  const matchLyricMergeWindow = settings?.matchLyricMergeWindow;
  if (Number.isFinite(matchOnsetDensity)) next.matchOnsetDensity = clampNumber(matchOnsetDensity, 5, 100);
  if (Number.isFinite(matchLyricCueBlend)) next.matchLyricCueBlend = clampNumber(matchLyricCueBlend, 0, 100);
  if (Number.isFinite(matchLyricMergeWindow)) next.matchLyricMergeWindow = clampNumber(matchLyricMergeWindow, 0, 5);
  if (settings?.colorGradient === "Rainbow" || settings?.colorGradient === "Sunset" || settings?.colorGradient === "Ocean") next.colorGradient = settings.colorGradient;
  if (typeof settings?.shaderPresetId === "string" && settings.shaderPresetId.trim()) next.shaderPresetId = settings.shaderPresetId;
  if (typeof settings?.isPreviewExpanded === "boolean") next.isPreviewExpanded = settings.isPreviewExpanded;
  return next;
}

function isKnownTab(value: unknown): value is Tab {
  return typeof value === "string" && ["review", "story", "compose", "split", "beatsplit", "shuffle", "generate", "join", "beatjoin", "ramp"].includes(value);
}

function isKnownSplitMode(value: unknown): value is SplitMode {
  return typeof value === "string" && ["scene", "beat", "onset", "scene-beat", "scene-onset"].includes(value);
}

function clampNumber(value: number | undefined, min: number, max: number) {
  const numeric = Number.isFinite(value) ? Number(value) : min;
  return Math.min(max, Math.max(min, numeric));
}

function sanitizeCaptionSettings(settings: SceneCaptionSettings | undefined): SceneCaptionSettings {
  return {
    mode: settings?.mode === "fast" ? "fast" : "smart",
    context: settings?.context,
  };
}

function hasBrowserStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined" && typeof indexedDB !== "undefined";
}

function openMediaDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(MEDIA_DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(MEDIA_STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open studio media database."));
  });
}

async function writeMediaBlob(key: string, blob: Blob): Promise<void> {
  const db = await openMediaDb();
  await transactStore(db, "readwrite", (store) => store.put(blob, key));
  db.close();
}

async function readMediaBlob(key: string): Promise<Blob | null> {
  const db = await openMediaDb();
  const result = await transactStore(db, "readonly", (store) => store.get(key));
  db.close();
  return result instanceof Blob ? result : null;
}

function transactStore<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(MEDIA_STORE_NAME, mode);
    const request = operation(transaction.objectStore(MEDIA_STORE_NAME));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Studio media database request failed."));
    transaction.onerror = () => reject(transaction.error ?? new Error("Studio media database transaction failed."));
  });
}
