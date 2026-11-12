import { buildGeneratedAssetPlaybackUrl, generatedAssetMatchesPreviewSegment, type GeneratedStudioAsset } from "./generatedAssets";
import { generatedAssetDraftIdentityBlockReason } from "./generatedAssetIdentity";
import { createGeneratedDraftSelection, selectGeneratedDraftAsset, type GeneratedDraftSelection } from "./generatedDraft";
import type { EditPlanPreviewSegment } from "./musicVideoProject";
import type { SpineSlot } from "./shell/spineSlots";
import { sameAnimaticMotionBinding } from "./animaticMotionBinding";

/** Resolve an exact planned shot, even when the displayed selected take splits it. */
export function resolveShotTakeTarget(slot: SpineSlot | null, base: EditPlanPreviewSegment[]) {
  const shown = slot?.previewSegment;
  if (!shown?.planSignature || !shown.timelineItemId) return null;
  const matches = base.filter(target => target.planSignature === shown.planSignature && target.sectionId === shown.sectionId
    && target.timelineItemId === shown.timelineItemId && target.requirementId === shown.requirementId
    && sameAnimaticMotionBinding(target.animaticMotion, shown.animaticMotion)
    && target.musicStart <= shown.musicStart + 0.000001 && target.musicEnd >= shown.musicEnd - 0.000001);
  return matches.length === 1 ? matches[0] : null;
}

export function shotTakeTargetKey(projectId: string, target: EditPlanPreviewSegment) {
  return JSON.stringify([projectId, target.planSignature, target.sectionId, target.timelineItemId, target.requirementId,
    target.animaticMotion, target.musicStart, target.musicEnd]);
}

export function shotTakeBlockReason(asset: GeneratedStudioAsset) {
  return asset.reviewStatus === "rejected" ? "Rejected take" : generatedAssetDraftIdentityBlockReason(asset);
}

export function listShotTakes(target: EditPlanPreviewSegment, assets: GeneratedStudioAsset[], draft: GeneratedDraftSelection | null) {
  return assets.flatMap(asset => {
    const playbackUrl = buildGeneratedAssetPlaybackUrl(asset);
    return asset.status === "completed" && asset.mediaKind === "video" && playbackUrl && asset.target
      && Math.abs(asset.target.songStart - target.musicStart) < 0.000001 && Math.abs(asset.target.songEnd - target.musicEnd) < 0.000001
      && generatedAssetMatchesPreviewSegment(asset, target)
      ? [{ asset, playbackUrl, selected: Boolean(draft && draft.planSignature === target.planSignature && draft.assetIds.includes(asset.id)), block: shotTakeBlockReason(asset) }] : [];
  }).sort((a, b) => b.asset.createdAt.localeCompare(a.asset.createdAt) || a.asset.id.localeCompare(b.asset.id));
}

/** Explicit selection only; preserves bank/history and never approves a candidate. */
export function selectShotTake(input: { projectId: string; target: EditPlanPreviewSegment; segments: EditPlanPreviewSegment[];
  assets: GeneratedStudioAsset[]; draft: GeneratedDraftSelection | null; assetId: string; expectedTargetKey: string; expectedRevision: number }) {
  if (!input.target.planSignature || input.expectedTargetKey !== shotTakeTargetKey(input.projectId, input.target)
    || !input.segments.some(segment => shotTakeTargetKey(input.projectId, segment) === input.expectedTargetKey)) return input.draft;
  const candidate = listShotTakes(input.target, input.assets, input.draft).find(row => row.asset.id === input.assetId);
  if (!candidate || candidate.block) return input.draft;
  const draft = input.draft?.planSignature === input.target.planSignature ? input.draft : createGeneratedDraftSelection(input.target.planSignature);
  const selected = selectGeneratedDraftAsset({ draft, assets: input.assets, asset: candidate.asset, segments: input.segments, expectedRevision: input.expectedRevision });
  return selected === draft ? input.draft : selected;
}
