import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, test } from "bun:test";
import { H3_DIEGO_V3_DRAFT_SIMILARITY_POLICY_ID, H3_DIEGO_V3_DRAFT_SIMILARITY_POLICY_SHA256,
  H3_JOINT_DRAFT_SIMILARITY_POLICY as policy, resolveH3DraftSimilarityPolicyForInputs } from "@/components/studio/identityDraftPolicy";
import { generatedAssetDraftIdentityBlockReason, generatedAssetIdentityBlockReason, normalizeGeneratedAssetIdentityVerification } from "@/components/studio/generatedAssetIdentity";
import { hydrateGeneratedStudioAssets, sanitizeGeneratedStudioAssetForStorage, applyApprovedGeneratedAssets } from "@/components/studio/generatedAssets";
import { createGeneratedDraftSelection, selectGeneratedDraftAsset, captureGeneratedDraftReview, approveGeneratedDraft } from "@/components/studio/generatedDraft";
import { draftSimilarityFixture } from "../helpers/draftSimilarity";

function fixture(reverse = false) {
  const value = draftSimilarityFixture(H3_DIEGO_V3_DRAFT_SIMILARITY_POLICY_ID, H3_DIEGO_V3_DRAFT_SIMILARITY_POLICY_SHA256);
  const { asset } = value, proof = asset.identityVerification!, filter = proof.draftSimilarityFilter!;
  const binding = policy.galleryBindings[reverse ? 1 : 0];
  asset.identityReferenceHashes = [...binding.identityReferenceHashes];
  asset.generationReferenceHashes = [...binding.identityReferenceHashes, "c".repeat(64)];
  proof.identityReferenceHashes = [...asset.identityReferenceHashes]; proof.referenceHashes = [...asset.generationReferenceHashes];
  proof.verifier.preprocessVersion = `opencv412-aligncrop112-rgb-f32-nchw-unit-centroid-v1-gallery-v2-${binding.gallerySha256}`;
  filter.policyId = policy.id; filter.policySha256 = policy.sha256;
  filter.samples = filter.samples.map(sample => ({ ...sample,
    scores: policy.identityReferenceSha256s.map((hash, index) => ({ referenceHash: hash, trackId: `face-${index}`, score: .9 })),
    candidateScores: policy.identityReferenceSha256s.flatMap((hash, identity) => [0, 1].map(track => ({
      referenceHash: hash, trackId: `face-${track}`, score: identity === track ? .9 : .1,
    }))),
  }));
  return value;
}

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, sorted(item)]));
  return value;
}

