import { currentReferenceIdentityBindingBlockReason } from "./currentReferenceIdentity";
import type { GeneratedStudioAsset } from "./generatedAssets";
import { resolveH3DraftSimilarityPolicy } from "./identityDraftPolicy";
import { copyForegroundFrameEvidence, foregroundEvidenceBlockReason, validForegroundFrameEvidence, type ForegroundFrameEvidence } from "./foregroundDraftEvidence";
import { getH3PolicyFamily, normalizeH3PublicIssuedDraftPolicy, type H3PublicIssuedDraftPolicy } from "./issuedIdentityPolicy";
import { H3_FIRST_FRAME_PROFILE, h3FirstFrameBinding, h3FirstFrameDigest, normalizeH3FirstFrameReceipt } from "./h3FirstFrame";

export type IdentityFrameSample = {
  timeSeconds: number;
  frameSha256: string;
  scores: { referenceHash: string; trackId: string; score: number }[];
  /** Joint policies retain all four candidates so assignment margins can be checked. */
  candidateScores?: { referenceHash: string; trackId: string; score: number }[];
  foreground?: ForegroundFrameEvidence;
};

/** Provisional model screen for a reviewed draft; never an identity certificate. */
export type GeneratedAssetDraftSimilarityFilter = {
  version: 1;
  policyId: string;
  policySha256: string;
  status: "eligible" | "ineligible" | "unverifiable";
  threshold: number;
  examinedFrameCount: number;
  eligibleFrameCount: number;
  outOfScopeFrameCount: number;
  ambiguousFrameCount: number;
  samples: IdentityFrameSample[];
  warnings: string[];
};

/** Worker evidence, not a user approval or a confidence percentage. */
export type GeneratedAssetIdentityVerification = {
  version: 1;
  status: "passed" | "rejected" | "unverifiable" | "not_required";
  assetId: string;
  jobId: string;
  generationModel: string;
  mediaSha256: string;
  durationSeconds: number;
  frameCount: number;
  frameRate: number;
  /** Every frame inside this half-open scope was examined; unused handles may remain outside it. */
  verifiedStartFrame: number;
  verifiedEndFrameExclusive: number;
  examinedFrameCount: number;
  unverifiableFrameCount: number;
  ambiguousFrameCount: number;
  referenceHashes: string[];
  identityReferenceHashes: string[];
  assessedAt: string;
  verifier: {
    method: "face-embedding-cosine";
    model: string;
    modelSha256: string;
    version: string;
    preprocessVersion: string;
    calibrationId: string;
  };
  threshold?: number;
  /** Missing faces or ambiguous identity-to-track assignment cannot pass. */
  coverage: "complete" | "incomplete" | "ambiguous" | "not_required";
  samples: IdentityFrameSample[];
  draftSimilarityFilter?: GeneratedAssetDraftSimilarityFilter;
  issuedPolicy?: H3PublicIssuedDraftPolicy;
  reason?: string;
};

const hashPattern = /^[a-f0-9]{64}$/;
const boundedText = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 512;
const hash = (value: unknown): value is string => typeof value === "string" && hashPattern.test(value);
const hashes = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 32
  && value.every(hash) && new Set(value).size === value.length;
const sameHashes = (left: unknown, right: unknown) => hashes(left) && hashes(right)
  && left.length === right.length && left.every((value, index) => value === right[index]);
const frameCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 10_000_000;

function validSamples(value: unknown): value is IdentityFrameSample[] {
  return Array.isArray(value) && value.length <= 512 && value.every(sample => sample
    && Number.isFinite(sample.timeSeconds) && sample.timeSeconds >= 0 && sample.timeSeconds <= 86_400
    && hash(sample.frameSha256) && Array.isArray(sample.scores) && sample.scores.length <= 32
    && (sample.candidateScores === undefined || (Array.isArray(sample.candidateScores) && sample.candidateScores.length <= 32))
    && (sample.foreground === undefined || validForegroundFrameEvidence(sample.foreground))
    && [...sample.scores, ...(sample.candidateScores ?? [])].every((score: IdentityFrameSample["scores"][number]) => score && hash(score.referenceHash) && boundedText(score.trackId)
      && Number.isFinite(score.score) && score.score >= -1 && score.score <= 1));
}

