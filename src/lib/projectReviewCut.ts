import { createHash } from "node:crypto";
import { hydrateStudioProjectDraft, type PersistedStudioProjectDraft } from "@/components/studio/projectPersistence";
import { buildStoryDraftSegments } from "@/components/studio/animaticDraft";
import { applyDraftGeneratedAssets } from "@/components/studio/generatedDraft";
import { generatedAssetMatchesPreviewSegment, listApprovedGeneratedVideoAssets } from "@/components/studio/generatedAssets";
import { buildDeliveredScreeningSegments } from "@/components/studio/deliveredScreening";
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
  const deliveredSegments = buildDeliveredScreeningSegments({ segments, assets, videoSources: runtime.videoSources, plan, projectId });
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
