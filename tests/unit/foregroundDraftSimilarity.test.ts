import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, test } from "bun:test";
import { H3_VALENTINA_FOREGROUND_POLICY as policy, H3_VALENTINA_V3_DRAFT_SIMILARITY_POLICY_ID, H3_VALENTINA_V3_DRAFT_SIMILARITY_POLICY_SHA256,
  resolveH3DraftSimilarityPolicyForInputs } from "@/components/studio/identityDraftPolicy";
import { generatedAssetDraftIdentityBlockReason, generatedAssetIdentityBlockReason, normalizeGeneratedAssetIdentityVerification } from "@/components/studio/generatedAssetIdentity";
import { type ForegroundFaceDetection, foregroundGeometryPasses } from "@/components/studio/foregroundDraftEvidence";
import { hydrateGeneratedStudioAssets, sanitizeGeneratedStudioAssetForStorage, applyApprovedGeneratedAssets } from "@/components/studio/generatedAssets";
import { createGeneratedDraftSelection, selectGeneratedDraftAsset, captureGeneratedDraftReview, approveGeneratedDraft } from "@/components/studio/generatedDraft";
import { draftSimilarityFixture } from "../helpers/draftSimilarity";

function face(x: number, y: number, width: number, height: number, trackId: string, score: number, confidence: number): ForegroundFaceDetection {
  return { trackId, score, box: [x, y, width, height], landmarks: [x + .28 * width, y + .25 * height, x + .72 * width, y + .25 * height,
    x + .5 * width, y + .5 * height, x + .35 * width, y + .7 * height, x + .65 * width, y + .7 * height],
    quality: { widthPixels: width, heightPixels: height, detectionScore: confidence, blurVariance: 35, meanLuminance: 55 } };
}
function fixture() {
  const value = draftSimilarityFixture(policy.id, policy.sha256);
  const filter = value.asset.identityVerification!.draftSimilarityFilter!;
  filter.samples = filter.samples.map(sample => {
    const detections = [face(300, 20, 240, 344, "face-0", .9, .97), face(20, 200, 100, 180, "background", .1, .88)];
    return { ...sample, candidateScores: detections.map(face => ({ referenceHash: policy.identityReferenceSha256, trackId: face.trackId, score: face.score })),
      foreground: { imageWidth: 1344, imageHeight: 768, leadTrackId: "face-0", detections } };
  });
  return value;
}
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, sorted(item)]));
  return value;
}

