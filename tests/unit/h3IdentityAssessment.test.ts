import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { buildH3IdentityAssessmentScope, canDeliverH3IdentityAssessment, h3IdentityAssessmentTrimWindow, identityAssessmentAsset } from "@/components/studio/h3IdentityAssessment";
import { generatedAssetDraftIdentityBlockReason } from "@/components/studio/generatedAssetIdentity";
import { currentIdentityEvidenceSha256, identityApprovalPayload, canonicalIdentityPolicyJson, identityPolicySha256 } from "@/components/studio/issuedIdentityPolicy";
import { approveGeneratedDraft, captureGeneratedDraftReview, prepareGeneratedDraftApprovalEvidence } from "@/components/studio/generatedDraft";
import { hasCurrentGeneratedIdentityApproval, hydrateGeneratedStudioAssets, sanitizeGeneratedStudioAssetForStorage } from "@/components/studio/generatedAssets";
import { h3IdentityAssessmentFixture } from "../helpers/h3IdentityAssessment";
import { issuedDraftAssetFixture } from "../helpers/issuedDraftAsset";

describe("canonical exact native range assessment", () => {
  test("historical pending and approved whole-draft fingerprints remain byte-identical without a range ID",()=>{
    const {asset,gap}=issuedDraftAssetFixture();
    // Captured from HEAD's pre-assessment captureGeneratedDraftReview, using this unchanged synthetic fixture.
    const expected={pending:"9bd6f76b71e37748c1d32adadc826080536e3bb4c4f183d95bc09948580b6b7e",approved:"dbd6f835fa62bec616cbdf7e75ca37b528fbe06c90986ce85d62579dfbe1562b"};
    for(const reviewStatus of ["pending","approved"]as const){
      const candidate={...asset,reviewStatus,...(reviewStatus==="approved"?{approvedIdentityEvidenceSha256:currentIdentityEvidenceSha256(asset)}:{})};
      const draft={planSignature:gap.planSignature!,revision:1,assetIds:reviewStatus==="pending"?[asset.id]:[]};
      const review=captureGeneratedDraftReview([gap],[candidate],draft)!;
      expect(createHash("sha256").update(review.fingerprint).digest("hex")).toBe(expected[reviewStatus]);
    }
  });
  test("late completion cannot replace a changed trim, selected handle, policy, revision or user rejection",()=>{
    const {asset}=h3IdentityAssessmentFixture();
    const captured={fingerprint:currentIdentityEvidenceSha256(asset),currentAsset:asset,requestedRevision:4,currentRevision:4,requestedStartFrame:12,currentStartFrame:12};
    expect(canDeliverH3IdentityAssessment(captured)).toBe(true);
    for(const patch of [{currentRevision:5},{currentStartFrame:13},{currentAsset:{...asset,trimStart:.75}},
      {currentAsset:{...asset,reviewStatus:"rejected" as const}},{currentAsset:undefined}])expect(canDeliverH3IdentityAssessment({...captured,...patch})).toBe(false);
  });
  test("unselected failed takes expose bounded native frame choices without changing their saved trim or status",()=>{
    const {asset}=h3IdentityAssessmentFixture(),before=JSON.stringify(asset);
    const selected=h3IdentityAssessmentTrimWindow(asset,12);
    expect(selected).toMatchObject({trimStart:.5,trimEnd:1.5,firstFrame:12,endFrameExclusive:36,targetDuration:1,maxStartFrame:100});
    for(const frame of [-1,101,12.5,NaN])expect(()=>h3IdentityAssessmentTrimWindow(asset,frame)).toThrow();
    expect(JSON.stringify(asset)).toBe(before);
    const oldFractional={...asset,trimStart:.083};expect(h3IdentityAssessmentTrimWindow(oldFractional).trimStart).toBe(.083);
  });
  test("retains the failed original while a separate 12..36 all-frame assessment can enter review", () => {
    const { job,scope,record } = h3IdentityAssessmentFixture(), original = JSON.stringify(job);
    const range = identityAssessmentAsset(record,job);
    expect(scope.firstFrame).toBe(12); expect(scope.endFrameExclusive).toBe(36);
    expect(range.identityVerification!.status).toBe("unverifiable");
    expect(generatedAssetDraftIdentityBlockReason(range)).toBe(null);
    expect(generatedAssetDraftIdentityBlockReason(job.result!.asset)).toBe("Similarity filter did not pass");
    expect(JSON.stringify(job)).toBe(original);
  });
  test("rejects invalid physical trims, foreign jobs, changed policy/media/refs and stale parent proof", () => {
    const { job,record } = h3IdentityAssessmentFixture();
    for (const trim of [-1,NaN,Infinity,5,5.166667]) expect(() => buildH3IdentityAssessmentScope(job,trim,record.scope.requestIntentId)).toThrow();
    for (const mutate of [
      (j: typeof job) => { j.ownerId = "foreign"; }, (j: typeof job) => { j.projectId = "foreign"; },
      (j: typeof job) => { j.result!.asset.mediaSha256 = "f".repeat(64); },
      (j: typeof job) => { j.referenceHashes![0] = "f".repeat(64); },
      (j: typeof job) => { j.identityPolicy!.sha256 = "f".repeat(64); },
      (j: typeof job) => { j.result!.asset.identityVerification!.assessedAt = "2026-11-06T02:00:00Z"; },
      (j: typeof job) => { j.result!.asset.reviewStatus = "rejected"; },
    ]) { const changed = structuredClone(job); mutate(changed); expect(() => identityAssessmentAsset(record,changed)).toThrow(); }
    expect(() => identityAssessmentAsset(record,job,.75)).toThrow();
  });
  test("a forged proof or any missing/low-scoring used frame cannot pass the existing numeric gate", () => {
    const { job,record } = h3IdentityAssessmentFixture();
    const forged = structuredClone(record); if (forged.status !== "ready") throw Error("fixture");
    forged.proof.samples[0].frameSha256 = "f".repeat(64);
    expect(() => identityAssessmentAsset(forged,job)).toThrow();
    for (const mutate of [
      (p: typeof forged.proof) => { p.draftSimilarityFilter!.samples.pop(); },
      (p: typeof forged.proof) => { p.draftSimilarityFilter!.samples[0].scores[0].score = .79; },
    ]) {
      const changed = structuredClone(record); if (changed.status !== "ready") throw Error("fixture"); mutate(changed.proof);
      changed.proofSha256 = identityPolicySha256(changed.proof);
      expect(generatedAssetDraftIdentityBlockReason(identityAssessmentAsset(changed,job)) === null).toBe(false);
    }
  });
  test("Save/reload and exact whole-draft consent bind the assessment ID and invalidate later trim/proof changes", async () => {
    const { assessed,gap } = h3IdentityAssessmentFixture();
    const restored = hydrateGeneratedStudioAssets(JSON.parse(JSON.stringify([sanitizeGeneratedStudioAssetForStorage(assessed)])))[0];
    expect(restored.identityAssessmentId).toBe(assessed.identityAssessmentId);
    const draft = { planSignature: gap.planSignature!,revision: 1,assetIds: [restored.id] };
    const review = captureGeneratedDraftReview([gap],[restored],draft)!;
    const evidence = await prepareGeneratedDraftApprovalEvidence([restored],draft);
    const accepted = approveGeneratedDraft({ draft,assets:[restored],segments:[gap],review,approvalEvidenceSha256ById:evidence });
    expect(accepted.error).toBe(null); expect(hasCurrentGeneratedIdentityApproval(accepted.assets[0])).toBe(true);
    const changed = { ...accepted.assets[0], trimStart: .75 };
    expect(hasCurrentGeneratedIdentityApproval(changed)).toBe(false);
    expect(sanitizeGeneratedStudioAssetForStorage(changed).reviewStatus).toBe("pending");
    expect(approveGeneratedDraft({ draft,assets:[{ ...restored,identityAssessmentId:`h3-assessment-${"f".repeat(64)}` }],segments:[gap],review,approvalEvidenceSha256ById:evidence }).error).toContain("draft changed");
  });
  test("absent assessment IDs preserve historical pending and approved evidence digests byte for byte", () => {
    const { job } = h3IdentityAssessmentFixture(), original = job.result!.asset;
    for (const reviewStatus of ["pending","approved"] as const) {
      const asset = { ...original,reviewStatus };
      const historical = { id:asset.id,jobId:asset.jobId,model:asset.model,mediaSha256:asset.mediaSha256,target:asset.target,trimStart:asset.trimStart ?? 0,identityVerification:asset.identityVerification };
      expect(canonicalIdentityPolicyJson(identityApprovalPayload(asset))).toBe(canonicalIdentityPolicyJson(historical));
      expect(currentIdentityEvidenceSha256(asset)).toBe(identityPolicySha256(historical));
      const approved = { ...asset, approvedIdentityEvidenceSha256: identityPolicySha256(historical) };
      expect(hasCurrentGeneratedIdentityApproval(approved)).toBe(true);
      expect(sanitizeGeneratedStudioAssetForStorage(approved).reviewStatus).toBe(reviewStatus);
    }
  });
});
