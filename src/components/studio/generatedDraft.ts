import {currentIdentityReviewSha256,currentReferenceIdentityApprovalSha256} from "./currentReferenceIdentity";
import {
  applyApprovedGeneratedAssets,
  applyGeneratedAssetOverlays,
  buildGeneratedAssetPlaybackUrl,
  generatedAssetMatchesPreviewSegment,
  generatedAssetDraftIdentityBlockReason,
  type GeneratedStudioAsset,
} from "./generatedAssets";
import type { EditPlanPreviewSegment } from "./musicVideoProject";
import { approvedIdentityEvidenceSha256, currentIdentityEvidenceSha256 } from "./issuedIdentityPolicy";

/** Candidate selection for an audition. It does not grant approval for export. */
export type GeneratedDraftSelection = {
  currentIdentityApprovalSha256?: string;
  planSignature: string;
  revision: number;
  assetIds: string[];
  sourceConfirmationSha256?: string;
  sourceReviewRequired?: boolean;
};

/** Capture this when preparing the preview, and accept only that viewed preview. */
export type GeneratedDraftReview = {
  planSignature: string;
  revision: number;
  fingerprint: string;
};

export function createGeneratedDraftSelection(planSignature: string): GeneratedDraftSelection {
  return { planSignature, revision: 0, assetIds: [] };
}

export function sanitizeGeneratedDraftSelection(value: unknown): GeneratedDraftSelection | null {
  if (!value || typeof value !== "object") return null;
  const draft = value as Partial<GeneratedDraftSelection>;
  if (typeof draft.planSignature !== "string" || !draft.planSignature.trim()
    || !Number.isSafeInteger(draft.revision) || (draft.revision ?? -1) < 0
    || !Array.isArray(draft.assetIds) || !draft.assetIds.every(id => typeof id === "string" && id.trim())) return null;
  if (draft.sourceConfirmationSha256 !== undefined && !/^[a-f0-9]{64}$/.test(draft.sourceConfirmationSha256)) return null;
  if (draft.sourceReviewRequired !== undefined && typeof draft.sourceReviewRequired !== "boolean") return null;
  if(draft.currentIdentityApprovalSha256!==undefined&&!/^[a-f0-9]{64}$/.test(draft.currentIdentityApprovalSha256))return null;
  return { planSignature: draft.planSignature, revision: draft.revision!, assetIds: [...new Set(draft.assetIds)],
    ...(draft.currentIdentityApprovalSha256?{currentIdentityApprovalSha256:draft.currentIdentityApprovalSha256}:{}),
    ...(draft.sourceConfirmationSha256 ? { sourceConfirmationSha256: draft.sourceConfirmationSha256, sourceReviewRequired: draft.sourceReviewRequired !== false } : {}) };
}

export function isGeneratedDraftCurrent(segments: EditPlanPreviewSegment[], draft: GeneratedDraftSelection | null | undefined): draft is GeneratedDraftSelection {
  return Boolean(draft?.planSignature && segments.length && segments.every(segment => segment.planSignature === draft.planSignature));
}

function isSelectableAsset(asset: GeneratedStudioAsset, segments: EditPlanPreviewSegment[]) {
  return asset.status === "completed" && asset.mediaKind === "video" && asset.reviewStatus !== "rejected"
    && generatedAssetDraftIdentityBlockReason(asset) === null
    && Boolean(buildGeneratedAssetPlaybackUrl(asset)) && Number.isFinite(asset.durationSeconds) && (asset.durationSeconds ?? 0) > 0
    && segments.some(segment => generatedAssetMatchesPreviewSegment(asset, segment));
}

function sameTarget(left: GeneratedStudioAsset, right: GeneratedStudioAsset) {
  const a = left.target;
  const b = right.target;
  return Boolean(a && b && a.planSignature === b.planSignature && a.sectionId === b.sectionId
    && (a.requirementId || a.timelineItemId) === (b.requirementId || b.timelineItemId)
    && a.songStart === b.songStart && a.songEnd === b.songEnd);
}