function copySamples(samples: IdentityFrameSample[]): IdentityFrameSample[] {
  return samples.map(sample => ({ timeSeconds: sample.timeSeconds, frameSha256: sample.frameSha256,
    scores: sample.scores.map(score => ({ referenceHash: score.referenceHash, trackId: score.trackId, score: score.score })),
    ...(sample.foreground === undefined ? {} : { foreground: copyForegroundFrameEvidence(sample.foreground) }),
    ...(sample.candidateScores === undefined ? {} : { candidateScores: sample.candidateScores.map(score => ({ referenceHash: score.referenceHash, trackId: score.trackId, score: score.score })) }) }));
}

export function normalizeGeneratedAssetDraftSimilarityFilter(value: unknown): GeneratedAssetDraftSimilarityFilter | undefined {
  if (!value || typeof value !== "object") return undefined;
  const filter = value as GeneratedAssetDraftSimilarityFilter;
  if (filter.version !== 1 || !boundedText(filter.policyId) || !hash(filter.policySha256)
    || !["eligible", "ineligible", "unverifiable"].includes(filter.status)
    || !Number.isFinite(filter.threshold) || filter.threshold <= 0 || filter.threshold > 1
    || ![filter.examinedFrameCount, filter.eligibleFrameCount, filter.outOfScopeFrameCount, filter.ambiguousFrameCount].every(frameCount)
    || filter.examinedFrameCount > 512 || filter.eligibleFrameCount > filter.examinedFrameCount
    || filter.outOfScopeFrameCount > filter.examinedFrameCount || filter.ambiguousFrameCount > filter.examinedFrameCount
    || !validSamples(filter.samples) || !Array.isArray(filter.warnings) || filter.warnings.length > 32
    || !filter.warnings.every(boundedText)) return undefined;
  return { version: 1, policyId: filter.policyId, policySha256: filter.policySha256, status: filter.status,
    threshold: filter.threshold, examinedFrameCount: filter.examinedFrameCount, eligibleFrameCount: filter.eligibleFrameCount,
    outOfScopeFrameCount: filter.outOfScopeFrameCount, ambiguousFrameCount: filter.ambiguousFrameCount,
    samples: copySamples(filter.samples), warnings: [...filter.warnings] };
}

