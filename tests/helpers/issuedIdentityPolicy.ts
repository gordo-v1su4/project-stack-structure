import type { H3GenerationJob } from "@/components/studio/h3Generation";
import type { GeneratedAssetIdentityVerification, GeneratedStudioAsset } from "@/components/studio/generatedAssets";
import { getH3PolicyFamily, identityPolicySha256, issuedGalleryProfileSha256, type H3IdentityPolicyPreflightResult,
  type H3IssuedDraftPolicyBody, type H3IssuedDraftPolicy } from "@/components/studio/issuedIdentityPolicy";

/** Synthetic contract evidence, never an assessment of a real image or person. */
export function issuedPolicyFixture(job: H3GenerationJob, hashes = job.references.map((_, index) => (index + 1).toString().repeat(64))) {
  const family = getH3PolicyFamily(job.request.identityPolicyFamily!)!;
  const references = job.references.map((ref, index) => ({ ...ref, rawSha256: hashes[index] }));
  const galleries = references.filter(ref => ref.role === "identity").map(ref => ({ referenceAssetId: ref.assetId,
    canonicalName: ref.canonicalName, rawSha256: ref.rawSha256, faceRegions: [{ name: "frontal-1", rect: [.1, .1, .4, .5] as [number, number, number, number] }],
    referenceValidation: { method: "yunet-frontal-coherent-gallery-v1" as const, detectedFaceCount: 1, frontalAnchorCount: 1,
      selectedRegionCount: 1, evidenceSha256: "e".repeat(64) } }));
  const galleryProfileSha256 = issuedGalleryProfileSha256(galleries);
  const body: H3IssuedDraftPolicyBody = { version: 1, ownerId: job.ownerId, projectId: job.projectId, generationModel: "h3-ref2va-int8-v3",
    familyId: family.id, familySha256: family.sha256, references, galleries,
    identityReferenceHashes: references.filter(ref => ref.role === "identity").map(ref => ref.rawSha256), galleryProfileSha256,
    preprocessVersion: `${family.model.preprocessBaseVersion}-gallery-v2-${galleryProfileSha256}` };
  const sha256 = identityPolicySha256(body);
  const policy: H3IssuedDraftPolicy = { version: 1, id: `h3-policy-${sha256}`, sha256, familyId: family.id,
    familySha256: family.sha256, body, issuedAt: "2026-11-06T00:00:00Z" };
  const preflight: H3IdentityPolicyPreflightResult = { version: 1, status: "ready", bindingSha256: identityPolicySha256({
    ownerId: job.ownerId, projectId: job.projectId, generationModel: job.profile, familyId: family.id, familySha256: family.sha256, references }),
    familyId: family.id, familySha256: family.sha256, model: family.model, galleries, galleryProfileSha256 };
  return { policy, references, preflight };
}

export function issuedProofFixture(job: H3GenerationJob, asset: GeneratedStudioAsset, policy: H3IssuedDraftPolicy): GeneratedAssetIdentityVerification {
  const family = getH3PolicyFamily(policy.familyId)!;
  const { issuedAt: _issuedAt, ...issuedPolicy } = policy; void _issuedAt;
  const start = Math.floor((asset.trimStart ?? 0) * 24), end = Math.ceil(((asset.trimStart ?? 0) + job.target.songEnd - job.target.songStart) * 24);
  const samples = Array.from({ length: end - start }, (_, index) => {
    const score = { referenceHash: policy.body.identityReferenceHashes[0], trackId: "lead", score: .9 };
    return { timeSeconds: (start + index) / 24, frameSha256: (index + 1).toString(16).padStart(64, "0"), scores: [score], candidateScores: [score],
      foreground: { imageWidth: 1344, imageHeight: 768, leadTrackId: "lead", detections: [{ trackId: "lead", score: .9,
        box: [300, 20, 240, 344] as [number, number, number, number], landmarks: [367.2, 106, 472.8, 106, 420, 192, 384, 260.8, 456, 260.8],
        quality: { widthPixels: 240, heightPixels: 344, detectionScore: .97, blurVariance: 35, meanLuminance: 55 } }] } };
  });
  return { version: 1, status: "unverifiable", assetId: asset.id, jobId: job.id, generationModel: job.profile, mediaSha256: asset.mediaSha256!,
    durationSeconds: asset.durationSeconds!, frameCount: job.frames!, frameRate: 24, verifiedStartFrame: start, verifiedEndFrameExclusive: end,
    examinedFrameCount: samples.length, unverifiableFrameCount: samples.length, ambiguousFrameCount: 0, coverage: "incomplete",
    referenceHashes: policy.body.references.map(ref => ref.rawSha256), identityReferenceHashes: policy.body.identityReferenceHashes,
    assessedAt: "2026-11-06T00:00:00Z", verifier: { method: "face-embedding-cosine", model: family.model.model,
      modelSha256: family.model.recognitionSha256, version: family.model.verifierVersion, preprocessVersion: policy.body.preprocessVersion,
      calibrationId: "uncalibrated-no-automatic-pass-v1" }, samples: samples.map(sample => ({ ...sample, scores: [] })), issuedPolicy,
    draftSimilarityFilter: { version: 1, policyId: policy.id, policySha256: policy.sha256, status: "eligible", threshold: .8,
      examinedFrameCount: samples.length, eligibleFrameCount: samples.length, outOfScopeFrameCount: 0, ambiguousFrameCount: 0, samples,
      warnings: ["Synthetic numerical fixture; review required."] } };
}
