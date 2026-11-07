import {describe,expect,test} from "bun:test";
import {currentReferenceIdentityFixture} from "../helpers/currentReferenceIdentity";
import {attachCurrentIdentityAssessments,buildCurrentIdentityScope,currentIdentityReviewSha256,currentReferenceIdentityApprovalSha256,normalizeCurrentIdentityProof,stripCurrentReferenceIdentity,withCurrentReferenceIdentity} from "@/components/studio/currentReferenceIdentity";
import {generatedAssetDraftIdentityBlockReason} from "@/components/studio/generatedAssetIdentity";
import {identityPolicySha256,currentIdentityEvidenceSha256} from "@/components/studio/issuedIdentityPolicy";
import {sanitizeGeneratedStudioAssetForStorage} from "@/components/studio/generatedAssets";
import {captureGeneratedDraftReview} from "@/components/studio/generatedDraft";

describe("current-reference identity evidence",()=>{
  test("requires both original and independently bound current eligibility, without rewriting generation evidence",()=>{
    const{asset,context,oldHash,newHash}=currentReferenceIdentityFixture(),before=JSON.stringify(asset);
    expect(generatedAssetDraftIdentityBlockReason(asset)).toBeNull();
    const projected=withCurrentReferenceIdentity([asset],context)[0];
    expect(generatedAssetDraftIdentityBlockReason(projected)).toBeNull();
    expect(projected.generationReferenceHashes).toContain(oldHash);expect(projected.generationReferenceHashes).not.toContain(newHash);
    expect(JSON.stringify(asset)).toBe(before);expect(stripCurrentReferenceIdentity([projected])[0]).toEqual(asset);
    expect(sanitizeGeneratedStudioAssetForStorage(projected)).toEqual(sanitizeGeneratedStudioAssetForStorage(asset));
    expect(currentIdentityEvidenceSha256(projected)).toBe(currentIdentityEvidenceSha256(asset));
    expect(currentReferenceIdentityApprovalSha256(projected)).not.toBe(currentReferenceIdentityApprovalSha256(asset));
  });
  for(const change of ["pending","failed","ineligible","threshold","coverage","sample","track","geometry","margin","trim","target","parent","context","reference","model","policy"]){
    test(`rejects ${change} current evidence while retaining the original bank`,()=>{
      const{asset,context,assessment}=currentReferenceIdentityFixture();
      if(assessment.status!=="ready")throw new Error("fixture");
      const proof=assessment.proof,filter=proof.draftSimilarityFilter!;
      switch(change){
        case"pending":context.activeAssessments={};break;
        case"failed":context.assessments[assessment.scope.id]={version:1,scope:assessment.scope,assessedAt:assessment.assessedAt,status:"failed",errorCode:"assessment-failed"};break;
        case"ineligible":filter.status="ineligible";break;
        case"threshold":filter.threshold=.79;break;
        case"coverage":filter.eligibleFrameCount--;break;
        case"sample":filter.samples[0].scores[0].score=.7999;break;
        case"track":filter.samples[1].scores[0].trackId="other";break;
        case"geometry":filter.samples[0].foreground!.detections[0].quality.detectionScore=.89;break;
        case"margin":filter.samples[0].candidateScores![1].score=.89;filter.samples[0].foreground!.detections[1].score=.89;break;
        case"trim":asset.trimStart=(asset.trimStart??0)+1/24;break;
        case"target":asset.target={...asset.target!,songEnd:asset.target!.songEnd+.01};break;
        case"parent":asset.identityVerification={...asset.identityVerification!,reason:"changed"};break;
        case"context":context.contextSha256="d".repeat(64);break;
        case"reference":proof.identityReferenceHashes=["a".repeat(64)];break;
        case"model":proof.verifier.modelSha256="a".repeat(64);break;
        case"policy":proof.evaluationPolicy.body.familySha256="a".repeat(64);break;
      }
      assessment.proofSha256=identityPolicySha256(proof);
      expect(generatedAssetDraftIdentityBlockReason(withCurrentReferenceIdentity([asset],context)[0])).not.toBeNull();
    });
  }
  test("a new passing screen cannot override a rejected or failing original",()=>{
    const{asset,context}=currentReferenceIdentityFixture();asset.identityVerification!.draftSimilarityFilter!.status="ineligible";
    expect(generatedAssetDraftIdentityBlockReason(withCurrentReferenceIdentity([asset],context)[0])).toContain("did not pass");
  });
  test("new explicit activation replaces the active pointer while preserving failed history",()=>{
    const{saved,context,assessment}=currentReferenceIdentityFixture();
    const failed={version:1 as const,scope:{...assessment.scope,requestIntentId:"00000000-0000-4000-8000-000000000002"},status:"failed" as const,assessedAt:"2026-11-07",errorCode:"assessment-failed" as const};
    const{id:_id,...body}=failed.scope;void _id;failed.scope.id=`h3-current-assessment-${identityPolicySha256(body)}`;
    context.assessments[failed.scope.id]=failed;context.activeAssessments[assessment.scope.assetId]=failed.scope.id;
    const candidate=attachCurrentIdentityAssessments(saved.draft,[assessment]);
    expect(candidate.musicVideoProject!.currentIdentity!.assessments[failed.scope.id]).toEqual(failed);
    expect(candidate.musicVideoProject!.currentIdentity!.activeAssessments[assessment.scope.assetId]).toBe(assessment.scope.id);
    expect(candidate.generatedAssets).toBe(saved.draft.generatedAssets);
    expect(attachCurrentIdentityAssessments(saved.draft,[failed]).musicVideoProject!.currentIdentity!.activeAssessments[failed.scope.assetId]).toBe(failed.scope.id);
  });
  test("an old current-context record cannot be adopted after a version change",()=>{
    const{saved,assessment}=currentReferenceIdentityFixture();saved.draft.musicVideoProject!.currentIdentity!.contextSha256="f".repeat(64);
    expect(()=>attachCurrentIdentityAssessments(saved.draft,[assessment])).toThrow("context");
  });
  test("prepared review fingerprint binds active current proof including approved overlays",()=>{
    const{asset,context,gap}=currentReferenceIdentityFixture();
    const draft={planSignature:gap.planSignature!,revision:1,assetIds:[asset.id]};
    const first=captureGeneratedDraftReview([gap],withCurrentReferenceIdentity([asset],context),draft);expect(first).not.toBeNull();
    const before=currentIdentityReviewSha256(context);context.activeAssessments={};
    expect(currentIdentityReviewSha256(context)).not.toBe(before);
    expect(captureGeneratedDraftReview([gap],withCurrentReferenceIdentity([asset],context),draft)).toBeNull();
  });
  test("normal generation reference truth is never inferred from the evaluation policy",()=>{
    const{job,asset,context,currentPolicy}=currentReferenceIdentityFixture();
    const scope=buildCurrentIdentityScope(job,asset,context,currentPolicy,"00000000-0000-4000-8000-000000000009");
    expect(scope.generationReferenceHashes).toEqual(job.referenceHashes);
    currentPolicy.body.originalPolicy.sha256="a".repeat(64);
    expect(()=>buildCurrentIdentityScope(job,asset,context,currentPolicy,"00000000-0000-4000-8000-000000000009")).toThrow("screen");
  });
  test("undefined context removes incoming stale runtime projections",()=>{
    const{asset,context}=currentReferenceIdentityFixture();expect(withCurrentReferenceIdentity(withCurrentReferenceIdentity([asset],context))[0]).toEqual(asset);
  });
  for(const malformed of ["frame-hash","score-string","score-nan","score-missing","track","date","mixed-reference","mixed-generation","mixed-policy"]){
    test(`strict purpose normalization rejects ${malformed} before the numerical screen`,()=>{
      const{asset,context,assessment}=currentReferenceIdentityFixture();if(assessment.status!=="ready")throw new Error("fixture");
      const proof=assessment.proof;
      switch(malformed){
        case"frame-hash":proof.samples[0].frameSha256=proof.draftSimilarityFilter!.samples[0].frameSha256="invalid-frame-hash";break;
        case"score-string":(proof.draftSimilarityFilter!.samples[0].scores[0]as unknown as {score:unknown}).score=".9";break;
        case"score-nan":proof.draftSimilarityFilter!.samples[0].scores[0].score=NaN;break;
        case"score-missing":delete(proof.draftSimilarityFilter!.samples[0].scores[0]as unknown as {score?:number}).score;break;
        case"track":proof.draftSimilarityFilter!.samples[0].scores[0].trackId="";break;
        case"date":proof.assessedAt="invalid";break;
        case"mixed-reference":Object.assign(proof,{referenceHashes:asset.generationReferenceHashes});break;
        case"mixed-generation":Object.assign(proof,{generationReferenceHashes:asset.generationReferenceHashes});break;
        case"mixed-policy":Object.assign(proof,{issuedPolicy:asset.identityVerification!.issuedPolicy});break;
      }
      expect(normalizeCurrentIdentityProof(proof)).toBe(undefined);
      if(malformed!=="score-nan")assessment.proofSha256=identityPolicySha256(proof);
      expect(generatedAssetDraftIdentityBlockReason(withCurrentReferenceIdentity([asset],context)[0])).not.toBeNull();
    });
  }
  test("normalization drops private diagnostics and embedding-shaped extra fields",()=>{
    const{assessment}=currentReferenceIdentityFixture();if(assessment.status!=="ready")throw new Error("fixture");
    const proof=normalizeCurrentIdentityProof({...assessment.proof,diagnostics:{embedding:[.1,.2],secret:"private"},verifier:{...assessment.proof.verifier,embedding:[.1,.2]}});
    expect(proof).not.toBe(undefined);expect(JSON.stringify(proof)).not.toContain('"embedding":');expect(JSON.stringify(proof)).not.toContain("private");
  });
});
