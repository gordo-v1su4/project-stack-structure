import { generatedAssetDraftIdentityBlockReason, type GeneratedStudioAsset } from "./generatedAssets";
import type { H3GenerationJob } from "./h3Generation";
import { identityAssessmentAsset, type H3IdentityAssessment } from "./h3IdentityAssessment";
import { currentReferenceIdentityApprovalSha256, withCurrentReferenceIdentity, type CurrentIdentityContext } from "./currentReferenceIdentity";
import { currentIdentityEvidenceSha256, identityPolicySha256 } from "./issuedIdentityPolicy";
import { reusedTakePlacementMatches, reuseOriginAssetSha256, type ReuseOrigin, type ReusedTakePlacement } from "./reusedTakePlacements";

export type GeneratedFootageEvidence = {
  assetId: string; jobId?: string; mediaSha256?: string;
  sourceStart: number; sourceEnd: number;
  evidenceKind: "requested-direction" | "media-only";
  completion: "unverified"; requestedDirection?: string;
};
export type SelectedFootageWindow = { songStart: number; songEnd: number; sourceStart: number; sourceEnd: number };
export type SelectedFootageEvidenceInput = {
  /** Must come from the actual applied-coverage ledger, never the whole asset bank. */
  selected: true;
  ownerId?: string; projectId: string; generationScope: string;
  asset: GeneratedStudioAsset; window: SelectedFootageWindow;
  job?: H3GenerationJob; rangeAssessment?: H3IdentityAssessment; currentIdentity?: CurrentIdentityContext;
  /** Browser-only advisory cache. The server adapter always overrides this to false. */
  advisoryCachedRange?: boolean;
  reusedTakePlacement?: ReusedTakePlacement;
  reuseOrigins?: ReuseOrigin[];
};
export type SelectedFootageEvidence = {
  evidence: GeneratedFootageEvidence;
  /** Included in planning's binding, never interpreted as observed action. */
  canonicalBinding: { bucket: string; objectKey: string; songStart: number; songEnd: number; targetSha256: string; requestSha256?: string; mediaSha256?: string;
    rangeAssessmentId?: string; identityEvidenceSha256?: string; currentReferenceEvidenceSha256?: string;
    reusePlacementSha256?: string; originScope?: string };
};
const near = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-6;
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const storage = (asset: GeneratedStudioAsset) => ({ bucket: asset.fullStorage?.bucket, objectKey: asset.fullStorage?.objectKey ?? asset.fullStorage?.storagePath });