/** Provenance-neutral shape normalization shared by historical and current-purpose reports. */
export function normalizeIdentityFrameEvidence(value:unknown):Omit<GeneratedAssetIdentityVerification,"referenceHashes"|"identityReferenceHashes"|"issuedPolicy">|undefined {
  if(!value||typeof value!=="object")return undefined;
  const proof=value as GeneratedAssetIdentityVerification;
  if (proof.version !== 1 || !["passed", "rejected", "unverifiable", "not_required"].includes(proof.status)
    || !boundedText(proof.assetId) || !boundedText(proof.jobId) || !boundedText(proof.generationModel)
    || !hash(proof.mediaSha256)
    || !Number.isFinite(proof.durationSeconds) || proof.durationSeconds <= 0 || proof.durationSeconds > 86_400
    || !Number.isFinite(proof.frameRate) || proof.frameRate <= 0 || proof.frameRate > 240
    || ![proof.frameCount, proof.verifiedStartFrame, proof.verifiedEndFrameExclusive, proof.examinedFrameCount, proof.unverifiableFrameCount, proof.ambiguousFrameCount].every(frameCount)
    || proof.frameCount === 0 || proof.examinedFrameCount > proof.frameCount
    || proof.verifiedEndFrameExclusive <= proof.verifiedStartFrame || proof.verifiedEndFrameExclusive > proof.frameCount
    || proof.unverifiableFrameCount > proof.frameCount || proof.ambiguousFrameCount > proof.frameCount
    || !boundedText(proof.assessedAt) || !Number.isFinite(Date.parse(proof.assessedAt))
    || !proof.verifier || proof.verifier.method !== "face-embedding-cosine"
    || ![proof.verifier.model, proof.verifier.version, proof.verifier.preprocessVersion, proof.verifier.calibrationId].every(boundedText)
    || !hash(proof.verifier.modelSha256)
    || !["complete", "incomplete", "ambiguous", "not_required"].includes(proof.coverage)
    || (proof.threshold !== undefined && (!Number.isFinite(proof.threshold) || proof.threshold <= 0 || proof.threshold > 1))
    || !validSamples(proof.samples)
    || (proof.reason !== undefined && (typeof proof.reason !== "string" || proof.reason.length > 2048))) return undefined;
  const draftSimilarityFilter=proof.draftSimilarityFilter===undefined?undefined:normalizeGeneratedAssetDraftSimilarityFilter(proof.draftSimilarityFilter);
  if(proof.draftSimilarityFilter!==undefined&&!draftSimilarityFilter)return undefined;
  return {version:1,status:proof.status,assetId:proof.assetId,jobId:proof.jobId,generationModel:proof.generationModel,mediaSha256:proof.mediaSha256,
    durationSeconds:proof.durationSeconds,frameCount:proof.frameCount,frameRate:proof.frameRate,examinedFrameCount:proof.examinedFrameCount,
    verifiedStartFrame:proof.verifiedStartFrame,verifiedEndFrameExclusive:proof.verifiedEndFrameExclusive,unverifiableFrameCount:proof.unverifiableFrameCount,
    ambiguousFrameCount:proof.ambiguousFrameCount,assessedAt:proof.assessedAt,verifier:{method:proof.verifier.method,model:proof.verifier.model,modelSha256:proof.verifier.modelSha256,
      version:proof.verifier.version,preprocessVersion:proof.verifier.preprocessVersion,calibrationId:proof.verifier.calibrationId},threshold:proof.threshold,coverage:proof.coverage,
    samples:copySamples(proof.samples),...(draftSimilarityFilter?{draftSimilarityFilter}:{}),reason:proof.reason};
}
/** Malformed persisted evidence is discarded; historical reference fields keep their original meaning and order. */
export function normalizeGeneratedAssetIdentityVerification(value: unknown): GeneratedAssetIdentityVerification | undefined {
  if(!value||typeof value!=="object")return undefined;
  const proof=value as GeneratedAssetIdentityVerification,common=normalizeIdentityFrameEvidence(value);
  const issuedPolicy=proof.issuedPolicy===undefined?undefined:normalizeH3PublicIssuedDraftPolicy(proof.issuedPolicy);
  if(!common||!hashes(proof.referenceHashes)||!hashes(proof.identityReferenceHashes)||(proof.issuedPolicy!==undefined&&!issuedPolicy))return undefined;
  return {version:1,status:common.status,assetId:common.assetId,jobId:common.jobId,generationModel:common.generationModel,
    mediaSha256:common.mediaSha256,referenceHashes:[...proof.referenceHashes],identityReferenceHashes:[...proof.identityReferenceHashes],
    durationSeconds:common.durationSeconds,frameCount:common.frameCount,frameRate:common.frameRate,examinedFrameCount:common.examinedFrameCount,
    verifiedStartFrame:common.verifiedStartFrame,verifiedEndFrameExclusive:common.verifiedEndFrameExclusive,unverifiableFrameCount:common.unverifiableFrameCount,
    ambiguousFrameCount:common.ambiguousFrameCount,assessedAt:common.assessedAt,verifier:common.verifier,threshold:common.threshold,coverage:common.coverage,
    samples:common.samples,...(common.draftSimilarityFilter?{draftSimilarityFilter:common.draftSimilarityFilter}:{}),...(issuedPolicy?{issuedPolicy}:{}),reason:common.reason};
}

