import { createHash } from "node:crypto";
import { hydrateStudioProjectDraft, type PersistedStudioProjectDraft } from "@/components/studio/projectPersistence";
import { buildStoryDraftSegments } from "@/components/studio/animaticDraft";
import { applyDraftGeneratedAssets } from "@/components/studio/generatedDraft";
import { applyGeneratedAssetOverlays, generatedAssetMatchesPreviewSegment, listApprovedGeneratedVideoAssets } from "@/components/studio/generatedAssets";
import type { PreviewReviewCut } from "@/components/studio/animaticPreviewSnapshot";
import type { StillAnimaticPlan } from "@/components/studio/stillAnimatic";
import { clipAudioKey, normalizeClipAudioSettings, usesClipAudio } from "@/components/studio/clipAudio";
import { replacementTargets } from "@/components/studio/replacementReview";

/** Viewing projection only; use the same identity/selection/trim gates as Draft. */
export function projectReviewInputs(projectId: string, draft: PersistedStudioProjectDraft, plan: StillAnimaticPlan | null) {
  const runtime = hydrateStudioProjectDraft({ draft: { ...draft, storyState: { ...draft.storyState, stillAnimaticPlan: plan ?? undefined } } });
  const base = buildStoryDraftSegments({ projectId, project: runtime.musicVideoProject, storyState: runtime.storyState,
    videoSources: runtime.videoSources, referenceAssets: runtime.referenceAssets ?? [], audio: draft.analysis ?? draft.musicVideoProject?.song })
    .map(segment => {
      const source = runtime.videoSources.find(source => source.videoUrl === segment.videoUrl);
      return { ...segment, useClipAudio: segment.kind !== "gap" && usesClipAudio(normalizeClipAudioSettings(runtime.clipAudioSettings), source ? clipAudioKey(source) : undefined) };
    });
  return { runtime, base };
}

export function projectReviewCut(projectId: string, draft: PersistedStudioProjectDraft, plan: StillAnimaticPlan | null): PreviewReviewCut {
  const { runtime, base } = projectReviewInputs(projectId, draft, plan);
  const assets = runtime.generatedAssets ?? [];
  const segments = applyDraftGeneratedAssets(base, assets, runtime.generatedDraft);
  // A read-only screening copy makes delivered candidates watchable before the
  // separate, explicit selection/identity/approval steps. Never persist it.
  const candidates = assets.filter(asset => asset.reviewStatus !== "rejected")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const deliveredSegments = segments.flatMap(segment => {
    if (segment.kind !== "gap" && segment.videoUrl) return [segment];
    const overlaid = applyGeneratedAssetOverlays([segment], candidates);
    if (overlaid.some(part => part.kind !== "gap" && part.videoUrl)) return overlaid.map(part => ({
      ...part, thumbnailUrl: part.thumbnailUrl ?? segment.thumbnailUrl,
    }));
    const retained = plan?.projectId === projectId ? plan.shots.find(shot => shot.id === segment.animaticShotId)?.sourceFrame : undefined;
    const source = retained && runtime.videoSources.find(source => source.id === retained.sourceId);
    const duration = segment.musicEnd - segment.musicStart;
    if (!retained || !source?.videoUrl || !Number.isFinite(retained.sourceSecond) || retained.sourceSecond < 0
      || !Number.isFinite(source.duration) || retained.sourceSecond + duration > source.duration + .001) return [segment];
    const videoUrl = source.storageBucket && source.storagePath
      ? `/api/storage/media?${new URLSearchParams({ bucket: source.storageBucket, objectKey: source.storagePath })}` : source.videoUrl;
    return [{ ...segment, kind: "source" as const, videoUrl, sourceClipId: source.id,
      startTime: retained.sourceSecond, endTime: retained.sourceSecond + duration, gapReason: undefined,
      sourceRefLabel: "PREVIEW · retained source footage", useClipAudio: false }];
  });
  const availableVideoCount = assets.filter(asset => asset.status === "completed" && asset.mediaKind === "video"
    && base.some(segment => generatedAssetMatchesPreviewSegment(asset, segment))).length;
  const approved = new Set(listApprovedGeneratedVideoAssets(assets).map(asset => asset.id));
  const coverage = (plan?.shots ?? []).map(shot => {
    const windows = base.filter(segment => segment.animaticShotId === shot.id);
    const available = assets.filter(asset => asset.status === "completed" && asset.mediaKind === "video"
      && windows.some(segment => generatedAssetMatchesPreviewSegment(asset, segment)));
    return { shotId: shot.id, availableTakeIds: available.map(asset => asset.id),
      selectedVideoCount: segments.filter(segment => segment.animaticShotId === shot.id && segment.kind !== "gap" && Boolean(segment.videoUrl)).length,
      approvedTakeCount: available.filter(asset => approved.has(asset.id)).length };
  });
  return { segments, deliveredSegments, deliveredVideoCount: deliveredSegments.filter(s => s.kind !== "gap" && Boolean(s.videoUrl)).length,
    targets: replacementTargets(projectId, base), coverage, availableVideoCount, selectedVideoCount: segments.filter(s => s.kind !== "gap" && Boolean(s.videoUrl)).length,
    fingerprint: createHash("sha256").update(JSON.stringify({ segments, deliveredSegments })).digest("hex") };
}