describe("reviewed post-observation Valentina foreground policy", () => {
  test("pins the new policy and prefers it only for exact future Valentina V3 inputs", async () => {
    const json = JSON.parse(await readFile(`scripts/identity/policies/${policy.id}.json`, "utf8"));
    expect(createHash("sha256").update(JSON.stringify(sorted(json))).digest("hex")).toBe(policy.sha256);
    expect(json.scopeDecisionBasis).toContain("after observing");
    expect(json.threshold).toBe(.8); expect(json.preserveIdentityVerificationStatus).toBe("unverifiable");
    for (const [key, bound] of Object.entries(policy.foregroundGeometry)) expect(json.scope[key]).toBe(bound);
    for (const [key, bound] of Object.entries(policy.foregroundDominance)) expect(json.foregroundDominance[key]).toBe(bound);
    expect(resolveH3DraftSimilarityPolicyForInputs({ projectId: policy.projectId, generationModel: policy.generationModel,
      identityReferenceHashes: [policy.identityReferenceSha256] })).toBe(policy);
    const old = draftSimilarityFixture(H3_VALENTINA_V3_DRAFT_SIMILARITY_POLICY_ID, H3_VALENTINA_V3_DRAFT_SIMILARITY_POLICY_SHA256);
    expect(generatedAssetDraftIdentityBlockReason(old.asset)).toBeNull();
    expect(old.asset.identityVerification!.draftSimilarityFilter!.policyId).toBe(H3_VALENTINA_V3_DRAFT_SIMILARITY_POLICY_ID);
    for (const changed of [{ projectId: "other" }, { generationModel: "h3-ref2va-int8-v2" }, { identityReferenceHashes: [] },
      { identityReferenceHashes: [policy.identityReferenceSha256, "a".repeat(64)] }]) {
      expect(resolveH3DraftSimilarityPolicyForInputs({ projectId: policy.projectId, generationModel: policy.generationModel,
        identityReferenceHashes: [policy.identityReferenceSha256], ...changed })).toBe(undefined);
    }
  });

  test("all detection evidence persists and belongs to whole-draft review while identity stays unverified", () => {
    const { asset, gap } = fixture();
    const restored = hydrateGeneratedStudioAssets(JSON.parse(JSON.stringify([sanitizeGeneratedStudioAssetForStorage(asset)])))[0];
    expect(restored.identityVerification).toEqual(asset.identityVerification);
    expect(generatedAssetDraftIdentityBlockReason(restored)).toBeNull();
    expect(generatedAssetIdentityBlockReason(restored)).toBe("Identity could not be verified");
    const draft = selectGeneratedDraftAsset({ draft: createGeneratedDraftSelection("plan"), assets: [restored], asset: restored, segments: [gap] });
    expect(draft.assetIds).toEqual([asset.id]); expect(restored.reviewStatus).toBe("pending");
    expect(applyApprovedGeneratedAssets([gap], [restored])).toEqual([gap]);
    const review = captureGeneratedDraftReview([gap], [restored], draft)!;
    const approved = approveGeneratedDraft({ draft, assets: [restored], segments: [gap], review });
    expect(approved.error).toBeNull(); expect(approved.assets[0].identityVerification!.status).toBe("unverifiable");
    restored.identityVerification!.draftSimilarityFilter!.samples[1].foreground!.detections[1].quality.blurVariance++;
    expect(generatedAssetDraftIdentityBlockReason(restored)).toBeNull();
    expect(approveGeneratedDraft({ draft, assets: [restored], segments: [gap], review }).error).toContain("draft changed");
  });

  for (const failure of ["missing evidence", "missing detections", "too wide", "too tall", "too much area", "overlap", "second qualified face", "high similarity background", "changed candidate", "missing candidate", "switch", "jump", "low lead confidence", "nonfrontal lead", "clipped lead", "bad dimensions", "invalid quality", "missing frame", "rejected"]) {
    test(`blocks ${failure}`, () => {
      const { asset, gap } = fixture(), proof = asset.identityVerification!, filter = proof.draftSimilarityFilter!, sample = filter.samples[1];
      const evidence = sample.foreground!, lead = evidence.detections[0];
      if (failure === "missing evidence") delete sample.foreground;
      if (failure === "missing detections") evidence.detections = [];
      if (failure === "too wide") evidence.detections[1] = face(20, 200, 145, 180, "background", .1, .88);
      if (failure === "too tall") evidence.detections[1] = face(20, 200, 100, 207, "background", .1, .88);
      if (failure === "too much area") evidence.detections[1] = face(20, 200, 144, 200, "background", .1, .88);
      if (failure === "overlap") evidence.detections[1] = face(290, 200, 100, 180, "background", .1, .88);
      if (failure === "second qualified face") evidence.detections[1] = face(20, 200, 140, 190, "background", .1, .97);
      if (failure === "high similarity background") {
        evidence.detections[1].score = .76; sample.candidateScores![1].score = .76;
      }
      if (failure === "changed candidate") sample.candidateScores![0].score = .91;
      if (failure === "missing candidate") sample.candidateScores!.pop();
      if (failure === "switch") { lead.trackId = "new"; evidence.leadTrackId = "new"; sample.scores[0].trackId = "new"; sample.candidateScores![0].trackId = "new"; }
      if (failure === "jump") evidence.detections[0] = face(900, 20, 240, 344, "face-0", .9, .97);
      if (failure === "low lead confidence") lead.quality.detectionScore = .93;
      if (failure === "nonfrontal lead") lead.landmarks[4] += 50;
      if (failure === "clipped lead") evidence.detections[0] = face(-10, 20, 240, 344, "face-0", .9, .97);
      if (failure === "bad dimensions") evidence.imageWidth = 100;
      if (failure === "invalid quality") lead.quality.detectionScore = NaN;
      if (failure === "missing frame") filter.samples.pop();
      if (failure === "rejected") asset.reviewStatus = "rejected";
      expect(generatedAssetDraftIdentityBlockReason(asset)).not.toBeNull();
      expect(selectGeneratedDraftAsset({ draft: createGeneratedDraftSelection("plan"), assets: [asset], asset, segments: [gap] }).assetIds).toEqual([]);
      if (failure === "invalid quality") expect(normalizeGeneratedAssetIdentityVerification(proof)).toBe(undefined);
    });
  }

  test("inclusive width cap can pass only when area and nonqualification also pass", () => {
    const { asset } = fixture();
    for (const sample of asset.identityVerification!.draftSimilarityFilter!.samples) {
      sample.foreground!.detections[1] = face(20, 200, 144, 190, "background", .1, .88);
    }
    expect(generatedAssetDraftIdentityBlockReason(asset)).toBeNull();
    expect(foregroundGeometryPasses(face(20, 200, 140, 190, "background", .1, .97), 1344, 768, policy.foregroundGeometry)).toBe(true);
  });
});
