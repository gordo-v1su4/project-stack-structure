import type { H3GenerationJob, H3ReferenceSnapshot } from "@/components/studio/h3Generation";
import { draftSimilarityFixture } from "./draftSimilarity";
import { issuedPolicyFixture } from "./issuedIdentityPolicy";

/** Synthetic new-project contracts only, not face likeness measurements. */
export function issuedDraftAssetFixture(kind: "foreground" | "joint" = "foreground") {
  const { asset, gap } = draftSimilarityFixture();
  const projectId = "new-named-character-project", ownerId = "github-new-owner", id = `h3-${"7".repeat(64)}`;
  const references: H3ReferenceSnapshot[] = [
    { assetId: "maya", canonicalName: "Maya 星", role: "identity", bucket: "studio", objectKey: `media-uploads/${ownerId}/maya.png`, version: "v1", etag: '"maya-v1"' },
    ...(kind === "joint" ? [{ assetId: "omar", canonicalName: "Omar", role: "identity" as const, bucket: "studio", objectKey: `media-uploads/${ownerId}/omar.png`, version: "v1", etag: '"omar-v1"' }] : []),
    { assetId: "hall", canonicalName: "Glass Hall", role: "environment", bucket: "studio", objectKey: `media-uploads/${ownerId}/hall.png`, version: "v1", etag: '"hall-v1"' },
  ];
  const job: H3GenerationJob = { version: 1, id, ownerId, projectId, profile: "h3-ref2va-int8-v3", references,
    request: { projectId, planSignature: "plan", sectionId: "intro", timelineItemId: "arrival", requirementId: "arrival",
      songStart: 0, songEnd: 1.51, prompt: kind === "joint" ? "Maya 星 and Omar face the lens." : "Maya 星 faces the lens.",
      referenceAssetIds: references.map(ref => ref.assetId), requestIntentId: "12345678-1234-4123-8123-123456789abc",
      identityPolicyFamily: kind === "joint" ? "sface-yunet-joint-frontal-v1" : "sface-yunet-foreground-frontal-v1" },
    target: asset.target!, state: "ready", createdAt: asset.createdAt, updatedAt: asset.createdAt, frames: 124 };
  const fixture = issuedPolicyFixture(job);
  const policy = fixture.policy, body = policy.body, proof = asset.identityVerification!, filter = proof.draftSimilarityFilter!;
  const objectKey = `media-uploads/projects/${ownerId}/generated/${projectId}/${id}/shot.mp4`;
  Object.assign(asset, { id, jobId: id, model: job.profile, fullStorage: { bucket: "studio", objectKey, storagePath: objectKey,
    publicUrl: `https://media.example/${objectKey}`, mime: "video/mp4" },
    generationReferenceHashes: body.references.map(ref => ref.rawSha256), identityReferenceHashes: [...body.identityReferenceHashes] });
  Object.assign(proof, { assetId: id, jobId: id, generationModel: job.profile, referenceHashes: [...asset.generationReferenceHashes!],
    identityReferenceHashes: [...body.identityReferenceHashes], issuedPolicy: { version: 1, id: policy.id, sha256: policy.sha256,
      familyId: policy.familyId, familySha256: policy.familySha256, body },
    verifier: { ...proof.verifier, preprocessVersion: body.preprocessVersion } });
  filter.policyId = policy.id; filter.policySha256 = policy.sha256;
  for (const sample of filter.samples) {
    sample.scores = body.identityReferenceHashes.map((hash, index) => ({ referenceHash: hash, trackId: `face-${index}`, score: .9 }));
    if (kind === "joint") {
      sample.candidateScores = body.identityReferenceHashes.flatMap((hash, identity) => [0, 1].map(track => ({ referenceHash: hash, trackId: `face-${track}`, score: identity === track ? .9 : .1 })));
    } else {
      sample.candidateScores = [sample.scores[0], { referenceHash: body.identityReferenceHashes[0], trackId: "background", score: .1 }];
      sample.foreground = { imageWidth: 1344, imageHeight: 768, leadTrackId: "face-0", detections: [
        { trackId: "face-0", score: .9, box: [300, 20, 240, 344], landmarks: [367.2, 106, 472.8, 106, 420, 192, 384, 260.8, 456, 260.8],
          quality: { widthPixels: 240, heightPixels: 344, detectionScore: .97, blurVariance: 35, meanLuminance: 55 } },
        { trackId: "background", score: .1, box: [20, 200, 100, 180], landmarks: [48, 245, 92, 245, 70, 290, 55, 326, 85, 326],
          quality: { widthPixels: 100, heightPixels: 180, detectionScore: .88, blurVariance: 35, meanLuminance: 55 } },
      ] };
    }
  }
  job.identityPolicy = { version: 1, id: policy.id, sha256: policy.sha256, familyId: policy.familyId, familySha256: policy.familySha256 };
  job.referenceHashes = [...asset.generationReferenceHashes!]; job.result = { asset };
  return { ...fixture, asset, gap, job };
}