/** A late completion is retained in the asset bank but must not change a newer selection. */
export function selectGeneratedDraftAsset({ draft, assets, asset, segments, expectedRevision }: {
  draft: GeneratedDraftSelection;
  assets: GeneratedStudioAsset[];
  asset: GeneratedStudioAsset;
  segments: EditPlanPreviewSegment[];
  expectedRevision?: number;
}): GeneratedDraftSelection {
  if ((expectedRevision !== undefined && expectedRevision !== draft.revision)
    || !isGeneratedDraftCurrent(segments, draft) || !isSelectableAsset(asset, segments)
    || assets.some(existing => existing.id === asset.id && (existing.reviewStatus === "rejected" || existing.identityVerification?.status === "rejected"))) return draft;
  const byId = new Map(assets.map(candidate => [candidate.id, candidate]));
  const remaining = draft.assetIds.filter(id => id !== asset.id && (!byId.has(id) || !sameTarget(byId.get(id)!, asset)));
  const assetIds = [...remaining, asset.id];
  if (assetIds.length === draft.assetIds.length && assetIds.every((id, index) => id === draft.assetIds[index])) return draft;
  return { ...draft, revision: draft.revision + 1, assetIds };
}

function selectedAssets(segments: EditPlanPreviewSegment[], assets: GeneratedStudioAsset[], draft: GeneratedDraftSelection) {
  const byId = new Map(assets.map(asset => [asset.id, asset]));
  return draft.assetIds.flatMap(id => {
    const asset = byId.get(id);
    return asset && isSelectableAsset(asset, segments) ? [asset] : [];
  });
}

/** Draft playback includes only explicitly selected candidates over the approved edit. */
export function applyDraftGeneratedAssets(
  segments: EditPlanPreviewSegment[],
  assets: GeneratedStudioAsset[],
  draft: GeneratedDraftSelection | null | undefined,
): EditPlanPreviewSegment[] {
  const approved = applyApprovedGeneratedAssets(segments, assets);
  if (!isGeneratedDraftCurrent(segments, draft)) return approved;
  return applyGeneratedAssetOverlays(approved, selectedAssets(segments, assets, draft));
}

export function captureGeneratedDraftReview(
  segments: EditPlanPreviewSegment[],
  assets: GeneratedStudioAsset[],
  draft: GeneratedDraftSelection | null | undefined,
): GeneratedDraftReview | null {
  if (!isGeneratedDraftCurrent(segments, draft)) return null;
  const selected = selectedAssets(segments, assets, draft);
  if (selected.length !== draft.assetIds.length) return null;
  // Keep the canonical payload itself: unlike a short hash it cannot collide.
  // The token stays local to the prepared player and is never an approval credential.
  const fingerprint = JSON.stringify({
    planSignature: draft.planSignature,
    revision: draft.revision,
    sourceConfirmationSha256: draft.sourceConfirmationSha256,
    sourceReviewRequired: draft.sourceReviewRequired,
    currentIdentityReviewSha256:assets.find(asset=>asset.currentReferenceIdentity)?.currentReferenceIdentity
      ?currentIdentityReviewSha256(assets.find(asset=>asset.currentReferenceIdentity)!.currentReferenceIdentity!.context):undefined,
    assetIds: draft.assetIds,
    candidates: selected.map(asset => ({
      id: asset.id, status: asset.status, reviewStatus: asset.reviewStatus, prompt: asset.prompt,
      model: asset.model, target: asset.target, trimStart: asset.trimStart ?? 0,
      durationSeconds: asset.durationSeconds, videoUrl: buildGeneratedAssetPlaybackUrl(asset),
      mediaSha256: asset.mediaSha256, mediaFrameCount: asset.mediaFrameCount, mediaFrameRate: asset.mediaFrameRate,
      generationReferenceHashes: asset.generationReferenceHashes,
      identityReferenceHashes: asset.identityReferenceHashes, identityVerification: asset.identityVerification, identityAssessmentId: asset.identityAssessmentId, identityAssessmentTrimStart: asset.identityAssessmentTrimStart,
    })),
    approvedIdentityEvidence: assets.filter(asset => asset.reviewStatus === "approved").map(asset => ({
      id: asset.id, mediaSha256: asset.mediaSha256, mediaFrameCount: asset.mediaFrameCount, mediaFrameRate: asset.mediaFrameRate,
      generationReferenceHashes: asset.generationReferenceHashes, identityReferenceHashes: asset.identityReferenceHashes,
      identityVerification: asset.identityVerification, identityAssessmentId: asset.identityAssessmentId, identityAssessmentTrimStart: asset.identityAssessmentTrimStart,
      target: asset.target, trimStart: asset.trimStart ?? 0, approvedIdentityEvidenceSha256: asset.approvedIdentityEvidenceSha256,approvedCurrentReferenceEvidenceSha256:asset.approvedCurrentReferenceEvidenceSha256,
    })),
    segments: applyDraftGeneratedAssets(segments, assets, draft),
  });
  return { planSignature: draft.planSignature, revision: draft.revision, fingerprint };
}

