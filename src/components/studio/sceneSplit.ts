import type { ColorPaletteSwatch, DetectedSceneSegment, MotionDescriptor, SceneColorAnalysis, SceneVisualAnalysis } from "./types";

export const SPLITTER_API_BASE_URL = "";
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

function readNumberArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === "number" && Number.isFinite(item)) : undefined;
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
    const firstFramePath = readString(record.first_frame_path) ?? readString(record.firstFramePath);
    const middleFramePath = readString(record.middle_frame_path) ?? readString(record.middleFramePath);
    const lastFramePath = readString(record.last_frame_path) ?? readString(record.lastFramePath);
    const storyboardPath = readString(record.storyboard_path) ?? readString(record.storyboardPath);
    const clipUrl = readString(record.clip_url) ?? readString(record.clipUrl) ?? joinAssetUrl(baseUrl, jobId, clipPath);
    const thumbnailUrl = readString(record.thumbnail_url) ?? readString(record.thumbnailUrl) ?? joinAssetUrl(baseUrl, jobId, thumbnailPath);
    const firstFrameUrl = readString(record.first_frame_url) ?? readString(record.firstFrameUrl) ?? joinAssetUrl(baseUrl, jobId, firstFramePath);
    const middleFrameUrl = readString(record.middle_frame_url) ?? readString(record.middleFrameUrl) ?? joinAssetUrl(baseUrl, jobId, middleFramePath);
    const lastFrameUrl = readString(record.last_frame_url) ?? readString(record.lastFrameUrl) ?? joinAssetUrl(baseUrl, jobId, lastFramePath);
    const storyboardUrl = readString(record.storyboard_url) ?? readString(record.storyboardUrl) ?? joinAssetUrl(baseUrl, jobId, storyboardPath);
    const index = Math.max(0, Math.round(readNumber(record.index, arrayIndex + 1)) - 1);
    const sceneData = asRecord(record.sceneData) ?? asRecord(record.scene_data) ?? asRecord(record.meta);
    const caption = readString(record.caption) ?? readString(record.text);
    const sampleTimes = asRecord(record.sample_times) ?? asRecord(record.sampleTimes);
    const visualAnalysis = normalizeVisualAnalysis(record);
    const motionDescriptor = normalizeMotionDescriptor(record.motionDescriptor ?? record.motion_descriptor ?? visualAnalysis?.motion);
    const keyframeTimestamps = readNumberArray(record.keyframe_timestamps) ?? readNumberArray(record.keyframeTimestamps) ?? visualAnalysis?.keyframeTimestamps;

    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;

    normalized.push({
      id: index,
      sourceClipId,
      label: readString(record.label) ?? `Scene ${String(index + 1).padStart(2, "0")}`,
      start,
      end,
      duration: duration > 0 ? duration : end - start,
      thumbnailUrl,
      firstFrameUrl: firstFrameUrl ?? thumbnailUrl,
      middleFrameUrl,
      lastFrameUrl,
      storyboardUrl,
      sampleTimes: sampleTimes ? {
        first: readNumber(sampleTimes.first, NaN),
        middle: readNumber(sampleTimes.middle, NaN),
        last: readNumber(sampleTimes.last, NaN),
      } : undefined,
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
      captionSource: readString(record.captionSource) as DetectedSceneSegment["captionSource"] | undefined ?? (caption ? "imported" : undefined),
      captionMode: readString(record.captionMode) === "smart" || readString(record.caption_mode) === "smart" ? "smart" : caption ? "fast" : undefined,
      captionModel: readString(record.captionModel) ?? readString(record.caption_model),
      captionSampleStrategy: readString(record.captionSampleStrategy) ?? readString(record.caption_sample_strategy),
      visualAnalysis,
      motionDescriptor,
      contentHash: readString(record.contentHash) ?? readString(record.content_hash) ?? visualAnalysis?.contentHash,
      keyframeTimestamps,
      splitKind: readString(record.splitKind) === "micro-shot" || readString(record.split_kind) === "micro-shot" ? "micro-shot" : "scene",
      parentSceneId: readNumber(record.parentSceneId, readNumber(record.parent_scene_id, NaN)),
    });
  });

  return normalized;
}

function normalizeVisualAnalysis(record: Record<string, unknown>): SceneVisualAnalysis | undefined {
  const raw = asRecord(record.visualAnalysis) ?? asRecord(record.visual_analysis);
  const color = normalizeColorAnalysis(raw?.color ?? record.colorAnalysis ?? record.color_analysis ?? record.palette);
  const motion = normalizeMotionDescriptor(raw?.motion ?? raw?.motionDescriptor ?? raw?.motion_descriptor);
  const keyframeTimestamps = readNumberArray(raw?.keyframeTimestamps) ?? readNumberArray(raw?.keyframe_timestamps) ?? readNumberArray(record.keyframeTimestamps) ?? readNumberArray(record.keyframe_timestamps);
  const contentHash = readString(raw?.contentHash) ?? readString(raw?.content_hash) ?? readString(record.contentHash) ?? readString(record.content_hash);

  if (!raw && !color && !motion && !keyframeTimestamps?.length && !contentHash) return undefined;
  return {
    schema: readString(raw?.schema),
    analyzerVersion: readString(raw?.analyzerVersion) ?? readString(raw?.analyzer_version),
    contentHash,
    keyframeTimestamps,
    color,
    motion,
    generatedAt: readString(raw?.generatedAt) ?? readString(raw?.generated_at),
  };
}

