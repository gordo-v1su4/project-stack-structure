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
    const videoUrl = asset.fullStorage?.mediaUrl ?? asset.fullStorage?.publicUrl ?? asset.resultUrl;
    if (!target || !videoUrl) continue;
    const index = next.findIndex((segment) => segment.sectionId === target.sectionId
      && rangesMatch(segment.musicStart, segment.musicEnd, target.songStart, target.songEnd));
    if (index < 0) continue;

    const replaced = next[index];
    const requiredDuration = Math.max(0.05, replaced.musicEnd - replaced.musicStart);
    const trimStart = Math.max(0, Math.min(asset.trimStart ?? 0, Math.max(0, (asset.durationSeconds ?? requiredDuration) - requiredDuration)));
    next[index] = {
      ...replaced,
      videoUrl,
      startTime: trimStart,
      endTime: trimStart + requiredDuration,
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
  const videoUrl = asset.fullStorage?.mediaUrl ?? asset.fullStorage?.publicUrl ?? asset.resultUrl;
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

  const requiredDuration = Math.max(0.05, replaced.musicEnd - replaced.musicStart);
  const trimStart = Math.max(0, Math.min(asset.trimStart ?? 0, Math.max(0, (asset.durationSeconds ?? requiredDuration) - requiredDuration)));
  context[localTargetIndex] = {
    ...replaced,
    videoUrl,
    startTime: trimStart,
    endTime: trimStart + requiredDuration,
    label: asset.title ?? `${asset.model} generated replacement`,
    momentId: undefined,
    sourceClipId: undefined,
    sourceRefLabel: `PREVIEW GEN · ${asset.model}`,
    thumbnailUrl: asset.thumbnailUrl,
  };

  return { segments: context, startIndex, endIndex, targetIndex };
}

function rangesMatch(leftStart: number, leftEnd: number, rightStart: number, rightEnd: number) {
  return Math.abs(leftStart - rightStart) < 0.08 && Math.abs(leftEnd - rightEnd) < 0.08;
}