/** The shared UI/draft/export gate. Legacy providers retain their existing review flow. */
export function generatedAssetIdentityBlockReason(asset: GeneratedStudioAsset): string | null {
  if (asset.reviewStatus === "rejected" || asset.identityVerification?.status === "rejected") return "Rejected";
  const requiresProof = asset.model === "h3-ref2va-int8-v1" || (asset.provider === "swarmui" && asset.jobId?.startsWith("h3-"));
  if (!requiresProof) return null;
  if (!asset.identityVerification) return "Needs identity check";
  if (asset.identityVerification.status === "unverifiable") return "Identity could not be verified";
  const proof = normalizeGeneratedAssetIdentityVerification(asset.identityVerification);
  if (!proof || proof.assetId !== asset.id || proof.jobId !== asset.jobId || proof.generationModel !== asset.model
    || !hash(asset.mediaSha256) || proof.mediaSha256 !== asset.mediaSha256
    || !frameCount(asset.mediaFrameCount) || proof.frameCount !== asset.mediaFrameCount || proof.frameRate !== asset.mediaFrameRate
    || proof.durationSeconds !== asset.durationSeconds
    || !sameHashes(proof.referenceHashes, asset.generationReferenceHashes)
    || !sameHashes(proof.identityReferenceHashes, asset.identityReferenceHashes)
    || !proof.identityReferenceHashes.every(reference => proof.referenceHashes.includes(reference))) return "Identity check does not match this clip";
  if (proof.status === "not_required") {
    return proof.identityReferenceHashes.length === 0 && proof.coverage === "not_required" && proof.samples.length === 0
      ? null : "Identity check is required for these references";
  }
  if (proof.status !== "passed" || !proof.identityReferenceHashes.length || proof.coverage !== "complete"
    || proof.examinedFrameCount !== proof.verifiedEndFrameExclusive - proof.verifiedStartFrame
    || proof.unverifiableFrameCount !== 0 || proof.ambiguousFrameCount !== 0
    || proof.threshold === undefined || !Number.isFinite(asset.durationSeconds) || (asset.durationSeconds ?? 0) <= 0) return "Identity check is incomplete";
  const fps = asset.mediaFrameRate;
  const trimStart = asset.trimStart ?? 0;
  const targetDuration = asset.target ? asset.target.songEnd - asset.target.songStart : asset.durationSeconds!;
  if (!Number.isFinite(fps) || fps! <= 0 || fps! > 240 || !Number.isFinite(trimStart) || trimStart < 0
    || !Number.isFinite(targetDuration) || targetDuration <= 0 || trimStart >= asset.durationSeconds!) return "Identity check is incomplete";
  // Playback clamps through resolveGeneratedAssetTrimWindow (including its 50 ms
  // minimum). Never verify a raw trim that playback would silently move earlier.
  const maxTrimStart = Math.max(0, asset.durationSeconds! - Math.max(0.05, targetDuration));
  if (trimStart > maxTrimStart) return "Identity check does not cover this trim";
  const firstFrame = Math.floor(trimStart * fps! + 1e-6);
  const endFrame = Math.min(proof.frameCount, Math.ceil(Math.min(asset.durationSeconds!, trimStart + targetDuration) * fps! - 1e-6));
  if (firstFrame < proof.verifiedStartFrame || endFrame > proof.verifiedEndFrameExclusive) return "Identity check does not cover this trim";
  if (proof.samples.some(sample => sample.timeSeconds * fps! < proof.verifiedStartFrame
    || sample.timeSeconds * fps! >= proof.verifiedEndFrameExclusive || sample.timeSeconds >= asset.durationSeconds!
    || sample.scores.some(score => !proof.identityReferenceHashes.includes(score.referenceHash) || score.score < proof.threshold!))) return "Identity check did not pass";
  for (const reference of proof.identityReferenceHashes) {
    const samples = proof.samples.filter(sample => sample.scores.some(score => score.referenceHash === reference));
    if (new Set(samples.map(sample => sample.timeSeconds)).size < 3 || new Set(samples.map(sample => sample.frameSha256)).size < 3) return "Identity check has insufficient samples";
  }
  return null;
}

