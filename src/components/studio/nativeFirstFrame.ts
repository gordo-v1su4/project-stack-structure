import type { GeneratedStudioAsset } from "./generatedAssets";
import { generatedAssetDraftIdentityBlockReason } from "./generatedAssetIdentity";
import { identityPolicySha256 } from "./issuedIdentityPolicy";
import { h3FirstFrameDigest, type H3FirstFrameArtifact } from "./h3FirstFrame";

export type NativeFirstFrameSelection = {
  version: 1; assetId: string; jobId: string; mediaSha256: string; frameIndex: number; frameRate: 24;
  trimStart: number; firstFrame: number; endFrameExclusive: number; originalProofSha256: string;
  identityAssessmentId?: string; frameSha256: string;
  current?: { migrationSha256: string; contextSha256: string; assessmentId: string; proofSha256: string };
};
export type NativeFirstFrameReceipt = {
  version: 1; id: string; sha256: string;
  body: { version: 1; purpose: "verified-native-frame-source-v1"; ownerId: string; projectId: string;
    source: NativeFirstFrameSelection; artifactId: string; descriptorSha256: string; pngSha256: string;
    targetJobId: string; requestSha256: string; baselineSha256: string; projectRevision: string };
};
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
function frameHash(samples: readonly { timeSeconds: number; frameSha256: string }[], index: number) {
  const matches = samples.filter(sample => Math.abs(sample.timeSeconds - index / 24) < 1e-8);
  if (matches.length !== 1 || !hash(matches[0].frameSha256)) throw new Error("The exact native frame has no canonical pixel proof.");
  return matches[0].frameSha256;
}

/** Frozen source evidence only; choosing a frame never changes the take's trim or selection. */
export function nativeFirstFrameSelection(asset: GeneratedStudioAsset, frameIndex: number): NativeFirstFrameSelection {
  const block = generatedAssetDraftIdentityBlockReason(asset);
  if (block) throw new Error(block);
  if (!asset.target) throw new Error("The earlier take has no canonical target.");
  const proof = asset.identityVerification, trimStart = asset.trimStart ?? 0;
  const firstFrame = Math.floor(trimStart * 24 + 1e-6);
  const endFrameExclusive = Math.ceil((trimStart + asset.target!.songEnd - asset.target!.songStart) * 24 - 1e-6);
  if (!/^h3-[a-f0-9]{64}$/.test(asset.jobId ?? "") || !hash(asset.mediaSha256) || asset.width !== 1344 || asset.height !== 768
    || asset.mediaFrameRate !== 24 || !Number.isSafeInteger(asset.mediaFrameCount) || endFrameExclusive > asset.mediaFrameCount!
    || !Number.isSafeInteger(frameIndex) || frameIndex < firstFrame || frameIndex >= endFrameExclusive || !proof?.draftSimilarityFilter) {
    throw new Error("Choose an exact native frame inside this eligible take's unchanged trim.");
  }
  const frameSha256 = frameHash(proof.samples, frameIndex);
  if (frameHash(proof.draftSimilarityFilter.samples, frameIndex) !== frameSha256) throw new Error("Historical frame pixel proofs disagree.");
  const current = asset.currentReferenceIdentity;
  let binding: NativeFirstFrameSelection["current"];
  if (current?.required) {
    const assessment = current.assessment;
    if (assessment?.status !== "ready" || frameHash(assessment.proof.samples, frameIndex) !== frameSha256
      || frameHash(assessment.proof.draftSimilarityFilter!.samples, frameIndex) !== frameSha256) throw new Error("Current and historical native frame pixels disagree.");
    binding = { migrationSha256: current.context.migrationSha256, contextSha256: current.context.contextSha256,
      assessmentId: assessment.scope.id, proofSha256: assessment.proofSha256 };
  }
  return { version: 1, assetId: asset.id, jobId: asset.jobId!, mediaSha256: asset.mediaSha256, frameIndex, frameRate: 24,
    trimStart, firstFrame, endFrameExclusive, originalProofSha256: identityPolicySha256(proof),
    ...(asset.identityAssessmentId ? { identityAssessmentId: asset.identityAssessmentId } : {}), frameSha256,
    ...(binding ? { current: binding } : {}) };
}

export function assertNativeFirstFrameReceipt(receipt: NativeFirstFrameReceipt, source: NativeFirstFrameSelection,
  artifact: H3FirstFrameArtifact, request: unknown) {
  if (!receipt || receipt.version !== 1 || receipt.body?.version !== 1 || receipt.body.purpose !== "verified-native-frame-source-v1"
    || receipt.sha256 !== h3FirstFrameDigest(receipt.body) || receipt.id !== `h3-native-source-${receipt.sha256}`
    || h3FirstFrameDigest(receipt.body.source) !== h3FirstFrameDigest(source) || receipt.body.artifactId !== artifact.id
    || receipt.body.descriptorSha256 !== artifact.sha256 || receipt.body.pngSha256 !== artifact.body.pngSha256
    || receipt.body.ownerId !== artifact.body.ownerId || receipt.body.projectId !== artifact.body.projectId
    || receipt.body.requestSha256 !== h3FirstFrameDigest(request) || !/^h3-[a-f0-9]{64}$/.test(receipt.body.targetJobId)) {
    throw new Error("The native-source receipt differs from this exact frame, image or shot.");
  }
  return receipt;
}
