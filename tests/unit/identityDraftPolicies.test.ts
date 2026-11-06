import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, test } from "bun:test";
import { H3_DRAFT_SIMILARITY_POLICIES, H3_DRAFT_SIMILARITY_POLICY_ID, H3_DRAFT_SIMILARITY_POLICY_SHA256,
  resolveH3DraftSimilarityPolicy, resolveH3DraftSimilarityPolicyForInputs } from "@/components/studio/identityDraftPolicy";
import { generatedAssetDraftIdentityBlockReason, generatedAssetIdentityBlockReason } from "@/components/studio/generatedAssetIdentity";
import { approveGeneratedDraft, captureGeneratedDraftReview, createGeneratedDraftSelection, selectGeneratedDraftAsset } from "@/components/studio/generatedDraft";
import { draftSimilarityFixture } from "../helpers/draftSimilarity";

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sorted(item)]));
  return value;
}

describe("immutable profile-scoped provisional policy registry", () => {
  for (const policy of H3_DRAFT_SIMILARITY_POLICIES) {
    test(`${policy.id} pins exact canonical JSON and worker inputs`, async () => {
      const value = JSON.parse(await readFile(`scripts/identity/policies/${policy.id}.json`, "utf8"));
      expect(createHash("sha256").update(JSON.stringify(sorted(value))).digest("hex")).toBe(policy.sha256);
      expect(value.identity).toEqual({ canonicalName: policy.canonicalName, role: "identity", rawSha256: policy.identityReferenceSha256, gallerySha256: policy.gallerySha256 });
      expect(value.generationModel ?? "h3-ref2va-int8-v2").toBe(policy.generationModel);
      expect(value.model.preprocessVersion).toBe(policy.preprocessVersion);
      expect(value.threshold).toBe(.8); expect(value.scope.requireEveryIntendedFrame).toBe(true);
      expect(value.preserveIdentityVerificationStatus).toBe("unverifiable");
      expect(resolveH3DraftSimilarityPolicyForInputs({ projectId: policy.projectId, generationModel: policy.generationModel,
        identityReferenceHashes: [policy.identityReferenceSha256] })).toBe(policy);
      expect(resolveH3DraftSimilarityPolicy(policy.id, "a".repeat(64))).toBe(undefined);
      for (const changed of [{ projectId: "other" }, { generationModel: "h3-ref2va-int8-v1" }, { identityReferenceHashes: [] },
        { identityReferenceHashes: ["a".repeat(64)] }, { identityReferenceHashes: [policy.identityReferenceSha256, "a".repeat(64)] }]) {
        expect(resolveH3DraftSimilarityPolicyForInputs({ projectId: policy.projectId, generationModel: policy.generationModel,
          identityReferenceHashes: [policy.identityReferenceSha256], ...changed })).toBe(undefined);
      }
    });

    if (policy.generationModel !== "h3-ref2va-int8-v3") continue;
    test(`${policy.canonicalName} V3 eligible evidence still requires viewed draft approval`, () => {
      const { asset, gap } = draftSimilarityFixture(policy.id, policy.sha256);
      expect(generatedAssetIdentityBlockReason(asset)).toBe("Identity could not be verified");
      expect(generatedAssetDraftIdentityBlockReason(asset)).toBeNull();
      const draft = selectGeneratedDraftAsset({ draft: createGeneratedDraftSelection("plan"), assets: [asset], asset, segments: [gap] });
      expect(draft.assetIds).toEqual([asset.id]); expect(asset.reviewStatus).toBe("pending");
      const review = captureGeneratedDraftReview([gap], [asset], draft)!;
      const approved = approveGeneratedDraft({ draft, assets: [asset], segments: [gap], review });
      expect(approved.error).toBeNull(); expect(approved.assets[0].reviewStatus).toBe("approved");
      expect(approved.assets[0].identityVerification!.status).toBe("unverifiable");
      asset.identityVerification!.verifier.preprocessVersion = "different-gallery";
      expect(generatedAssetDraftIdentityBlockReason(asset)).not.toBeNull();
    });
  }
  test("the immutable V2 policy cannot authorize V3 through a changed model tag", () => {
    const old = resolveH3DraftSimilarityPolicy(H3_DRAFT_SIMILARITY_POLICY_ID, H3_DRAFT_SIMILARITY_POLICY_SHA256)!;
    expect(old.generationModel).toBe("h3-ref2va-int8-v2");
    const { asset } = draftSimilarityFixture(); asset.model = "h3-ref2va-int8-v3"; asset.identityVerification!.generationModel = asset.model;
    expect(generatedAssetDraftIdentityBlockReason(asset)).not.toBeNull();
  });
});