/** Draft-only model eligibility; explicit whole-draft approval remains separate. */
function originalGeneratedAssetDraftIdentityBlockReason(asset: GeneratedStudioAsset): string | null {
  if(asset.model===H3_FIRST_FRAME_PROFILE){
    const receipt=normalizeH3FirstFrameReceipt(asset.firstFrame),policy=asset.identityVerification?.issuedPolicy;
    if(!receipt||receipt.assessment.status!=="eligible"||!policy||h3FirstFrameDigest(policy.body.firstFrame??null)!==h3FirstFrameDigest(h3FirstFrameBinding(receipt.artifact))
      ||receipt.assessment.familyId!==policy.familyId||!sameHashes(receipt.assessment.spatialEvidence.assignments.map(a=>a.referenceHash),policy.body.identityReferenceHashes)
      ||receipt.assessment.policyId!==policy.id||receipt.assessment.policySha256!==policy.sha256||receipt.assessment.galleryProfileSha256!==policy.body.galleryProfileSha256
      ||receipt.assessment.modelSha256!==getH3PolicyFamily(policy.familyId)?.model.recognitionSha256
      ||receipt.artifact.body.ownerId!==policy.body.ownerId||receipt.artifact.body.projectId!==policy.body.projectId
      ||receipt.artifact.body.planSignature!==asset.target?.planSignature||receipt.artifact.body.target.timelineItemId!==asset.target?.timelineItemId
      ||receipt.artifact.body.target.songStart!==asset.target?.songStart||receipt.artifact.body.target.songEnd!==asset.target?.songEnd
      ||h3FirstFrameDigest(receipt.artifact.body.references)!==h3FirstFrameDigest(policy.body.references.map(ref=>{const {rawSha256,...snapshot}=ref;void rawSha256;return snapshot;})))return "First-frame evidence is missing or does not match this take";
  }
  if (asset.identityAssessmentId && !/^h3-assessment-[a-f0-9]{64}$/.test(asset.identityAssessmentId)) return "Invalid range assessment";
  if (asset.identityAssessmentId && (!Number.isFinite(asset.identityAssessmentTrimStart) || asset.identityAssessmentTrimStart !== (asset.trimStart ?? 0))) return "Similarity filter does not cover this trim";
  const strictBlock = generatedAssetIdentityBlockReason(asset);
  if ((strictBlock === null && !asset.identityVerification?.issuedPolicy) || strictBlock === "Rejected") return strictBlock;
  const proof = normalizeGeneratedAssetIdentityVerification(asset.identityVerification);
  const filter = proof?.draftSimilarityFilter;
  if (!proof || proof.status !== "unverifiable" || !filter) return strictBlock ?? "Issued similarity evidence is incomplete";
  const issued = proof.issuedPolicy, family = issued ? getH3PolicyFamily(issued.familyId) : undefined;
  const fixed = resolveH3DraftSimilarityPolicy(filter.policyId, filter.policySha256);
  if (issued && (!family || filter.policyId !== issued.id || filter.policySha256 !== issued.sha256
    || !sameHashes(issued.body.references.map(ref => ref.rawSha256), proof.referenceHashes)
    || !sameHashes(issued.body.identityReferenceHashes, proof.identityReferenceHashes))) return "Issued similarity policy does not match this clip";
  if (!issued && !fixed) return "Unknown similarity filter policy";
  const policy = issued && family ? { projectId: issued.body.projectId, generationModel: issued.body.generationModel,
    threshold: family.threshold, minimumFrameCount: family.frontalGeometry.minimumIntendedFrameCount,
    verifierModel: family.model.model, modelSha256: family.model.recognitionSha256, verifierVersion: family.model.verifierVersion } : fixed!;
  const requiredHashes: readonly string[] = issued ? issued.body.identityReferenceHashes
    : "identityReferenceSha256s" in fixed! ? fixed!.identityReferenceSha256s : [fixed!.identityReferenceSha256];
  const jointBinding = fixed && "galleryBindings" in fixed ? fixed.galleryBindings.find(binding => sameHashes(binding.identityReferenceHashes, proof.identityReferenceHashes)) : undefined;
  const preprocessVersion = issued ? issued.body.preprocessVersion : fixed && "galleryBindings" in fixed
    ? jointBinding && `opencv412-aligncrop112-rgb-f32-nchw-unit-centroid-v1-gallery-v2-${jointBinding.gallerySha256}` : fixed?.preprocessVersion;
  const foregroundRules = family?.scope.kind === "dominant-foreground" ? { geometry: family.frontalGeometry, dominance: family.scope }
    : !issued && fixed && "foregroundDominance" in fixed ? { geometry: fixed.foregroundGeometry, dominance: fixed.foregroundDominance } : undefined;
  const jointMargin = family?.scope.kind === "joint-frontal" ? family.scope.minimumAssignmentCosineMargin
    : !issued && fixed && "minimumAssignmentCosineMargin" in fixed ? fixed.minimumAssignmentCosineMargin : undefined;
  if (proof.assetId !== asset.id || proof.jobId !== asset.jobId || proof.generationModel !== asset.model
    || asset.model !== policy.generationModel || asset.provider !== "swarmui"
    || !hash(asset.mediaSha256) || proof.mediaSha256 !== asset.mediaSha256
    || proof.frameCount !== asset.mediaFrameCount || proof.frameRate !== asset.mediaFrameRate || proof.durationSeconds !== asset.durationSeconds
    || !sameHashes(proof.referenceHashes, asset.generationReferenceHashes) || !sameHashes(proof.identityReferenceHashes, asset.identityReferenceHashes)
    || proof.identityReferenceHashes.length !== requiredHashes.length || !requiredHashes.every(hash => proof.identityReferenceHashes.includes(hash))
    || !requiredHashes.every(hash => proof.referenceHashes.includes(hash))
    || proof.verifier.model !== policy.verifierModel || proof.verifier.modelSha256 !== policy.modelSha256
    || proof.verifier.version !== policy.verifierVersion || proof.verifier.preprocessVersion !== preprocessVersion) return "Similarity filter does not match this clip";
  // This helper is not an authorization boundary. Server export reconciliation
  // additionally binds the current owned project and canonical stored H3 job.
  const parts = typeof asset.fullStorage?.objectKey === "string" ? asset.fullStorage.objectKey.split("/") : undefined;
  if (!parts || parts.length !== 7 || parts[0] !== "media-uploads" || parts[1] !== "projects"
    || !/^[a-zA-Z0-9_-]+$/.test(parts[2]) || (issued && parts[2] !== issued.body.ownerId) || parts[3] !== "generated" || parts[4] !== policy.projectId
    || parts[5] !== asset.jobId || parts[6] !== "shot.mp4"
    || !/^h3-[a-f0-9]{64}$/.test(asset.jobId ?? "")) return "Similarity filter is outside its project scope";
  return framedDraftSimilarityEvidenceBlockReason(asset, proof, filter, requiredHashes, policy, foregroundRules, jointMargin);
}

