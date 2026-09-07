import type { ImageSplitManifest } from "@/lib/imageSplitterGateway";
import type { MediaGatewayUploadResult } from "@/lib/mediaGateway";
import type { EditPlanPreviewSegment, TimelineItem } from "./musicVideoProject";
import type { StoryboardJob, VideoFrameRole } from "./storyboardGeneration";

export type GeneratedStudioAssetProvider = "higgsfield" | "swarmui";
export type GeneratedStudioAssetReviewStatus = "pending" | "approved" | "rejected";

export type GeneratedStudioAssetTarget = {
  planSignature?: string;
  requirementId?: string;
  narrativeMomentId?: string;
  timelineItemId: string;
  sectionId: string;
  sectionLabel: string;
  parentMomentId?: string;
  songStart: number;
  songEnd: number;
};

export type GeneratedStudioAsset = {
  id: string;
  provider: GeneratedStudioAssetProvider;
  model: string;
  characterName?: string;
  title?: string;
  prompt: string;
  createdAt: string;
  jobId?: string;
  status: "completed" | "failed" | "queued" | "processing";
  aspectRatio?: string;
  resolution?: string;
  width?: number;
  height?: number;
  resultUrl?: string;
  thumbnailUrl?: string;
  fullStorage?: MediaGatewayUploadResult;
  split?: ImageSplitManifest;
  mediaKind?: "image" | "video";
  durationSeconds?: number;
  trimStart?: number;
  reviewStatus?: GeneratedStudioAssetReviewStatus;
  reviewNotes?: string;
  target?: GeneratedStudioAssetTarget;
  storyboard?: StoryboardJob;
  panelReviews?: Record<string, GeneratedStudioAssetReviewStatus>;
  frameRole?: VideoFrameRole;
  triggerRunId?: string;
  approvedAt?: string;
};

export type GeneratedAssetContextPreview = {
  segments: EditPlanPreviewSegment[];
  startIndex: number;
  endIndex: number;
  targetIndex: number;
};

export type GeneratedAssetTrimWindow = {
  sourceDuration: number;
  requiredDuration: number;
  maxTrimStart: number;
  trimStart: number;
  trimEnd: number;
  selectedLeftPct: number;
  selectedWidthPct: number;
};

export type GeneratedAssetTrimFrameControl = {
  framesPerSecond: number;
  maxFrame: number;
  valueFrame: number;
};

export function resolveGeneratedAssetTrimFrameControl({
  trimStart,
  maxTrimStart,
  framesPerSecond = 30,
}: {
  trimStart: number;
  maxTrimStart: number;
  framesPerSecond?: number;
}): GeneratedAssetTrimFrameControl {
  const normalizedFramesPerSecond = Number.isFinite(framesPerSecond) && framesPerSecond > 0
    ? Math.round(framesPerSecond)
    : 30;
  const maxFrame = Math.max(0, Math.floor(maxTrimStart * normalizedFramesPerSecond + 1e-6));
  const valueFrame = Math.max(0, Math.min(Math.round(trimStart * normalizedFramesPerSecond), maxFrame));
  return { framesPerSecond: normalizedFramesPerSecond, maxFrame, valueFrame };
}

export function resolveGeneratedAssetTrimWindow({
  trimStart,
  sourceDuration,
  requiredDuration,
}: {
  trimStart?: number;
  sourceDuration?: number;
  requiredDuration: number;
}): GeneratedAssetTrimWindow {
  const normalizedRequiredDuration = Math.max(0.05, Number.isFinite(requiredDuration) ? requiredDuration : 0.05);
  const normalizedSourceDuration = Number.isFinite(sourceDuration) ? Math.max(0, sourceDuration ?? 0) : 0;
  const maxTrimStart = Math.max(0, normalizedSourceDuration - normalizedRequiredDuration);
  const normalizedTrimStart = Math.max(
    0,
    Math.min(Number.isFinite(trimStart) ? trimStart ?? 0 : 0, maxTrimStart),
  );
  const trimEnd = Math.min(normalizedSourceDuration, normalizedTrimStart + normalizedRequiredDuration);
  const selectedWidthPct = Math.min(100, (normalizedRequiredDuration / Math.max(0.05, normalizedSourceDuration)) * 100);
  const selectedLeftPct = Math.min(
    100 - selectedWidthPct,
    (normalizedTrimStart / Math.max(0.05, normalizedSourceDuration)) * 100,
  );

  return {
    sourceDuration: normalizedSourceDuration,
    requiredDuration: normalizedRequiredDuration,
    maxTrimStart,
    trimStart: normalizedTrimStart,
    trimEnd,
    selectedLeftPct,
    selectedWidthPct,
  };
}

