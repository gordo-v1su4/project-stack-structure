import type { GeneratedStudioAsset } from "@/components/studio/generatedAssets";
import type { EditPlanPreviewSegment } from "@/components/studio/musicVideoProject";
import { H3_DRAFT_SIMILARITY_POLICY_ID, H3_DRAFT_SIMILARITY_POLICY_SHA256,
  resolveH3DraftSimilarityPolicy } from "@/components/studio/identityDraftPolicy";

/** Synthetic contract data only: no fixture score certifies a real person's likeness. */
export function draftSimilarityFixture(policyId = H3_DRAFT_SIMILARITY_POLICY_ID, policySha256 = H3_DRAFT_SIMILARITY_POLICY_SHA256) {
  const policy = resolveH3DraftSimilarityPolicy(policyId, policySha256)!;
  const identity = policy.identityReferenceSha256;
  const id = `h3-${"a".repeat(64)}`, duration = 1.51;
  const samples = Array.from({ length: 37 }, (_, index) => ({ timeSeconds: index / 24,
    frameSha256: (index + 1).toString(16).padStart(64, "0"),
    scores: [{ referenceHash: identity, trackId: "face-0", score: 0.9 }] }));
  const gap: EditPlanPreviewSegment = { planSignature: "plan", requirementId: "arrival", timelineItemId: "arrival",
    sectionId: "intro", label: "Arrival", kind: "gap", videoUrl: "", startTime: 0, endTime: duration, musicStart: 0, musicEnd: duration };
  const objectKey = `media-uploads/projects/github-test/generated/${policy.projectId}/${id}/shot.mp4`;
  const asset: GeneratedStudioAsset = { id, jobId: id, provider: "swarmui", model: policy.generationModel, prompt: "Synthetic frontal fixture",
    createdAt: "2026-11-06T00:00:00Z", status: "completed", reviewStatus: "pending", mediaKind: "video", durationSeconds: 5.166667,
    fullStorage: { bucket: "studio", objectKey, storagePath: objectKey, publicUrl: `https://media.example/${objectKey}`, mime: "video/mp4" },
    mediaSha256: "b".repeat(64), mediaFrameCount: 124, mediaFrameRate: 24,
    generationReferenceHashes: [identity, "c".repeat(64)], identityReferenceHashes: [identity],
    target: { planSignature: "plan", requirementId: "arrival", timelineItemId: "arrival", sectionId: "intro", sectionLabel: "Intro", songStart: 0, songEnd: duration },
    identityVerification: { version: 1, status: "unverifiable", assetId: id, jobId: id, generationModel: policy.generationModel,
      mediaSha256: "b".repeat(64), referenceHashes: [identity, "c".repeat(64)], identityReferenceHashes: [identity],
      durationSeconds: 5.166667, frameCount: 124, frameRate: 24, verifiedStartFrame: 0, verifiedEndFrameExclusive: 37,
      examinedFrameCount: 37, unverifiableFrameCount: 23, ambiguousFrameCount: 0, assessedAt: "2026-11-06T00:00:00Z",
      coverage: "incomplete", verifier: { method: "face-embedding-cosine", model: policy.verifierModel, modelSha256: policy.modelSha256,
        version: policy.verifierVersion, preprocessVersion: policy.preprocessVersion, calibrationId: "uncalibrated-no-automatic-pass-v1" },
      samples: samples.map(sample => ({ ...sample, scores: [] })),
      draftSimilarityFilter: { version: 1, policyId: policy.id, policySha256: policy.sha256, status: "eligible", threshold: policy.threshold,
        examinedFrameCount: 37, eligibleFrameCount: 37, outOfScopeFrameCount: 0, ambiguousFrameCount: 0,
        samples, warnings: ["Provisional filter: review quality, motion and likeness in the assembled draft."] } },
  };
  return { asset, gap };
}
