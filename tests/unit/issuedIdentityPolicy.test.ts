import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, test } from "bun:test";
import { approvedIdentityEvidenceSha256, canonicalIdentityPolicyJson, currentIdentityEvidenceSha256, getH3PolicyFamily,
  identityPolicyChoiceForReferences, identityPolicySha256, normalizeH3IssuedDraftPolicy, normalizeH3PublicIssuedDraftPolicy } from "@/components/studio/issuedIdentityPolicy";
import { generatedAssetDraftIdentityBlockReason, generatedAssetIdentityBlockReason, normalizeGeneratedAssetIdentityVerification } from "@/components/studio/generatedAssetIdentity";
import { applyApprovedGeneratedAssets, hasCurrentGeneratedIdentityApproval, hydrateGeneratedStudioAssets, mergeGeneratedAssetDelivery,
  sanitizeGeneratedStudioAssetForStorage, resolveGeneratedAssetTrimFrameControl } from "@/components/studio/generatedAssets";
import { approveGeneratedDraft, captureGeneratedDraftReview, createGeneratedDraftSelection, prepareGeneratedDraftApprovalEvidence, selectGeneratedDraftAsset } from "@/components/studio/generatedDraft";
import { parseH3DraftBatch } from "@/components/studio/h3DraftPlan";
import { issuedDraftAssetFixture } from "../helpers/issuedDraftAsset";
import { h3ProjectFixture } from "../helpers/h3Project";