describe("joint provisional draft similarity", () => {
  test("new immutable policy binds both exact authorities and both ordered gallery profiles", async () => {
    const json = JSON.parse(await readFile(`scripts/identity/policies/${policy.id}.json`, "utf8"));
    expect(createHash("sha256").update(JSON.stringify(sorted(json))).digest("hex")).toBe(policy.sha256);
    expect(json.identities.map((identity: { rawSha256: string }) => identity.rawSha256)).toEqual([...policy.identityReferenceSha256s]);
    expect(json.scope.minimumAssignmentCosineMargin).toBe(policy.minimumAssignmentCosineMargin);
    expect(json.scope.requiredDetectedFaceCount).toBe(2);
    expect(json.preserveIdentityVerificationStatus).toBe("unverifiable");
    for (const [index, binding] of policy.galleryBindings.entries()) {
      expect(json.galleryBindings[index].gallerySha256).toBe(binding.gallerySha256);
      expect(resolveH3DraftSimilarityPolicyForInputs({ projectId: policy.projectId, generationModel: policy.generationModel,
        identityReferenceHashes: binding.identityReferenceHashes })).toBe(policy);
      const { asset } = fixture(index === 1);
      expect(generatedAssetDraftIdentityBlockReason(asset)).toBeNull();
      expect(generatedAssetIdentityBlockReason(asset)).toBe("Identity could not be verified");
    }
    for (const changed of [{ projectId: "other" }, { generationModel: "h3-ref2va-int8-v2" },
      { identityReferenceHashes: [policy.identityReferenceSha256s[0], policy.identityReferenceSha256s[0]] },
      { identityReferenceHashes: [...policy.identityReferenceSha256s, "c".repeat(64)] }]) {
      expect(resolveH3DraftSimilarityPolicyForInputs({ projectId: policy.projectId, generationModel: policy.generationModel,
        identityReferenceHashes: policy.identityReferenceSha256s, ...changed })).toBe(undefined);
    }
  });

  test("complete two-track evidence survives reload and only viewed-draft approval admits composition", () => {
    const { asset, gap } = fixture();
    const restored = hydrateGeneratedStudioAssets(JSON.parse(JSON.stringify([sanitizeGeneratedStudioAssetForStorage(asset)])))[0];
    expect(restored.identityVerification).toEqual(asset.identityVerification);
    expect(generatedAssetDraftIdentityBlockReason(restored)).toBeNull();
    const draft = selectGeneratedDraftAsset({ draft: createGeneratedDraftSelection("plan"), assets: [restored], asset: restored, segments: [gap] });
    expect(draft.assetIds).toEqual([asset.id]); expect(restored.reviewStatus).toBe("pending");
    expect(applyApprovedGeneratedAssets([gap], [restored])).toEqual([gap]);
    const review = captureGeneratedDraftReview([gap], [restored], draft)!;
    const approved = approveGeneratedDraft({ draft, assets: [restored], segments: [gap], review });
    expect(approved.error).toBeNull(); expect(approved.assets[0].identityVerification!.status).toBe("unverifiable");
    expect(applyApprovedGeneratedAssets([gap], approved.assets)[0].kind).toBe("source");
    restored.identityVerification!.draftSimilarityFilter!.samples[0].candidateScores![1].score = .11;
    expect(approveGeneratedDraft({ draft, assets: [restored], segments: [gap], review }).error).toContain("draft changed");
  });

  for (const failure of ["missing identity", "duplicate identity", "same track", "switch track", "low score", "missing matrix", "duplicate matrix", "row margin", "column margin", "changed assigned score", "bad candidate", "missing frame", "moved trim", "wrong gallery", "rejected"]) {
    test(`blocks ${failure}`, () => {
      const { asset, gap } = fixture(), proof = asset.identityVerification!, filter = proof.draftSimilarityFilter!, sample = filter.samples[1];
      if (failure === "missing identity") sample.scores.pop();
      if (failure === "duplicate identity") sample.scores[1].referenceHash = sample.scores[0].referenceHash;
      if (failure === "same track") sample.scores[1].trackId = sample.scores[0].trackId;
      if (failure === "switch track") sample.scores[1].trackId = "face-2";
      if (failure === "low score") sample.scores[1].score = .799;
      if (failure === "missing matrix") delete sample.candidateScores;
      if (failure === "duplicate matrix") sample.candidateScores![1] = { ...sample.candidateScores![0] };
      if (failure === "row margin") sample.candidateScores![1].score = .83;
      if (failure === "column margin") sample.candidateScores![2].score = .83;
      if (failure === "changed assigned score") sample.candidateScores![0].score = .89;
      if (failure === "bad candidate") sample.candidateScores![1].score = NaN;
      if (failure === "missing frame") filter.samples.pop();
      if (failure === "moved trim") asset.trimStart = .1;
      if (failure === "wrong gallery") proof.verifier.preprocessVersion = "different";
      if (failure === "rejected") asset.reviewStatus = "rejected";
      expect(generatedAssetDraftIdentityBlockReason(asset)).not.toBeNull();
      expect(selectGeneratedDraftAsset({ draft: createGeneratedDraftSelection("plan"), assets: [asset], asset, segments: [gap] }).assetIds).toEqual([]);
      if (failure === "bad candidate") expect(normalizeGeneratedAssetIdentityVerification(proof)).toBe(undefined);
    });
  }
});
