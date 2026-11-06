import type { GeneratedStudioAsset } from "./generatedAssets";

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
  samples: {
    timeSeconds: number;
    frameSha256: string;
    scores: { referenceHash: string; trackId: string; score: number }[];
  }[];
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

/** Malformed persisted evidence is discarded; it can never grant eligibility. */
export function normalizeGeneratedAssetIdentityVerification(value: unknown): GeneratedAssetIdentityVerification | undefined {
  if (!value || typeof value !== "object") return undefined;
  const proof = value as GeneratedAssetIdentityVerification;
  if (proof.version !== 1 || !["passed", "rejected", "unverifiable", "not_required"].includes(proof.status)
    || !boundedText(proof.assetId) || !boundedText(proof.jobId) || !boundedText(proof.generationModel)
    || !hash(proof.mediaSha256) || !hashes(proof.referenceHashes) || !hashes(proof.identityReferenceHashes)
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
    || !Array.isArray(proof.samples) || proof.samples.length > 512
    || (proof.reason !== undefined && (typeof proof.reason !== "string" || proof.reason.length > 2048))) return undefined;
  for (const sample of proof.samples) {
    if (!sample || !Number.isFinite(sample.timeSeconds) || sample.timeSeconds < 0 || sample.timeSeconds > 86_400
      || !hash(sample.frameSha256) || !Array.isArray(sample.scores) || sample.scores.length > 32
      || sample.scores.some(score => !score || !hash(score.referenceHash) || !boundedText(score.trackId)
        || !Number.isFinite(score.score) || score.score < -1 || score.score > 1)) return undefined;
  }
  return {
    version: 1, status: proof.status, assetId: proof.assetId, jobId: proof.jobId, generationModel: proof.generationModel,
    mediaSha256: proof.mediaSha256, referenceHashes: [...proof.referenceHashes], identityReferenceHashes: [...proof.identityReferenceHashes],
    durationSeconds: proof.durationSeconds, frameCount: proof.frameCount, frameRate: proof.frameRate, examinedFrameCount: proof.examinedFrameCount,
    verifiedStartFrame: proof.verifiedStartFrame, verifiedEndFrameExclusive: proof.verifiedEndFrameExclusive,
    unverifiableFrameCount: proof.unverifiableFrameCount, ambiguousFrameCount: proof.ambiguousFrameCount,
    assessedAt: proof.assessedAt, verifier: { ...proof.verifier }, threshold: proof.threshold, coverage: proof.coverage,
    samples: proof.samples.map(sample => ({ timeSeconds: sample.timeSeconds, frameSha256: sample.frameSha256,
      scores: sample.scores.map(score => ({ referenceHash: score.referenceHash, trackId: score.trackId, score: score.score })) })),
    reason: proof.reason,
  };
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