export function framedDraftSimilarityEvidenceBlockReason(asset: GeneratedStudioAsset, proof: Pick<GeneratedAssetIdentityVerification, "verifiedStartFrame" | "verifiedEndFrameExclusive" | "frameRate" | "frameCount" | "durationSeconds" | "ambiguousFrameCount" | "examinedFrameCount" | "samples">, filter: GeneratedAssetDraftSimilarityFilter, requiredHashes: readonly string[], policy: { threshold: number; minimumFrameCount: number }, foregroundRules?: {geometry: Parameters<typeof foregroundEvidenceBlockReason>[0]["geometry"]; dominance: Parameters<typeof foregroundEvidenceBlockReason>[0]["dominance"]}, jointMargin?: number): string | null {
  if (filter.status !== "eligible") return filter.status === "ineligible" ? "Similarity filter did not pass" : "Similarity filter could not be assessed";
  const count = proof.verifiedEndFrameExclusive - proof.verifiedStartFrame;
  if (filter.threshold !== policy.threshold || count < policy.minimumFrameCount
    || filter.examinedFrameCount !== count || filter.eligibleFrameCount !== count
    || filter.outOfScopeFrameCount !== 0 || filter.ambiguousFrameCount !== 0 || proof.ambiguousFrameCount !== 0
    || proof.examinedFrameCount !== count || filter.samples.length !== count || proof.samples.length !== count) return "Similarity filter is incomplete";
  const trimStart = asset.trimStart ?? 0, fps = proof.frameRate;
  const targetDuration = asset.target ? asset.target.songEnd - asset.target.songStart : NaN;
  if (!Number.isFinite(trimStart) || trimStart < 0 || !Number.isFinite(targetDuration) || targetDuration <= 0
    || trimStart + targetDuration > proof.durationSeconds + 1e-6
    || trimStart > Math.max(0, proof.durationSeconds - Math.max(0.05, targetDuration))
    || Math.floor(trimStart * fps + 1e-6) !== proof.verifiedStartFrame
    || Math.min(proof.frameCount, Math.ceil((trimStart + targetDuration) * fps - 1e-6)) !== proof.verifiedEndFrameExclusive) return "Similarity filter does not cover this trim";
  const tracks = new Map<string, string>();
  for (const [index, sample] of filter.samples.entries()) {
    const parentSample = proof.samples[index], expectedFrame = proof.verifiedStartFrame + index;
    if (Math.abs(sample.timeSeconds * fps - expectedFrame) > 1e-5 || sample.timeSeconds >= proof.durationSeconds
      || parentSample.timeSeconds !== sample.timeSeconds || parentSample.frameSha256 !== sample.frameSha256
      || sample.scores.length !== requiredHashes.length
      || !requiredHashes.every(hash => sample.scores.filter(score => score.referenceHash === hash).length === 1)
      || sample.scores.some(score => score.score < policy.threshold)) return "Similarity filter has incomplete frame evidence";
    if (new Set(sample.scores.map(score => score.trackId)).size !== requiredHashes.length) return "Similarity filter has ambiguous tracking";
    for (const score of sample.scores) {
      if (tracks.has(score.referenceHash) && tracks.get(score.referenceHash) !== score.trackId) return "Similarity filter has ambiguous tracking";
      tracks.set(score.referenceHash, score.trackId);
    }
    if (foregroundRules) {
      const block = foregroundEvidenceBlockReason({ evidence: sample.foreground, previous: filter.samples[index - 1]?.foreground,
        assigned: sample.scores[0], candidates: sample.candidateScores, geometry: foregroundRules.geometry, dominance: foregroundRules.dominance });
      if (block) return block;
    }
    if (jointMargin !== undefined) {
      const candidates = sample.candidateScores;
      if (!candidates || candidates.length !== 4 || candidates.some(score => !requiredHashes.includes(score.referenceHash)
        || !sample.scores.some(assigned => assigned.trackId === score.trackId))) return "Similarity filter has incomplete assignment evidence";
      for (const assigned of sample.scores) {
        const own = candidates.filter(score => score.referenceHash === assigned.referenceHash && score.trackId === assigned.trackId);
        const otherFace = candidates.filter(score => score.referenceHash === assigned.referenceHash && score.trackId !== assigned.trackId);
        const otherIdentity = candidates.filter(score => score.referenceHash !== assigned.referenceHash && score.trackId === assigned.trackId);
        if (own.length !== 1 || otherFace.length !== 1 || otherIdentity.length !== 1 || own[0].score !== assigned.score
          || assigned.score - otherFace[0].score < jointMargin
          || assigned.score - otherIdentity[0].score < jointMargin) return "Similarity filter has ambiguous assignment";
      }
    }
  }
  return null;
}


