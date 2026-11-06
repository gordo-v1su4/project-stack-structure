import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, test } from "bun:test";
import { generatedAssetDraftIdentityBlockReason, generatedAssetDraftSimilarityLabel,
  generatedAssetDraftSimilarityWarnings, generatedAssetIdentityBlockReason,
  normalizeGeneratedAssetIdentityVerification } from "@/components/studio/generatedAssetIdentity";
import { applyApprovedGeneratedAssets, hydrateGeneratedStudioAssets, sanitizeGeneratedStudioAssetForStorage } from "@/components/studio/generatedAssets";
import { applyDraftGeneratedAssets, approveGeneratedDraft, captureGeneratedDraftReview, createGeneratedDraftSelection,
  rejectGeneratedDraftAsset, selectGeneratedDraftAsset } from "@/components/studio/generatedDraft";
import { H3_DRAFT_SIMILARITY_POLICY_ID, H3_DRAFT_SIMILARITY_POLICY_SHA256 } from "@/components/studio/identityDraftPolicy";
import { draftSimilarityFixture } from "../helpers/draftSimilarity";

describe("provisional project-local numeric draft similarity", () => {
  test("pins the immutable canonical policy file", async () => {
    const value = JSON.parse(await readFile(`scripts/identity/policies/${H3_DRAFT_SIMILARITY_POLICY_ID}.json`, "utf8"));
    function sorted(value: unknown): unknown {
      if (Array.isArray(value)) return value.map(sorted);
      if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sorted(item)]));
      return value;
    }
    expect(createHash("sha256").update(JSON.stringify(sorted(value))).digest("hex")).toBe(H3_DRAFT_SIMILARITY_POLICY_SHA256);
  });

  test("eligible evidence selects an unverified draft; only complete viewed-draft approval admits final composition", () => {
    const { asset, gap } = draftSimilarityFixture();
    expect(generatedAssetIdentityBlockReason(asset)).toBe("Identity could not be verified");
    expect(generatedAssetDraftIdentityBlockReason(asset)).toBeNull();
    expect(generatedAssetDraftSimilarityLabel(asset)).toBe("Similarity filter passed · review required");
    expect(generatedAssetDraftSimilarityWarnings(asset)).toHaveLength(1);
    const draft = selectGeneratedDraftAsset({ draft: createGeneratedDraftSelection("plan"), assets: [asset], asset, segments: [gap] });
    expect(draft.assetIds).toEqual([asset.id]);
    expect(asset.reviewStatus).toBe("pending");
    expect(applyDraftGeneratedAssets([gap], [asset], draft)[0].kind).toBe("source");
    expect(applyApprovedGeneratedAssets([gap], [asset])).toEqual([gap]);
    const review = captureGeneratedDraftReview([gap], [asset], draft)!;
    const approved = approveGeneratedDraft({ draft, assets: [asset], segments: [gap], review });
    expect(approved.error).toBeNull();
    expect(approved.assets[0].reviewStatus).toBe("approved");
    expect(approved.assets[0].identityVerification!.status).toBe("unverifiable");
    expect(applyApprovedGeneratedAssets([gap], approved.assets)[0].kind).toBe("source");
  });

  const failures = ["missing filter", "unknown policy", "wrong hash", "low threshold", "ineligible", "unverifiable", "partial count", "unqualified frame", "out of scope", "ambiguous", "missing sample", "duplicate time", "wrong time", "empty score", "duplicate score", "low score", "track switch", "different frame hash", "different parent media", "different parent refs", "different model", "different preprocess", "different project", "different job path", "moved trim", "shortened trim"];
  for (const failure of failures) test(`does not select ${failure}`, () => {
    const { asset, gap } = draftSimilarityFixture(), proof = asset.identityVerification!, filter = proof.draftSimilarityFilter!;
    if (failure === "missing filter") delete proof.draftSimilarityFilter;
    if (failure === "unknown policy") filter.policyId = "unknown";
    if (failure === "wrong hash") filter.policySha256 = "a".repeat(64);
    if (failure === "low threshold") filter.threshold = .79;
    if (failure === "ineligible") filter.status = "ineligible";
    if (failure === "unverifiable") filter.status = "unverifiable";
    if (failure === "partial count") filter.examinedFrameCount--;
    if (failure === "unqualified frame") filter.eligibleFrameCount--;
    if (failure === "out of scope") filter.outOfScopeFrameCount++;
    if (failure === "ambiguous") filter.ambiguousFrameCount++;
    if (failure === "missing sample") filter.samples.pop();
    if (failure === "duplicate time") filter.samples[1].timeSeconds = 0;
    if (failure === "wrong time") filter.samples[1].timeSeconds += .001;
    if (failure === "empty score") filter.samples[1].scores = [];
    if (failure === "duplicate score") filter.samples[1].scores.push({ ...filter.samples[1].scores[0] });
    if (failure === "low score") filter.samples[1].scores[0].score = .799999;
    if (failure === "track switch") filter.samples[1].scores[0].trackId = "face-1";
    if (failure === "different frame hash") filter.samples[1].frameSha256 = "e".repeat(64);
    if (failure === "different parent media") proof.mediaSha256 = "e".repeat(64);
    if (failure === "different parent refs") proof.referenceHashes.reverse();
    if (failure === "different model") proof.verifier.modelSha256 = "e".repeat(64);
    if (failure === "different preprocess") proof.verifier.preprocessVersion = "changed";
    if (failure === "different project") asset.fullStorage!.objectKey = asset.fullStorage!.objectKey.replace("75101b25", "00000000");
    if (failure === "different job path") asset.fullStorage!.objectKey = asset.fullStorage!.objectKey.replace("/shot.mp4", "/another.mp4");
    if (failure === "moved trim") asset.trimStart = .1;
    if (failure === "shortened trim") asset.target!.songEnd = 1;
    expect(generatedAssetDraftIdentityBlockReason(asset)).not.toBeNull();
    expect(selectGeneratedDraftAsset({ draft: createGeneratedDraftSelection("plan"), assets: [asset], asset, segments: [gap] }).assetIds).toEqual([]);
  });

  test("normalization persists complete filter evidence and malformed children cannot grant eligibility", () => {
    const { asset } = draftSimilarityFixture();
    const saved = sanitizeGeneratedStudioAssetForStorage(asset);
    const restored = hydrateGeneratedStudioAssets(JSON.parse(JSON.stringify([saved])))[0];
    expect(restored.identityVerification).toEqual(asset.identityVerification);
    expect(restored.identityVerification!.draftSimilarityFilter).not.toBe(asset.identityVerification!.draftSimilarityFilter);
    expect(generatedAssetDraftIdentityBlockReason(restored)).toBeNull();
    const malformed = structuredClone(asset.identityVerification!);
    malformed.draftSimilarityFilter!.samples[0].scores[0].score = NaN;
    expect(normalizeGeneratedAssetIdentityVerification(malformed)).toBe(undefined);
    expect(normalizeGeneratedAssetIdentityVerification({ ...asset.identityVerification, draftSimilarityFilter: null })).toBe(undefined);
  });

  test("warnings and all sample evidence belong to the viewed fingerprint, and explicit rejection always wins", () => {
    const { asset, gap } = draftSimilarityFixture();
    const draft = selectGeneratedDraftAsset({ draft: createGeneratedDraftSelection("plan"), assets: [asset], asset, segments: [gap] });
    const review = captureGeneratedDraftReview([gap], [asset], draft)!;
    asset.identityVerification!.draftSimilarityFilter!.warnings.push("New quality evidence");
    expect(generatedAssetDraftIdentityBlockReason(asset)).toBeNull();
    expect(approveGeneratedDraft({ draft, assets: [asset], segments: [gap], review }).error).toContain("draft changed");
    const rejection = rejectGeneratedDraftAsset({ draft, assets: [asset], assetId: asset.id });
    expect(generatedAssetDraftIdentityBlockReason(rejection.assets[0])).toBe("Rejected");
    expect(selectGeneratedDraftAsset({ draft: rejection.draft, assets: rejection.assets, asset, segments: [gap] }).assetIds).toEqual([]);
  });
});
