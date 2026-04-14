import type { SectionRecomputeState } from "./sectionRecompute";
import type { ColorGradient, ShuffleMode, Tab } from "./types";

export function derivePreviewWindow(params: {
  tab: Tab;
  splitSegments: { duration: number }[];
  beatSplitSegments: { duration: number }[];
  splitActiveClip: number;
  beatActiveClip: number;
  rampDur: number;
}) {
  const { tab, splitSegments, beatSplitSegments, splitActiveClip, beatActiveClip, rampDur } = params;
  const segmentDuration =
    tab === "split"
      ? splitSegments[splitActiveClip]?.duration
      : beatSplitSegments[beatActiveClip]?.duration;
  const endTime = Math.max(0.5, Math.min(segmentDuration ?? rampDur ?? 1, 1.5));
  return { startTime: 0, endTime };
}

export function deriveManifestRankingMode(shuffleMode: ShuffleMode) {
  if (shuffleMode === "motion") return "motion" as const;
  if (shuffleMode === "color") return "color" as const;
  return "random" as const;
}

export function normalizeColorScore(params: {
  sourceClipId: number;
  gradient: ColorGradient;
  clipCount: number;
}) {
  const { sourceClipId, gradient, clipCount } = params;
  const base = (sourceClipId + 1) / Math.max(1, clipCount);
  switch (gradient) {
    case "Ocean":
      return Math.min(1, base * 0.8 + 0.2);
    case "Rainbow":
      return Math.min(1, base * 0.9 + 0.1);
    default:
      return Math.min(1, base);
  }
}

export function deriveEffectiveClipOrder(params: {
  manifestSegmentCount: number;
  segmentPreviewCount: number;
  rankedOrder: number[];
  fallbackOrder: number[];
}) {
  const { manifestSegmentCount, segmentPreviewCount, rankedOrder, fallbackOrder } = params;
  return manifestSegmentCount === segmentPreviewCount && rankedOrder.length === segmentPreviewCount
    ? rankedOrder
    : fallbackOrder;
}

export function deriveActionDisabledState(params: {
  needsVideoSource: boolean;
  videoSourceCount: number;
  requiresAudioSource: boolean;
  hasAudioSource: boolean;
  activeRequestKey: string | null;
}) {
  const { needsVideoSource, videoSourceCount, requiresAudioSource, hasAudioSource, activeRequestKey } = params;
  const isMissingVideoSource = needsVideoSource && videoSourceCount === 0;
  const isMissingAudioSource = requiresAudioSource && !hasAudioSource;
  const disabled = isMissingVideoSource || isMissingAudioSource || activeRequestKey !== null;
  const reason = activeRequestKey
    ? "Preview already running."
    : isMissingVideoSource
      ? "Upload video clips to continue."
      : isMissingAudioSource
        ? "Upload a song to unlock Beat Join."
        : undefined;

  return {
    disabled,
    reason,
  };
}

export function derivePreviewStatusLabel(previewState: SectionRecomputeState) {
  if (previewState.error) return "Preview Error";
  if (previewState.stage === "recomputing" || previewState.stage === "stale") return "Recomputing";
  if (previewState.stage === "ready" || previewState.stage === "swapped") return "Preview Ready";
  if (previewState.stage === "cancelled") return "Cancelled";
  return "Ready";
}

export function getPreviewAssetFileName(assetKey: string | null) {
  if (!assetKey) return null;
  const segments = assetKey.split(/[/\\]/);
  return segments.at(-1) ?? null;
}

export function buildPreviewAssetUrl(assetKey: string | null) {
  if (!assetKey) return null;
  if (assetKey.startsWith("http://") || assetKey.startsWith("https://")) return assetKey;
  return `/api/preview/asset?assetKey=${encodeURIComponent(assetKey)}`;
}

export function deriveCompletedLabel(currentAssetKey: string | null) {
  const assetFileName = getPreviewAssetFileName(currentAssetKey);
  return assetFileName ? `Prepared Preview — ${assetFileName}` : "Prepared Preview Complete";
}