export function sanitizeGeneratedStudioAssetForStorage(asset: GeneratedStudioAsset): GeneratedStudioAsset {
  return {
    id: asset.id,
    provider: asset.provider,
    model: asset.model,
    characterName: asset.characterName,
    title: asset.title,
    prompt: asset.prompt,
    createdAt: asset.createdAt,
    jobId: asset.jobId,
    status: asset.status,
    aspectRatio: asset.aspectRatio,
    resolution: asset.resolution,
    width: asset.width,
    height: asset.height,
    resultUrl: stripRuntimeUrl(asset.resultUrl),
    thumbnailUrl: stripRuntimeUrl(asset.thumbnailUrl),
    fullStorage: asset.fullStorage,
    split: asset.split,
    mediaKind: asset.mediaKind,
    durationSeconds: asset.durationSeconds,
    trimStart: asset.trimStart,
    reviewStatus: asset.reviewStatus,
    reviewNotes: asset.reviewNotes,
    target: asset.target,
    storyboard: asset.storyboard,
    panelReviews: asset.panelReviews,
    frameRole: asset.frameRole,
    triggerRunId: asset.triggerRunId,
    approvedAt: asset.approvedAt,
  };
}

export function hydrateGeneratedStudioAssets(assets: GeneratedStudioAsset[] | undefined): GeneratedStudioAsset[] {
  return Array.isArray(assets) ? assets.map(sanitizeGeneratedStudioAssetForStorage) : [];
}

function stripRuntimeUrl(value: string | undefined) {
  if (!value) return undefined;
  return value.startsWith("data:") || value.startsWith("blob:") ? undefined : value;
}

export type GeneratedTargetWindow = {
  planSignature?: string; requirementId?: string; timelineItemId?: string; sectionId: string; songStart: number; songEnd: number;
};

export function generatedAssetWindow(asset: GeneratedStudioAsset, window: GeneratedTargetWindow) {
  const target = asset.target;
  if (!target || !target.planSignature || target.planSignature !== window.planSignature || target.sectionId !== window.sectionId) return null;
  if (target.requirementId || window.requirementId) {
    if (!target.requirementId || target.requirementId !== window.requirementId) return null;
  } else if (!window.timelineItemId || target.timelineItemId !== window.timelineItemId) return null;
  if (![target.songStart, target.songEnd, window.songStart, window.songEnd].every(Number.isFinite) || target.songEnd <= target.songStart) return null;
  const trim = resolveGeneratedAssetTrimWindow({ trimStart: asset.trimStart, sourceDuration: asset.durationSeconds, requiredDuration: target.songEnd - target.songStart });
  const usableEnd = target.songStart + trim.trimEnd - trim.trimStart;
  const songStart = Math.max(window.songStart, target.songStart);
  const songEnd = Math.min(window.songEnd, target.songEnd, usableEnd);
  if (songEnd <= songStart + 0.001) return null;
  return { songStart, songEnd, sourceStart: trim.trimStart + songStart - target.songStart, sourceEnd: trim.trimStart + songEnd - target.songStart };
}

function sliceSegment(segment: EditPlanPreviewSegment, start: number, end: number): EditPlanPreviewSegment {
  const ratio = (segment.endTime - segment.startTime) / Math.max(0.001, segment.musicEnd - segment.musicStart);
  return { ...segment, musicStart: start, musicEnd: end,
    startTime: segment.kind === "gap" ? 0 : segment.startTime + (start - segment.musicStart) * ratio,
    endTime: segment.kind === "gap" ? end - start : segment.startTime + (end - segment.musicStart) * ratio };
}

export function applyApprovedGeneratedAssets(segments: EditPlanPreviewSegment[], assets: GeneratedStudioAsset[]): EditPlanPreviewSegment[] {
  let next = segments.map((segment) => ({ ...segment }));
  const approved = listApprovedGeneratedVideoAssets(assets).sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
  for (const asset of approved) {
    const videoUrl = buildGeneratedAssetPlaybackUrl(asset)!;
    next = next.flatMap((segment) => {
      const window = generatedAssetWindow(asset, { ...segment, songStart: segment.musicStart, songEnd: segment.musicEnd });
      if (!window) return [segment];
      const pieces: EditPlanPreviewSegment[] = [];
      if (window.songStart > segment.musicStart + 0.001) pieces.push(sliceSegment(segment, segment.musicStart, window.songStart));
      pieces.push({ ...segment, kind: "source", gapReason: undefined, videoUrl,
        musicStart: window.songStart, musicEnd: window.songEnd, startTime: window.sourceStart, endTime: window.sourceEnd,
        label: asset.title ?? `${asset.model} generated replacement`, momentId: undefined, sourceClipId: undefined,
        sourceRefLabel: `GEN · ${asset.model}`, thumbnailUrl: asset.thumbnailUrl });
      if (window.songEnd < segment.musicEnd - 0.001) pieces.push(sliceSegment(segment, window.songEnd, segment.musicEnd));
      return pieces;
    });
  }
  return next;
}

