import type { H3GenerationJob } from "@/components/studio/h3Generation";
import type { GeneratedStudioAsset } from "@/components/studio/generatedAssets";
import { type SelectedFootageEvidenceInput } from "@/components/studio/selectedFootageEvidence";

export function selectedFootageFixture(): SelectedFootageEvidenceInput {
  const jobId = `h3-${"a".repeat(64)}`, mediaSha256 = "b".repeat(64), referenceHash = "c".repeat(64);
  const target = { planSignature: "scope", timelineItemId: "item", sectionId: "section", sectionLabel: "Verse", songStart: 10, songEnd: 12 };
  const asset: GeneratedStudioAsset = { id: "asset", provider: "swarmui", model: "h3-ref2va-int8-v1", prompt: "EDITABLE AND UNTRUSTED",
    createdAt: "2026-11-08T00:00:00Z", status: "completed", mediaKind: "video", reviewStatus: "pending", target,
    jobId, mediaSha256, mediaFrameCount: 96, mediaFrameRate: 24, durationSeconds: 4, trimStart: 1,
    fullStorage: { bucket: "media", objectKey: `media-uploads/projects/owner/generated/project/${jobId}/shot.mp4`, publicUrl: "https://media.test/shot.mp4", storagePath: `media-uploads/projects/owner/generated/project/${jobId}/shot.mp4`, mime: "video/mp4" },
    generationReferenceHashes: [referenceHash], identityReferenceHashes: [],
    identityVerification: { version: 1, status: "not_required", assetId: "asset", jobId, generationModel: "h3-ref2va-int8-v1",
      mediaSha256, referenceHashes: [referenceHash], identityReferenceHashes: [], durationSeconds: 4, frameCount: 96, frameRate: 24,
      examinedFrameCount: 0, verifiedStartFrame: 0, verifiedEndFrameExclusive: 96, unverifiableFrameCount: 0, ambiguousFrameCount: 0,
      assessedAt: "2026-11-08T00:00:00Z", verifier: { method: "face-embedding-cosine", model: "test", modelSha256: "d".repeat(64), version: "1", preprocessVersion: "1", calibrationId: "1" }, coverage: "not_required", samples: [] } };
  const job: H3GenerationJob = { version: 1, id: jobId, ownerId: "owner", projectId: "project", profile: "h3-ref2va-int8-v1",
    request: { projectId: "project", planSignature: "scope", timelineItemId: "item", sectionId: "section", songStart: 10, songEnd: 12,
      prompt: "Camera follows Diego toward the door.", referenceAssetIds: ["club"], requestIntentId: "intent" },
    references: [{ assetId: "club", canonicalName: "Club", role: "environment", bucket: "media", objectKey: "club.png", version: "1" }],
    referenceHashes: [referenceHash], target, state: "ready", createdAt: "2026-11-08T00:00:00Z", updatedAt: "2026-11-08T00:00:00Z", result: { asset: structuredClone(asset) } };
  return { selected: true, ownerId: "owner", projectId: "project", generationScope: "scope", asset, job,
    window: { songStart: 10.5, songEnd: 11.5, sourceStart: 1.5, sourceEnd: 2.5 } };
}