function normalizeColorAnalysis(value: unknown): SceneColorAnalysis | undefined {
  const record = asRecord(value);
  if (Array.isArray(value)) {
    const palette = normalizePalette(value);
    return palette.length ? { palette } : undefined;
  }
  const palette = normalizePalette(record?.palette);
  const firstPalette = normalizePalette(record?.firstPalette ?? record?.first_palette);
  const middlePalette = normalizePalette(record?.middlePalette ?? record?.middle_palette);
  const lastPalette = normalizePalette(record?.lastPalette ?? record?.last_palette);
  if (!palette.length && !firstPalette.length && !middlePalette.length && !lastPalette.length) return undefined;
  return {
    palette,
    firstPalette: firstPalette.length ? firstPalette : undefined,
    middlePalette: middlePalette.length ? middlePalette : undefined,
    lastPalette: lastPalette.length ? lastPalette : undefined,
    paletteDistanceStartEnd: readNumber(record?.paletteDistanceStartEnd, readNumber(record?.palette_distance_start_end, NaN)),
  };
}

function normalizePalette(value: unknown): ColorPaletteSwatch[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return { hex: item, weight: 1 };
      const record = asRecord(item);
      if (!record) return null;
      const weight = readNumber(record.weight, 1);
      const swatch: ColorPaletteSwatch = {
        hex: readString(record.hex),
        l: readNumber(record.l, NaN),
        a: readNumber(record.a, NaN),
        b: readNumber(record.b, NaN),
        weight,
      };
      return swatch.hex || Number.isFinite(swatch.l) ? swatch : null;
    })
    .filter((item): item is ColorPaletteSwatch => Boolean(item));
}

function normalizeMotionDescriptor(value: unknown): MotionDescriptor | null {
  const record = asRecord(value);
  if (!record) return null;
  const confidence = asRecord(record.confidence);
  const provenance = asRecord(record.provenance);
  const cameraMotionType = readString(record.cameraMotionType) ?? readString(record.camera_motion_type) ?? "unknown";
  return {
    id: readString(record.id) ?? `segment-motion:${readNumber(record.segmentId, readNumber(record.segment_id, 0))}`,
    targetKind: readString(record.targetKind) === "file" || readString(record.target_kind) === "file" ? "file" : "segment",
    filePath: readString(record.filePath) ?? readString(record.file_path) ?? "",
    segmentId: readNumber(record.segmentId, readNumber(record.segment_id, NaN)),
    start: readNumber(record.start, NaN),
    end: readNumber(record.end, NaN),
    dominantAngleDeg: readNullableNumber(record.dominantAngleDeg ?? record.dominant_angle_deg),
    dominantMagnitude: readNullableNumber(record.dominantMagnitude ?? record.dominant_magnitude),
    motionCoherence: readNullableNumber(record.motionCoherence ?? record.motion_coherence),
    cameraMotionType: isCameraMotionType(cameraMotionType) ? cameraMotionType : "unknown",
    cameraMotionStrength: readNullableNumber(record.cameraMotionStrength ?? record.camera_motion_strength),
    residualMotionStrength: readNullableNumber(record.residualMotionStrength ?? record.residual_motion_strength),
    motionEntropy: readNullableNumber(record.motionEntropy ?? record.motion_entropy),
    acceleration: readNullableNumber(record.acceleration),
    angleHistogram: readNumberArray(record.angleHistogram) ?? readNumberArray(record.angle_histogram) ?? null,
    magnitudeP50: readNullableNumber(record.magnitudeP50 ?? record.magnitude_p50),
    magnitudeP90: readNullableNumber(record.magnitudeP90 ?? record.magnitude_p90),
    confidence: {
      overall: clamp01(readNumber(confidence?.overall, 0.75)),
      camera: clamp01(readNumber(confidence?.camera, 0.75)),
      residual: clamp01(readNumber(confidence?.residual, 0.75)),
    },
    provenance: {
      kind: readString(provenance?.kind) === "ffmpeg-motion-vectors" || readString(provenance?.kind) === "optical-flow" || readString(provenance?.kind) === "manual" ? readString(provenance?.kind) as MotionDescriptor["provenance"]["kind"] : "optical-flow",
      tool: readString(provenance?.tool) ?? "media-worker",
      version: readString(provenance?.version) ?? null,
      generatedAt: readString(provenance?.generatedAt) ?? readString(provenance?.generated_at) ?? new Date(0).toISOString(),
      notes: readString(provenance?.notes) ?? null,
    },
  };
}

function readNullableNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isCameraMotionType(value: string): value is MotionDescriptor["cameraMotionType"] {
  return ["static", "pan", "tilt", "push", "pull", "roll", "mixed", "unknown"].includes(value);
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
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
