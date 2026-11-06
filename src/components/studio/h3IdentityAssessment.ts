import type { H3GenerationJob } from "./h3Generation";
import type { GeneratedStudioAsset } from "./generatedAssets";
import { normalizeGeneratedAssetIdentityVerification } from "./generatedAssetIdentity";
import { resolveH3DraftSimilarityPolicy } from "./identityDraftPolicy";
import { canonicalIdentityPolicyJson, currentIdentityEvidenceSha256, identityPolicySha256 } from "./issuedIdentityPolicy";

export type H3IdentityAssessmentScope = {
  version: 1; id: string; requestIntentId: string; ownerId: string; projectId: string; jobId: string;
  assetId: string; mediaSha256: string; frameCount: number; frameRate: number; durationSeconds: number;
  generationModel: string; referenceHashes: string[]; identityReferenceHashes: string[];
  trimStart: number; trimDuration: number; firstFrame: number; endFrameExclusive: number;
  policyId: string; policySha256: string; parentProofSha256: string; targetSha256: string;
};
export type H3IdentityAssessment = { version: 1; scope: H3IdentityAssessmentScope; assessedAt: string } & (
  { status: "ready"; proofSha256: string; proof: NonNullable<GeneratedStudioAsset["identityVerification"]> }
  | { status: "failed"; error: string }
);
export const isH3IdentityAssessmentId = (id: unknown): id is string => typeof id === "string" && /^h3-assessment-[a-f0-9]{64}$/.test(id);

export function canDeliverH3IdentityAssessment(input: { fingerprint: string; currentAsset?: GeneratedStudioAsset;
  requestedRevision?: number; currentRevision?: number; requestedStartFrame?: number; currentStartFrame?: number }) {
  return Boolean(input.currentAsset && input.currentAsset.reviewStatus !== "rejected" && input.currentAsset.identityVerification?.status !== "rejected"
    && input.requestedRevision === input.currentRevision && input.requestedStartFrame === input.currentStartFrame
    && currentIdentityEvidenceSha256(input.currentAsset) === input.fingerprint);
}

export function h3IdentityAssessmentTrimWindow(asset: GeneratedStudioAsset, startFrame?: number) {
  const fps = asset.mediaFrameRate, duration = asset.durationSeconds;
  const targetDuration = asset.target ? asset.target.songEnd-asset.target.songStart : NaN;
  if (fps !== 24 || !Number.isFinite(duration) || !duration || !Number.isFinite(targetDuration) || targetDuration <= 0 || targetDuration > duration) throw new Error("Native trim metadata is incomplete.");
  const maxStartFrame = Math.floor(Math.max(0,duration-Math.max(.05,targetDuration))*fps+1e-6);
  if (startFrame !== undefined && (!Number.isSafeInteger(startFrame) || startFrame < 0 || startFrame > maxStartFrame)) throw new Error("Choose a native start frame within this shot.");
  const trimStart = startFrame === undefined ? asset.trimStart ?? 0 : startFrame/fps;
  if (!Number.isFinite(trimStart) || trimStart < 0 || trimStart+targetDuration > duration+1e-6) throw new Error("The saved trim is outside this shot.");
  return { fps,targetDuration,maxStartFrame,trimStart,trimEnd:trimStart+targetDuration,
    firstFrame:Math.floor(trimStart*fps+1e-6),endFrameExclusive:Math.min(asset.mediaFrameCount ?? Infinity,Math.ceil((trimStart+targetDuration)*fps-1e-6)) };
}