/** Historical eligibility is necessary; a migrated project additionally requires its independent current-reference screen. */
export function generatedAssetDraftIdentityBlockReason(asset: GeneratedStudioAsset): string | null {
  const original=originalGeneratedAssetDraftIdentityBlockReason(asset);
  if(original)return original;
  const binding=currentReferenceIdentityBindingBlockReason(asset);
  if(binding)return binding;
  if(!asset.currentReferenceIdentity?.required)return null;
  const proof=asset.currentReferenceIdentity.assessment;
  if(!proof||proof.status!=="ready"||!proof.proof.draftSimilarityFilter)return "Current-reference screen is incomplete";
  const evidence=proof.proof, policy=evidence.evaluationPolicy.body, family=getH3PolicyFamily(policy.familyId);
  if(!family||evidence.status!=="unverifiable"||evidence.verifier.modelSha256!==family.model.recognitionSha256
    ||evidence.generationModel!==asset.model||evidence.verifier.model!==family.model.model||evidence.verifier.method!==family.model.method
    ||evidence.verifier.version!==family.model.verifierVersion||evidence.verifier.preprocessVersion!==policy.preprocessVersion
    ||evidence.draftSimilarityFilter!.policyId!==proof.scope.policyId||evidence.draftSimilarityFilter!.policySha256!==proof.scope.policySha256)
    return "Current-reference model or policy changed";
  const foreground=policy.originalPolicy.kind!=="legacy"&&family.scope.kind==="dominant-foreground"?{geometry:family.frontalGeometry,dominance:family.scope}:undefined;
  return framedDraftSimilarityEvidenceBlockReason(asset,evidence,evidence.draftSimilarityFilter!,policy.identityReferenceHashes,
    {threshold:family.threshold,minimumFrameCount:family.frontalGeometry.minimumIntendedFrameCount},foreground,
    policy.originalPolicy.kind!=="legacy"&&family.scope.kind==="joint-frontal"?family.scope.minimumAssignmentCosineMargin:undefined);
}

export function generatedAssetDraftSimilarityLabel(asset: GeneratedStudioAsset): string | null {
  return asset.identityVerification?.status === "unverifiable" && asset.identityVerification.draftSimilarityFilter?.status === "eligible"
    && generatedAssetDraftIdentityBlockReason(asset) === null ? "Similarity filter passed · review required" : null;
}

export function generatedAssetDraftSimilarityWarnings(asset: GeneratedStudioAsset): string[] {
  return normalizeGeneratedAssetIdentityVerification(asset.identityVerification)?.draftSimilarityFilter?.warnings ?? [];
}
