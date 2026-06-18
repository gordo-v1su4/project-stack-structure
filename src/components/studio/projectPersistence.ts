import type { DeepgramTranscriptSummary } from "./deepgramUtils";
import type { MusicVideoProject, StorySectionDraft } from "./musicVideoProject";
import type { BeatJoinAnalysis, UploadedVideoSource } from "./types";

export const STUDIO_PROJECT_STORAGE_KEY = "project-stack-structure:studio-project:v1";
const MEDIA_DB_NAME = "project-stack-structure-studio-media";
const MEDIA_STORE_NAME = "media";

export type PersistedStoryState = {
  vocalStemName: string;
  transcriptSummary: DeepgramTranscriptSummary | null;
  storyBeats: Array<StorySectionDraft & { id: string; label: string; prompt: string }>;
  activeBeatId: string;
  storyGenerated: boolean;
};

export type PersistedVideoSource = Omit<UploadedVideoSource, "videoUrl"> & {
  mediaKey: string;
};

export type PersistedBeatJoinAnalysis = Omit<BeatJoinAnalysis, "audioUrl"> & {
  mediaKey: string | null;
};

export interface PersistedStudioProjectDraft {
  version: 1;
  savedAt: string;
  analysis: PersistedBeatJoinAnalysis | null;
  videoSources: PersistedVideoSource[];
  storyState: PersistedStoryState;
  musicVideoProject: MusicVideoProject | null;
}

export interface RuntimeStudioProjectDraft {
  analysis: BeatJoinAnalysis | null;
  videoSources: UploadedVideoSource[];
  storyState: PersistedStoryState;
  musicVideoProject: MusicVideoProject | null;
}

export function createPersistableStudioProjectDraft(params: {
  analysis: BeatJoinAnalysis | null;
  videoSources: UploadedVideoSource[];
  storyState: PersistedStoryState;
  musicVideoProject: MusicVideoProject | null;
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
      scenes: source.scenes?.map((scene) => ({
        ...scene,
        thumbnailUrl: stripRuntimeUrl(scene.thumbnailUrl),
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
          audioUrl: params.audioUrl ?? "",
          waveform: params.draft.analysis.waveform,
          energy: params.draft.analysis.energy,
          beats: params.draft.analysis.beats,
          onsets: params.draft.analysis.onsets,
          sections: params.draft.analysis.sections,
          duration: params.draft.analysis.duration,
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
  window.localStorage.setItem(STUDIO_PROJECT_STORAGE_KEY, JSON.stringify(draft));

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

  const raw = window.localStorage.getItem(STUDIO_PROJECT_STORAGE_KEY);
  if (!raw) return null;

  const draft = parsePersistedDraft(raw);
  if (!draft) return null;

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