describe("fixed numerical families and dynamically issued reference bindings", () => {
  for (const id of ["sface-yunet-foreground-frontal-v1", "sface-yunet-joint-frontal-v1"]) {
    test(`${id} pins the exact numerical family bytes`, async () => {
      const body = JSON.parse(await readFile(`scripts/identity/families/${id}.json`, "utf8")), family = getH3PolicyFamily(id)!;
      expect(identityPolicySha256(body)).toBe(family.sha256);
      expect(family.threshold).toBe(.8); expect(family.preserveIdentityVerificationStatus).toBe("unverifiable");
    });
  }
  test("sync primitive, WebCrypto and Node agree on sorted UTF8 evidence including Unicode names", async () => {
    const { asset } = issuedDraftAssetFixture();
    expect(canonicalIdentityPolicyJson({ z: 0, a: "Maya 星", omit: undefined })).toBe('{"a":"Maya 星","z":0}');
    expect(identityPolicySha256({ z: 0, a: "Maya 星" })).toBe(createHash("sha256").update('{"a":"Maya 星","z":0}').digest("hex"));
    expect(await approvedIdentityEvidenceSha256(asset)).toBe(currentIdentityEvidenceSha256(asset));
    expect(() => canonicalIdentityPolicyJson({ value: NaN })).toThrow();
    expect(() => canonicalIdentityPolicyJson({ value: Infinity })).toThrow();
  });

  for (const kind of ["foreground", "joint"] as const) test(`${kind} supports an unknown project and named authority without certifying identity`, async () => {
    const { asset, gap, policy } = issuedDraftAssetFixture(kind);
    expect(normalizeH3IssuedDraftPolicy(policy)).toEqual(policy);
    expect(normalizeGeneratedAssetIdentityVerification(asset.identityVerification)).not.toBe(undefined);
    expect(generatedAssetDraftIdentityBlockReason(asset)).toBeNull();
    expect(generatedAssetIdentityBlockReason(asset)).toBe("Identity could not be verified");
    const draft = selectGeneratedDraftAsset({ draft: createGeneratedDraftSelection("plan"), assets: [asset], asset, segments: [gap] });
    expect(draft.assetIds).toEqual([asset.id]); expect(asset.reviewStatus).toBe("pending");
    const review = captureGeneratedDraftReview([gap], [asset], draft)!;
    expect(approveGeneratedDraft({ draft, assets: [asset], segments: [gap], review }).error).not.toBeNull();
    const approvalEvidenceSha256ById = await prepareGeneratedDraftApprovalEvidence([asset], draft);
    const accepted = approveGeneratedDraft({ draft, assets: [asset], segments: [gap], review, approvalEvidenceSha256ById });
    expect(accepted.error).toBeNull(); expect(accepted.assets[0].identityVerification!.status).toBe("unverifiable");
    expect(hasCurrentGeneratedIdentityApproval(accepted.assets[0])).toBe(true);
    expect(applyApprovedGeneratedAssets([gap], accepted.assets)[0].kind).toBe("source");
    const restored = hydrateGeneratedStudioAssets(JSON.parse(JSON.stringify(accepted.assets.map(sanitizeGeneratedStudioAssetForStorage))));
    expect(restored[0].identityVerification).toEqual(asset.identityVerification);
    expect(hasCurrentGeneratedIdentityApproval(restored[0])).toBe(true);
  });

  for (const change of ["body tamper", "unknown family", "changed family pin", "incoherent gallery", "mismatched gallery hash", "missing identity", "foreign owner", "foreign project", "changed proof model", "low score", "partial trim", "unknown policy id", "missing envelope"]) {
    test(`blocks ${change}`, () => {
      const { asset } = issuedDraftAssetFixture(), proof = asset.identityVerification!, issued = proof.issuedPolicy!;
      if (change === "body tamper") issued.body.references[0].canonicalName = "Wrong name";
      if (change === "unknown family") (issued as { familyId: string }).familyId = "unknown";
      if (change === "changed family pin") issued.familySha256 = "a".repeat(64);
      if (change === "incoherent gallery") issued.body.galleries[0].referenceValidation.frontalAnchorCount = 2;
      if (change === "mismatched gallery hash") issued.body.galleryProfileSha256 = "a".repeat(64);
      if (change === "missing identity") proof.identityReferenceHashes = [];
      if (change === "foreign owner") asset.fullStorage!.objectKey = asset.fullStorage!.objectKey.replace("github-new-owner", "github-other");
      if (change === "foreign project") asset.fullStorage!.objectKey = asset.fullStorage!.objectKey.replace("new-named-character-project", "foreign-project");
      if (change === "changed proof model") proof.verifier.modelSha256 = "a".repeat(64);
      if (change === "low score") proof.draftSimilarityFilter!.samples[0].scores[0].score = .79;
      if (change === "partial trim") asset.trimStart = .1;
      if (change === "unknown policy id") proof.draftSimilarityFilter!.policyId = "unknown";
      if (change === "missing envelope") delete proof.issuedPolicy;
      expect(generatedAssetDraftIdentityBlockReason(asset)).not.toBeNull();
    });
  }

  test("changing a gallery and rehashing its body cannot preserve a different actual preprocessing binding", () => {
    const { policy } = issuedDraftAssetFixture(); policy.body.galleries[0].faceRegions[0].rect[0] += .01;
    policy.sha256 = identityPolicySha256(policy.body); policy.id = `h3-policy-${policy.sha256}`;
    expect(normalizeH3PublicIssuedDraftPolicy(policy)).toBe(undefined);
  });

  for (const change of ["trim", "warning", "target", "policy"]) test(`exact ${change} change invalidates consent on reload and redelivery`, async () => {
    const { asset, gap } = issuedDraftAssetFixture();
    asset.reviewStatus = "approved"; asset.approvedIdentityEvidenceSha256 = await approvedIdentityEvidenceSha256(asset);
    const changed = structuredClone(asset);
    if (change === "trim") changed.trimStart = .1;
    if (change === "warning") changed.identityVerification!.draftSimilarityFilter!.warnings.push("New warning");
    if (change === "target") changed.target!.songStart += .01;
    if (change === "policy") changed.identityVerification!.issuedPolicy!.sha256 = "a".repeat(64);
    expect(hasCurrentGeneratedIdentityApproval(changed)).toBe(false);
    expect(applyApprovedGeneratedAssets([gap], [changed])).toEqual([gap]);
    expect(sanitizeGeneratedStudioAssetForStorage(changed).reviewStatus).toBe("pending");
    const delivered = mergeGeneratedAssetDelivery(asset, changed);
    expect(delivered.reviewStatus).toBe("pending"); expect(delivered.approvedIdentityEvidenceSha256).toBe(undefined);
    const rejected = mergeGeneratedAssetDelivery({ ...asset, reviewStatus: "rejected" }, changed);
    expect(rejected.reviewStatus).toBe("rejected"); expect(rejected.approvedIdentityEvidenceSha256).toBe(undefined);
  });

  test("a proof change during asynchronous consent requires a fresh viewed draft", async () => {
    const { asset, gap } = issuedDraftAssetFixture();
    const draft = selectGeneratedDraftAsset({ draft: createGeneratedDraftSelection("plan"), assets: [asset], asset, segments: [gap] });
    const review = captureGeneratedDraftReview([gap], [asset], draft)!;
    const digestPromise = prepareGeneratedDraftApprovalEvidence([asset], draft);
    asset.identityVerification!.draftSimilarityFilter!.warnings.push("Changed while hashing");
    const approvalEvidenceSha256ById = await digestPromise;
    expect(approveGeneratedDraft({ draft, assets: [asset], segments: [gap], review, approvalEvidenceSha256ById }).error).toContain("draft changed");
  });

  test("a new rejection or explicit reopen wins over identical previously approved evidence", async () => {
    const { asset } = issuedDraftAssetFixture();
    asset.reviewStatus = "approved"; asset.approvedIdentityEvidenceSha256 = await approvedIdentityEvidenceSha256(asset);
    expect(mergeGeneratedAssetDelivery(asset, { ...asset, reviewStatus: "rejected" }).reviewStatus).toBe("rejected");
    expect(mergeGeneratedAssetDelivery(asset, { ...asset, reviewStatus: "pending" }).reviewStatus).toBe("pending");
    const redelivery = { ...asset, reviewStatus: "pending" as const, approvedIdentityEvidenceSha256: undefined };
    expect(mergeGeneratedAssetDelivery(asset, redelivery).reviewStatus).toBe("approved");
  });

  test("UI opts only new one/two-character requests in and leaves historical persisted requests absent", () => {
    const { saved, request } = h3ProjectFixture(), refs = saved.draft.referenceAssets!;
    expect(identityPolicyChoiceForReferences(refs, ["diego", "club"])).toEqual({ identityPolicyFamily: "sface-yunet-foreground-frontal-v1" });
    const second = { ...refs[0], id: "second", role: "character-2" as const, displayName: "Omar" };
    expect(identityPolicyChoiceForReferences([...refs, second], ["diego", "second", "club"])).toEqual({ identityPolicyFamily: "sface-yunet-joint-frontal-v1" });
    expect(identityPolicyChoiceForReferences(refs, ["club"])).toEqual({});
    const restored = parseH3DraftBatch(JSON.stringify({ version: 1, projectId: request.projectId, planSignature: request.planSignature, requests: [request], paused: false }), request.projectId)!;
    expect("identityPolicyFamily" in restored.requests[0]).toBe(false);
    expect(getH3PolicyFamily("unknown")).toBe(undefined);
  });

  test("native24fps controls retain the old30fps fallback without mutating existing trim seconds", () => {
    const trimStart = 3.267;
    expect(resolveGeneratedAssetTrimFrameControl({ trimStart, maxTrimStart: 4, framesPerSecond: 24 })).toEqual({ framesPerSecond: 24, maxFrame: 96, valueFrame: 78 });
    expect(trimStart).toBe(3.267);
    expect(resolveGeneratedAssetTrimFrameControl({ trimStart: 1.59, maxTrimStart: 4 }).valueFrame).toBe(48);
    expect(resolveGeneratedAssetTrimFrameControl({ trimStart: 1.59, maxTrimStart: 4, framesPerSecond: 24 }).valueFrame).toBe(38);
  });
});