/** Canonical job bytes/refs/policy and exact playback interval are the assessment authority. */
export function buildH3IdentityAssessmentScope(job: H3GenerationJob, trimStart: number, requestIntentId: string): H3IdentityAssessmentScope {
  const asset = job.result?.asset, proof = normalizeGeneratedAssetIdentityVerification(asset?.identityVerification);
  if (job.state !== "ready" || !asset || asset.reviewStatus === "rejected" || proof?.status === "rejected") throw new Error("Only an unrejected ready take can be assessed.");
  const duration = asset.durationSeconds, fps = asset.mediaFrameRate, frames = asset.mediaFrameCount;
  const trimDuration = job.target.songEnd - job.target.songStart;
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(requestIntentId)
    || !asset.mediaSha256 || !/^[a-f0-9]{64}$/.test(asset.mediaSha256) || !proof
    || !Number.isFinite(duration) || !duration || !Number.isFinite(fps) || !fps || fps !== 24 || !Number.isSafeInteger(frames) || !frames || frames !== job.frames || !Number.isFinite(trimStart) || trimStart < 0
    || !Number.isFinite(trimDuration) || trimDuration <= 0 || trimStart > Math.max(0, duration - Math.max(0.05,trimDuration))
    || trimStart + trimDuration > duration + 1e-6 || !job.referenceHashes?.length
    || job.referenceHashes.length !== job.references.length
    || asset.fullStorage?.objectKey !== `media-uploads/projects/${job.ownerId}/generated/${job.projectId}/${job.id}/shot.mp4`
    || proof.mediaSha256 !== asset.mediaSha256 || proof.frameCount !== frames || proof.frameRate !== fps || proof.durationSeconds !== duration
    || canonicalIdentityPolicyJson(asset.generationReferenceHashes) !== canonicalIdentityPolicyJson(job.referenceHashes)) throw new Error("The selected trim has no complete canonical media binding.");
  const identities = job.references.flatMap((reference,index) => reference.role === "identity" ? [job.referenceHashes![index]] : []);
  const policy = job.identityPolicy ?? (proof.draftSimilarityFilter && resolveH3DraftSimilarityPolicy(proof.draftSimilarityFilter.policyId, proof.draftSimilarityFilter.policySha256));
  if (!identities.length || !policy || canonicalIdentityPolicyJson(asset.identityReferenceHashes) !== canonicalIdentityPolicyJson(identities)) throw new Error("The take has no unchanged pinned similarity policy.");
  const body = { version: 1 as const, requestIntentId, ownerId: job.ownerId, projectId: job.projectId, jobId: job.id, assetId: asset.id,
    mediaSha256: asset.mediaSha256, frameCount: frames, frameRate: fps, durationSeconds: duration, generationModel: job.profile,
    referenceHashes: [...job.referenceHashes], identityReferenceHashes: identities, trimStart, trimDuration,
    firstFrame: Math.floor(trimStart * fps + 1e-6), endFrameExclusive: Math.min(frames,Math.ceil((trimStart + trimDuration)*fps - 1e-6)),
    policyId: policy.id, policySha256: policy.sha256, parentProofSha256: identityPolicySha256(proof), targetSha256: identityPolicySha256(job.target) };
  if (body.firstFrame < 0 || body.endFrameExclusive > frames || body.endFrameExclusive <= body.firstFrame) throw new Error("The selected frame range is invalid.");
  return { ...body, id: `h3-assessment-${identityPolicySha256(body)}` };
}

export function assertH3IdentityAssessmentScope(scope: H3IdentityAssessmentScope, job: H3GenerationJob, trimStart = scope.trimStart) {
  const current = buildH3IdentityAssessmentScope(job,trimStart,scope.requestIntentId);
  if (canonicalIdentityPolicyJson(scope) !== canonicalIdentityPolicyJson(current)) throw new Error("The assessment does not match this owned job, policy and exact trim.");
}

export function identityAssessmentAsset(assessment: H3IdentityAssessment, job: H3GenerationJob, trimStart = assessment.scope.trimStart): GeneratedStudioAsset {
  assertH3IdentityAssessmentScope(assessment.scope,job,trimStart);
  if (assessment.version !== 1 || assessment.status !== "ready") throw new Error("The selected range assessment is not ready.");
  const proof = normalizeGeneratedAssetIdentityVerification(assessment.proof), scope = assessment.scope;
  if (!proof || identityPolicySha256(proof) !== assessment.proofSha256 || proof.assetId !== scope.assetId || proof.jobId !== scope.jobId
    || proof.generationModel !== scope.generationModel || proof.mediaSha256 !== scope.mediaSha256 || proof.frameCount !== scope.frameCount
    || proof.frameRate !== scope.frameRate || proof.durationSeconds !== scope.durationSeconds
    || proof.verifiedStartFrame !== scope.firstFrame || proof.verifiedEndFrameExclusive !== scope.endFrameExclusive
    || proof.status !== "unverifiable" || proof.draftSimilarityFilter?.policyId !== scope.policyId || proof.draftSimilarityFilter.policySha256 !== scope.policySha256
    || canonicalIdentityPolicyJson(proof.referenceHashes) !== canonicalIdentityPolicyJson(scope.referenceHashes)
    || canonicalIdentityPolicyJson(proof.identityReferenceHashes) !== canonicalIdentityPolicyJson(scope.identityReferenceHashes)
    || canonicalIdentityPolicyJson(proof.verifier) !== canonicalIdentityPolicyJson(job.result!.asset.identityVerification?.verifier)) throw new Error("The range assessment proof does not match its canonical binding.");
  return { ...job.result!.asset, trimStart, identityVerification: proof, identityAssessmentId: scope.id, identityAssessmentTrimStart: scope.trimStart,
    reviewStatus: "pending", approvedAt: undefined, approvedIdentityEvidenceSha256: undefined };
}
