import { createHash } from "node:crypto";
import { hydrateStudioProjectDraft, type PersistedStudioProjectDraft } from "@/components/studio/projectPersistence";
import { buildStoryDraftSegments } from "@/components/studio/animaticDraft";
import { applyDraftGeneratedAssets } from "@/components/studio/generatedDraft";
import { generatedAssetMatchesPreviewSegment } from "@/components/studio/generatedAssets";
import type { PreviewReviewCut } from "@/components/studio/animaticPreviewSnapshot";
import type { StillAnimaticPlan } from "@/components/studio/stillAnimatic";
import { clipAudioKey, normalizeClipAudioSettings, usesClipAudio } from "@/components/studio/clipAudio";

/** Viewing projection only; use the same identity/selection/trim gates as Draft. */
export function projectReviewCut(projectId: string, draft: PersistedStudioProjectDraft, plan: StillAnimaticPlan | null): PreviewReviewCut {
  const runtime = hydrateStudioProjectDraft({ draft: { ...draft, storyState: { ...draft.storyState, stillAnimaticPlan: plan ?? undefined } } });
  const base = buildStoryDraftSegments({ projectId, project: runtime.musicVideoProject, storyState: runtime.storyState,
    videoSources: runtime.videoSources, referenceAssets: runtime.referenceAssets ?? [], audio: draft.analysis ?? draft.musicVideoProject?.song })
    .map(segment => {
      const source = runtime.videoSources.find(source => source.videoUrl === segment.videoUrl);
      return { ...segment, useClipAudio: segment.kind !== "gap" && usesClipAudio(normalizeClipAudioSettings(runtime.clipAudioSettings), source ? clipAudioKey(source) : undefined) };
    });
  const assets = runtime.generatedAssets ?? [];
  const segments = applyDraftGeneratedAssets(base, assets, runtime.generatedDraft);
  const availableVideoCount = assets.filter(asset => asset.status === "completed" && asset.mediaKind === "video"
    && base.some(segment => generatedAssetMatchesPreviewSegment(asset, segment))).length;
  return { segments, availableVideoCount, selectedVideoCount: segments.filter(s => s.kind !== "gap" && Boolean(s.videoUrl)).length,
    fingerprint: createHash("sha256").update(JSON.stringify(segments)).digest("hex") };
}
