import type { ImageSplitManifest } from "@/lib/imageSplitterGateway";
import type { MediaGatewayUploadResult } from "@/lib/mediaGateway";
import type { EditPlanPreviewSegment } from "./musicVideoProject";

export type GeneratedStudioAssetProvider = "higgsfield" | "swarmui";
export type GeneratedStudioAssetReviewStatus = "pending" | "approved" | "rejected";

export type GeneratedStudioAssetTarget = {
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
  const normalizedSourceDuration = Math.max(
    normalizedRequiredDuration,
    Number.isFinite(sourceDuration) ? sourceDuration ?? normalizedRequiredDuration : normalizedRequiredDuration,
  );
  const maxTrimStart = Math.max(0, normalizedSourceDuration - normalizedRequiredDuration);
  const normalizedTrimStart = Math.max(
    0,
    Math.min(Number.isFinite(trimStart) ? trimStart ?? 0 : 0, maxTrimStart),
  );
  const trimEnd = Math.min(normalizedSourceDuration, normalizedTrimStart + normalizedRequiredDuration);
  const selectedWidthPct = Math.min(100, (normalizedRequiredDuration / normalizedSourceDuration) * 100);
  const selectedLeftPct = Math.min(
    100 - selectedWidthPct,
    (normalizedTrimStart / normalizedSourceDuration) * 100,
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
  };
}

export function hydrateGeneratedStudioAssets(assets: GeneratedStudioAsset[] | undefined): GeneratedStudioAsset[] {
  return Array.isArray(assets) ? assets.map(sanitizeGeneratedStudioAssetForStorage) : [];
}

function stripRuntimeUrl(value: string | undefined) {
  if (!value) return undefined;
  return value.startsWith("data:") || value.startsWith("blob:") ? undefined : value;
}

export function applyApprovedGeneratedAssets(
  segments: EditPlanPreviewSegment[],
  assets: GeneratedStudioAsset[],
): EditPlanPreviewSegment[] {
  const next = segments.map((segment) => ({ ...segment }));
  const approved = assets
    .filter((asset) => asset.mediaKind === "video" && asset.reviewStatus === "approved" && asset.target)
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));

  for (const asset of approved) {
    const target = asset.target;
    const videoUrl = buildGeneratedAssetPlaybackUrl(asset);
    if (!target || !videoUrl) continue;
    const index = next.findIndex((segment) => segment.sectionId === target.sectionId
      && rangesMatch(segment.musicStart, segment.musicEnd, target.songStart, target.songEnd));
    if (index < 0) continue;

    const replaced = next[index];
    const { trimStart, trimEnd } = resolveGeneratedAssetTrimWindow({
      trimStart: asset.trimStart,
      sourceDuration: asset.durationSeconds,
      requiredDuration: replaced.musicEnd - replaced.musicStart,
    });
    next[index] = {
      ...replaced,
      videoUrl,
      startTime: trimStart,
      endTime: trimEnd,
      label: asset.title ?? `${asset.model} generated replacement`,
      momentId: undefined,
      sourceClipId: undefined,
      sourceRefLabel: `GEN · ${asset.model}`,
      thumbnailUrl: asset.thumbnailUrl,
    };
  }

  return next;
}

export function buildGeneratedAssetContextPreview(
  segments: EditPlanPreviewSegment[],
  asset: GeneratedStudioAsset,
  contextRadius = 2,
): GeneratedAssetContextPreview | null {
  const target = asset.target;
  const videoUrl = buildGeneratedAssetPlaybackUrl(asset);
  if (!target || !videoUrl || asset.mediaKind !== "video") return null;

  const targetIndex = segments.findIndex((segment) => segment.sectionId === target.sectionId
    && rangesMatch(segment.musicStart, segment.musicEnd, target.songStart, target.songEnd));
  if (targetIndex < 0) return null;

  const radius = Math.max(0, Math.floor(contextRadius));
  const startIndex = Math.max(0, targetIndex - radius);
  const endIndex = Math.min(segments.length - 1, targetIndex + radius);
  const context = segments.slice(startIndex, endIndex + 1).map((segment) => ({ ...segment }));
  const localTargetIndex = targetIndex - startIndex;
  const replaced = context[localTargetIndex];
  if (!replaced) return null;

  const { trimStart, trimEnd } = resolveGeneratedAssetTrimWindow({
    trimStart: asset.trimStart,
    sourceDuration: asset.durationSeconds,
    requiredDuration: replaced.musicEnd - replaced.musicStart,
  });
  context[localTargetIndex] = {
    ...replaced,
    videoUrl,
    startTime: trimStart,
    endTime: trimEnd,
    label: `GENERATED CANDIDATE · ${asset.model} · ${asset.title ?? target.sectionLabel}`,
    momentId: undefined,
    sourceClipId: undefined,
    sourceRefLabel: `PREVIEW GEN · ${asset.model}`,
    thumbnailUrl: asset.thumbnailUrl,
  };

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

function rangesMatch(leftStart: number, leftEnd: number, rightStart: number, rightEnd: number) {
  return Math.abs(leftStart - rightStart) < 0.08 && Math.abs(leftEnd - rightEnd) < 0.08;
}