export function rejectGeneratedDraftAsset({ draft, assets, assetId, expectedRevision }: {
  draft: GeneratedDraftSelection;
  assets: GeneratedStudioAsset[];
  assetId: string;
  expectedRevision?: number;
}): { draft: GeneratedDraftSelection; assets: GeneratedStudioAsset[] } {
  if ((expectedRevision !== undefined && expectedRevision !== draft.revision) || !assets.some(asset => asset.id === assetId)) return { draft, assets };
  const assetIds = draft.assetIds.filter(id => id !== assetId);
  return {
    draft: { ...draft, revision: draft.revision + 1, assetIds },
    assets: assets.map(asset => asset.id === assetId ? { ...asset, reviewStatus: "rejected", approvedAt: undefined, approvedIdentityEvidenceSha256: undefined } : asset),
  };
}

/** Invoke only from explicit Use this draft consent, then revalidate the viewed snapshot after awaiting. */
export async function prepareGeneratedDraftApprovalEvidence(assets: GeneratedStudioAsset[], draft: GeneratedDraftSelection): Promise<Record<string, string>> {
  const selected = new Set(draft.assetIds);
  return Object.fromEntries(await Promise.all(assets.filter(asset => selected.has(asset.id) && (asset.identityVerification?.issuedPolicy || asset.identityAssessmentId || asset.currentReferenceIdentity))
    .map(async asset => [asset.id, await approvedIdentityEvidenceSha256(asset)])));
}

export function approveGeneratedDraft({ draft, assets, segments, review, approvedAt = new Date().toISOString(), approvalEvidenceSha256ById }: {
  draft: GeneratedDraftSelection;
  assets: GeneratedStudioAsset[];
  segments: EditPlanPreviewSegment[];
  review: GeneratedDraftReview;
  approvedAt?: string;
  approvalEvidenceSha256ById?: Readonly<Record<string, string>>;
}): { draft: GeneratedDraftSelection; assets: GeneratedStudioAsset[]; error: string | null } {
  const current = captureGeneratedDraftReview(segments, assets, draft);
  if (!current || review.planSignature !== current.planSignature || review.revision !== current.revision || review.fingerprint !== current.fingerprint) {
    return { draft, assets, error: "The draft changed. Prepare and review the current cut before accepting it." };
  }
  const preview = applyDraftGeneratedAssets(segments, assets, draft);
  if (preview.some(segment => segment.kind === "gap" || !segment.videoUrl)) {
    return { draft, assets, error: "Unfilled song windows remain. Complete the draft before accepting it." };
  }
  const selected = new Set(draft.assetIds);
  if (assets.some(asset => selected.has(asset.id) && (asset.identityVerification?.issuedPolicy || asset.identityAssessmentId || asset.currentReferenceIdentity)
    && approvalEvidenceSha256ById?.[asset.id] !== currentIdentityEvidenceSha256(asset))) {
    return { draft, assets, error: "Similarity evidence changed. Review the current draft before accepting it." };
  }
  const requestedApprovalTime = Date.parse(approvedAt);
  if (!Number.isFinite(requestedApprovalTime)) return { draft, assets, error: "Approval time is invalid. Review the draft again." };
  const approvalTime = assets.reduce((latest, asset) => {
    const previous = asset.reviewStatus === "approved" ? Date.parse(asset.approvedAt ?? asset.createdAt) : NaN;
    return Number.isFinite(previous) ? Math.max(latest, previous + 1) : latest;
  }, requestedApprovalTime);
  // Approval order must reproduce the explicit audition order, even when the
  // user chose an older generated take over a newer approved take.
  const approvals = new Map(draft.assetIds.map((id, index) => [id, new Date(approvalTime + index).toISOString()]));
  return {
    draft: { ...draft, revision: draft.revision + 1, assetIds: [], ...(draft.sourceConfirmationSha256 ? { sourceReviewRequired: false } : {}),
      ...(assets.find(asset=>asset.currentReferenceIdentity)?.currentReferenceIdentity?{currentIdentityApprovalSha256:currentIdentityReviewSha256(assets.find(asset=>asset.currentReferenceIdentity)!.currentReferenceIdentity!.context)}:{}) },
    assets: assets.map(asset => selected.has(asset.id) ? { ...asset, reviewStatus: "approved", approvedAt: approvals.get(asset.id),
      ...(asset.currentReferenceIdentity?{approvedCurrentReferenceEvidenceSha256:currentReferenceIdentityApprovalSha256(asset)}:{}),
      ...((asset.identityVerification?.issuedPolicy || asset.identityAssessmentId || asset.currentReferenceIdentity) ? { approvedIdentityEvidenceSha256: approvalEvidenceSha256ById![asset.id] } : {}) } : asset),
    error: null,
  };
}