/** Intent and exact selected media only. A prompt cannot certify an observed/completed action. */
export function resolveSelectedFootageEvidence(input: SelectedFootageEvidenceInput): SelectedFootageEvidence | undefined {
  try {
    if (input.reusedTakePlacement) {
      const row = input.reusedTakePlacement, asset = input.asset, window = input.window;
      const origin = input.reuseOrigins?.find(origin => origin.assetId === row.assetId && origin.jobId === row.jobId);
      if (!origin || origin.assetSha256 !== row.originSha256 || origin.assetSha256 !== reuseOriginAssetSha256(asset)
        || origin.scopeSignature !== asset.target?.planSignature || row.target.planSignature !== input.generationScope
        || !reusedTakePlacementMatches(row, asset, { ...row.target, planSignature: input.generationScope, videoUrl: "",
          musicStart: window.songStart, musicEnd: window.songEnd, startTime: window.sourceStart, endTime: window.sourceEnd, label: "" })
        || window.songStart < row.target.songStart - 1e-6 || window.songEnd > row.target.songEnd + 1e-6
        || !near(window.sourceStart, row.sourceStart + window.songStart - row.target.songStart)
        || !near(window.sourceEnd, row.sourceStart + window.songEnd - row.target.songStart)) return undefined;
      const songStart = asset.target!.songStart + window.sourceStart - (asset.trimStart ?? 0);
      const songEnd = songStart + window.sourceEnd - window.sourceStart;
      // Historical approvals do not grant or veto new creative consent. The caller still
      // validates canonical eligibility, and fresh reuse consent binds the actual evidence.
      const canonical = resolveSelectedFootageEvidence({ ...input, asset: { ...asset, reviewStatus: "pending" }, generationScope: origin.scopeSignature, reusedTakePlacement: undefined,
        window: { ...window, songStart, songEnd } });
      return canonical ? { ...canonical, canonicalBinding: { ...canonical.canonicalBinding,
        songStart: window.songStart, songEnd: window.songEnd, originScope: origin.scopeSignature,
        reusePlacementSha256: identityPolicySha256(row) } } : undefined;
    }
    const { asset, window, job } = input, media = storage(asset), target = asset.target;
    if (input.selected !== true || asset.status !== "completed" || asset.mediaKind !== "video" || asset.reviewStatus === "rejected" || !target
      || !media.bucket || !media.objectKey || media.bucket.length > 256 || media.objectKey.length > 2048 || asset.id.length > 256 || target.planSignature !== input.generationScope
      || ![window.songStart, window.songEnd, window.sourceStart, window.sourceEnd].every(Number.isFinite)
      || window.songEnd <= window.songStart || window.sourceStart < 0 || window.sourceEnd <= window.sourceStart
      || !near(window.songEnd - window.songStart, window.sourceEnd - window.sourceStart)
      || window.songStart < target.songStart - 1e-6 || window.songEnd > target.songEnd + 1e-6
      || !near(window.sourceStart, (asset.trimStart ?? 0) + window.songStart - target.songStart)
      || !Number.isFinite(asset.durationSeconds) || window.sourceEnd > asset.durationSeconds! + 1e-6) return undefined;
    const canonicalBinding = { bucket: media.bucket, objectKey: media.objectKey, songStart: window.songStart,
      songEnd: window.songEnd, targetSha256: identityPolicySha256(target) };
    const evidence = { assetId: asset.id, sourceStart: window.sourceStart, sourceEnd: window.sourceEnd,
      completion: "unverified" as const };
    const h3Path = /^media-uploads\/projects\/([^/]+)\/generated\/([^/]+)\/(h3-[a-f0-9]{64})\/shot\.mp4$/.exec(media.objectKey);
    const h3Namespace = /^media-uploads\/projects\/[^/]+\/generated\/[^/]+\/h3-[a-f0-9]{64}(?:\/|$)/.test(media.objectKey);
    if (asset.provider === "editorial" && asset.model === "original-footage-edit" && !asset.jobId && !h3Namespace) {
      return { evidence: { ...evidence, evidenceKind: "media-only", ...(hash(asset.mediaSha256) ? { mediaSha256: asset.mediaSha256 } : {}) }, canonicalBinding };
    }
    if (!job || asset.provider !== "swarmui" || asset.model !== job.profile || job.projectId !== input.projectId || (input.ownerId && job.ownerId !== input.ownerId)
      || job.state !== "ready" || job.id !== asset.jobId || job.result?.asset.id !== asset.id || !h3Path
      || h3Path[2] !== input.projectId || h3Path[3] !== job.id
      || h3Path[1] !== (job.ownerId.trim().replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 128) || "unknown-user").toLowerCase()
      || job.target.planSignature !== input.generationScope || identityPolicySha256(target) !== identityPolicySha256(job.target)
      || job.request.projectId !== input.projectId || job.request.planSignature !== input.generationScope
      || job.request.sectionId !== target.sectionId || (job.request.timelineItemId !== undefined && job.request.timelineItemId !== target.timelineItemId)
      || (job.request.requirementId !== undefined && job.request.requirementId !== target.requirementId)
      || !near(job.request.songStart, target.songStart) || !near(job.request.songEnd, target.songEnd)
      || !job.request.prompt.trim() || job.request.prompt.length > 6000) return undefined;
    let canonical = job.result.asset;
    if (asset.identityAssessmentId) {
      if (input.rangeAssessment) {
        if (input.rangeAssessment.scope.id !== asset.identityAssessmentId) return undefined;
        canonical = identityAssessmentAsset(input.rangeAssessment, job, asset.trimStart ?? 0);
      } else if (input.advisoryCachedRange === true && asset.identityVerification
        && identityPolicySha256(asset.generationReferenceHashes) === identityPolicySha256(canonical.generationReferenceHashes)
        && identityPolicySha256(asset.identityReferenceHashes) === identityPolicySha256(canonical.identityReferenceHashes)) {
        canonical = { ...canonical, identityVerification: asset.identityVerification, identityAssessmentId: asset.identityAssessmentId,
          identityAssessmentTrimStart: asset.identityAssessmentTrimStart };
      } else return undefined;
    }
    const canonicalMedia = storage(canonical);
    if (canonical.status !== "completed" || canonical.reviewStatus === "rejected" || !hash(canonical.mediaSha256)
      || asset.mediaSha256 !== canonical.mediaSha256 || media.bucket !== canonicalMedia.bucket || media.objectKey !== canonicalMedia.objectKey
      || !near(asset.durationSeconds!, canonical.durationSeconds ?? NaN)
      || identityPolicySha256(canonical.target) !== identityPolicySha256(job.target)
      || !job.referenceHashes || job.referenceHashes.length !== job.references.length
      || identityPolicySha256(canonical.generationReferenceHashes) !== identityPolicySha256(job.referenceHashes)
      || identityPolicySha256(canonical.identityReferenceHashes) !== identityPolicySha256(job.references.flatMap((reference, index) => reference.role === "identity" ? [job.referenceHashes![index]] : []))) return undefined;
    const authoritative = withCurrentReferenceIdentity([{ ...canonical, jobId: job.id, model: job.profile,
      target: job.target, trimStart: asset.trimStart ?? 0 }], input.currentIdentity)[0];
    if (generatedAssetDraftIdentityBlockReason(authoritative)
      || (asset.reviewStatus === "approved" && (asset.identityAssessmentId || job.request.identityPolicyFamily) && asset.approvedIdentityEvidenceSha256 !== currentIdentityEvidenceSha256(authoritative))
      || (asset.reviewStatus === "approved" && input.currentIdentity && asset.approvedCurrentReferenceEvidenceSha256 !== currentReferenceIdentityApprovalSha256(authoritative))) return undefined;
    return { evidence: { ...evidence, jobId: job.id, mediaSha256: canonical.mediaSha256,
      evidenceKind: "requested-direction", requestedDirection: job.request.prompt },
      canonicalBinding: { ...canonicalBinding, requestSha256: identityPolicySha256(job.request), mediaSha256: canonical.mediaSha256,
        ...(asset.identityAssessmentId ? { rangeAssessmentId: asset.identityAssessmentId } : {}),
        identityEvidenceSha256: currentIdentityEvidenceSha256(authoritative),
        ...(input.currentIdentity ? { currentReferenceEvidenceSha256: currentReferenceIdentityApprovalSha256(authoritative) } : {}) } };
  } catch { return undefined; }
}