export function buildGeneratedAssetContextPreview(segments: EditPlanPreviewSegment[], asset: GeneratedStudioAsset, contextRadius = 2): GeneratedAssetContextPreview | null {
  if (asset.mediaKind !== "video" || asset.status !== "completed" || !buildGeneratedAssetPlaybackUrl(asset)) return null;
  const targetIndex = segments.findIndex((segment) => generatedAssetWindow(asset, { ...segment, songStart: segment.musicStart, songEnd: segment.musicEnd }));
  if (targetIndex < 0) return null;
  const radius = Math.max(0, Math.floor(contextRadius));
  const startIndex = Math.max(0, targetIndex - radius);
  const endIndex = Math.min(segments.length - 1, targetIndex + radius);
  const previewAsset = { ...asset, reviewStatus: "approved" as const, title: `GENERATED CANDIDATE · ${asset.model} · ${asset.title ?? asset.target?.sectionLabel}` };
  const context = applyApprovedGeneratedAssets(segments.slice(startIndex, endIndex + 1), [previewAsset]);
  for (const segment of context) if (segment.sourceRefLabel === `GEN · ${asset.model}`) segment.sourceRefLabel = `PREVIEW GEN · ${asset.model}`;
  return { segments: context, startIndex, endIndex, targetIndex };
}

export function buildGeneratedAssetPlaybackUrl(asset: GeneratedStudioAsset): string | undefined {
  const bucket = asset.fullStorage?.bucket;
  const objectKey = asset.fullStorage?.objectKey ?? asset.fullStorage?.storagePath;
  if (bucket && objectKey) {
    const params = new URLSearchParams({ bucket, objectKey });
    return `/api/storage/media?${params.toString()}`;
  }
  return asset.fullStorage?.mediaUrl ?? asset.fullStorage?.publicUrl ?? asset.resultUrl;
}

export function listApprovedGeneratedVideoAssets(assets: GeneratedStudioAsset[]) {
  return assets.filter((asset) => asset.status === "completed" && asset.mediaKind === "video" && asset.reviewStatus === "approved"
    && asset.target && Boolean(buildGeneratedAssetPlaybackUrl(asset)) && Number.isFinite(asset.durationSeconds) && (asset.durationSeconds ?? 0) > 0);
}

export function generatedAssetMatchesTimelineItem(asset: GeneratedStudioAsset, item: Pick<TimelineItem, "id" | "sectionId" | "start" | "end" | "requirementId">, planSignature?: string) {
  return Boolean(generatedAssetWindow(asset, { planSignature, requirementId: item.requirementId, timelineItemId: item.id, sectionId: item.sectionId, songStart: item.start, songEnd: item.end }));
}

export function generatedAssetMatchesPreviewSegment(asset: GeneratedStudioAsset, segment: EditPlanPreviewSegment, timelineItemId?: string) {
  return Boolean(generatedAssetWindow(asset, { ...segment, timelineItemId: segment.timelineItemId ?? timelineItemId, songStart: segment.musicStart, songEnd: segment.musicEnd }));
}

/** A short or overlapping return cannot mark the whole requested window ready. */
export function approvedGeneratedAssetsCoverPreviewSegment(assets: GeneratedStudioAsset[], segment: EditPlanPreviewSegment, timelineItemId?: string): boolean {
  const windows = listApprovedGeneratedVideoAssets(assets).flatMap((asset) => {
    const window = generatedAssetWindow(asset, { ...segment, timelineItemId: segment.timelineItemId ?? timelineItemId,
      songStart: segment.musicStart, songEnd: segment.musicEnd });
    return window ? [window] : [];
  }).sort((a, b) => a.songStart - b.songStart);
  let coveredEnd = segment.musicStart;
  for (const window of windows) {
    if (window.songStart > coveredEnd + 0.001) return false;
    coveredEnd = Math.max(coveredEnd, window.songEnd);
  }
  return segment.musicEnd > segment.musicStart && coveredEnd >= segment.musicEnd - 0.001;
}
