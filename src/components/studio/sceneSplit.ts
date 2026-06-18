import type { DetectedSceneSegment, UploadedVideoSource } from "./types";

export const SPLITTER_API_BASE_URL = "https://splitter.serving.cloud";
const SPLITTER_PROXY_URL = "/api/splitter/scene";
const DEFAULT_POLL_INTERVAL_MS = 2500;
const DEFAULT_TIMEOUT_MS = 120_000;

type SplitterJobStatus = "queued" | "processing" | "completed" | "failed";

interface SplitterJobState {
  job_id: string;
  status: SplitterJobStatus;
  stage: string;
  error?: string | null;
  segment_count?: number;
  progress_completed?: number;
  progress_total?: number;
}

interface SplitterJobCreatedResponse {
  job?: SplitterJobState;
}

interface StoredVideoSceneReference {
  bucket?: string;
  objectKey?: string;
  storagePath?: string;
}

interface MediaVideoJobState {
  job_id: string;
  status: SplitterJobStatus;
  stage?: string;
  error?: string | null;
}

interface MediaVideoJobCreatedResponse {
  job?: MediaVideoJobState;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function joinAssetUrl(baseUrl: string, jobId: string | undefined, assetPath: string | undefined) {
  if (!jobId || !assetPath || /^https?:\/\//i.test(assetPath)) return assetPath;
  const safeBase = baseUrl.replace(/\/+$/, "");
  const safePath = assetPath.split("/").map(encodeURIComponent).join("/");
  return `${safeBase}/api/jobs/${encodeURIComponent(jobId)}/assets/${safePath}`;
}

export function normalizeSplitterManifest(
  payload: unknown,
  sourceClipId: number,
  baseUrl = SPLITTER_API_BASE_URL,
): DetectedSceneSegment[] {
  const root = asRecord(payload);
  const manifest = asRecord(root?.manifest) ?? root;
  if (!manifest) return [];

  const jobId = readString(manifest.job_id);
  const segments = Array.isArray(manifest.segments) ? manifest.segments : [];

  const normalized: DetectedSceneSegment[] = [];

  segments.forEach((segment, arrayIndex) => {
    const record = asRecord(segment);
    if (!record) return;

    const start = readNumber(record.start_seconds, readNumber(record.start, 0));
    const end = readNumber(record.end_seconds, readNumber(record.end, start));
    const duration = readNumber(record.duration_seconds, Math.max(0, end - start));
    const clipPath = readString(record.clip_path) ?? readString(record.clipPath) ?? readString(record.assetPath);
    const thumbnailPath = readString(record.thumbnail_path) ?? readString(record.thumbnailPath);
    const clipUrl = readString(record.clip_url) ?? readString(record.clipUrl) ?? joinAssetUrl(baseUrl, jobId, clipPath);
    const thumbnailUrl = readString(record.thumbnail_url) ?? readString(record.thumbnailUrl) ?? joinAssetUrl(baseUrl, jobId, thumbnailPath);
    const index = Math.max(0, Math.round(readNumber(record.index, arrayIndex + 1)) - 1);
    const sceneData = asRecord(record.sceneData) ?? asRecord(record.scene_data) ?? asRecord(record.meta);
    const caption = readString(record.caption) ?? readString(record.text);

    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;

    normalized.push({
      id: index,
      sourceClipId,
      label: readString(record.label) ?? `Scene ${String(index + 1).padStart(2, "0")}`,
      start,
      end,
      duration: duration > 0 ? duration : end - start,
      thumbnailUrl,
      clipUrl,
      assetPath: clipPath,
      detector: "pyscenedetect-adaptive",
      confidence: null,
      caption,
      captionMeta: sceneData ? {
        caption: readString(sceneData.caption),
        shotType: readString(sceneData.shotType) ?? readString(sceneData.shot_type),
        subjects: Array.isArray(sceneData.subjects) ? sceneData.subjects.filter((subject): subject is string => typeof subject === "string") : undefined,
        action: readString(sceneData.action),
        setting: readString(sceneData.setting),
        lighting: readString(sceneData.lighting),
        timeOfDay: readString(sceneData.timeOfDay) ?? readString(sceneData.time_of_day),
        weather: readString(sceneData.weather),
      } : undefined,
      captionSource: caption ? "imported" : undefined,
    });
  });

  return normalized;
}

export function buildFallbackSceneSegments(source: UploadedVideoSource): DetectedSceneSegment[] {
  const duration = Math.max(0, source.duration);
  if (duration <= 0) return [];

  const targetDuration = duration <= 8 ? duration : duration <= 20 ? 4 : 5;
  const segments: DetectedSceneSegment[] = [];
  let cursor = 0;

  while (cursor < duration - 0.001) {
    const remaining = duration - cursor;
    const end = remaining <= targetDuration * 1.35 ? duration : Math.min(duration, cursor + targetDuration);
    segments.push({
      id: segments.length,
      sourceClipId: source.id,
      label: `Fallback ${String(segments.length + 1).padStart(2, "0")}`,
      start: cursor,
      end,
      duration: end - cursor,
      thumbnailUrl: source.thumbnailUrl,
      clipUrl: source.videoUrl,
      detector: "browser-fallback",
      confidence: null,
    });
    cursor = end;
  }

  return segments;
}

async function readJsonResponse(response: Response) {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text.trim() || `${response.status} ${response.statusText}`);
  }
  return text.trim() ? JSON.parse(text) as unknown : null;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function detectScenesWithSplitter(
  file: File,
  sourceClipId: number,
  options: { baseUrl?: string; timeoutMs?: number; pollIntervalMs?: number } = {},
): Promise<DetectedSceneSegment[]> {
  const baseUrl = options.baseUrl ?? SPLITTER_PROXY_URL;
  const formData = new FormData();
  formData.append("file", file, file.name);

  if (baseUrl.startsWith("/")) {
    const result = await readJsonResponse(await fetch(baseUrl, {
      method: "POST",
      body: formData,
    }));
    const resultRecord = asRecord(result);
    const assetBaseUrl = readString(resultRecord?.splitterBaseUrl) ?? SPLITTER_API_BASE_URL;
    const scenes = normalizeSplitterManifest(result, sourceClipId, assetBaseUrl);
    if (!scenes.length) throw new Error("Splitter completed but returned no scene segments.");
    return scenes;
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  const created = await readJsonResponse(await fetch(`${baseUrl.replace(/\/+$/, "")}/api/jobs`, {
    method: "POST",
    body: formData,
  })) as SplitterJobCreatedResponse;

  const jobId = created.job?.job_id;
  if (!jobId || !created.job) throw new Error("Splitter did not return a job id.");

  const startedAt = Date.now();
  let state: SplitterJobState = created.job;

  while (state.status !== "completed") {
    if (state.status === "failed") {
      throw new Error(state.error ?? `Splitter failed during ${state.stage || "processing"}.`);
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Splitter scene detection timed out after ${Math.round(timeoutMs / 1000)}s.`);
    }

    await sleep(pollIntervalMs);
    state = await readJsonResponse(await fetch(`${baseUrl.replace(/\/+$/, "")}/api/jobs/${encodeURIComponent(jobId)}`)) as SplitterJobState;
  }

  const result = await readJsonResponse(await fetch(`${baseUrl.replace(/\/+$/, "")}/api/jobs/${encodeURIComponent(jobId)}/result`));
  const scenes = normalizeSplitterManifest(result, sourceClipId, baseUrl);
  if (!scenes.length) throw new Error("Splitter completed but returned no scene segments.");
  return scenes;
}


export async function detectScenesFromStoredVideo(
  storage: StoredVideoSceneReference,
  sourceClipId: number,
  options: { timeoutMs?: number; pollIntervalMs?: number } = {},
): Promise<DetectedSceneSegment[]> {
  const bucket = storage.bucket;
  const objectKey = storage.objectKey ?? storage.storagePath;
  if (!bucket || !objectKey) throw new Error("Stored scene detection requires bucket and object key.");

  const created = await readJsonResponse(await fetch("/api/media/video/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bucket,
      objectKey,
      mode: "scene-detect",
      profile: "pyscenedetect-adaptive",
    }),
  })) as MediaVideoJobCreatedResponse;

  const jobId = created.job?.job_id;
  if (!jobId || !created.job) throw new Error("Media gateway did not return a video job id.");

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const startedAt = Date.now();
  let state: MediaVideoJobState = created.job;

  while (state.status !== "completed") {
    if (state.status === "failed") {
      throw new Error(state.error ?? `Media video job failed during ${state.stage || "processing"}.`);
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Media video scene detection timed out after ${Math.round(timeoutMs / 1000)}s.`);
    }

    await sleep(pollIntervalMs);
    state = await readJsonResponse(await fetch(`/api/media/video/jobs/${encodeURIComponent(jobId)}`)) as MediaVideoJobState;
  }

  const result = await readJsonResponse(await fetch(`/api/media/video/jobs/${encodeURIComponent(jobId)}/result`));
  const scenes = normalizeSplitterManifest(result, sourceClipId, "");
  if (!scenes.length) throw new Error("Media video job completed but returned no scene segments.");
  return scenes;
}
