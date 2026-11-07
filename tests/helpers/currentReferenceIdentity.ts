import {issuedDraftAssetFixture} from "./issuedDraftAsset";
import {h3ProjectFixture} from "./h3Project";
import {CURRENT_IDENTITY_PURPOSE,buildCurrentIdentityScope,currentIdentityOrigin,currentIdentityProofOrigin,type CurrentIdentityContext,type CurrentIdentityPolicy,type CurrentIdentityProof,type CurrentIdentityAssessment} from "@/components/studio/currentReferenceIdentity";
import {generationScopeSha256,generationSemanticSha256,type GenerationScopeReceipt} from "@/components/studio/generationScope";
import {identityPolicySha256,issuedGalleryProfileSha256} from "@/components/studio/issuedIdentityPolicy";
/** Synthetic protocol fixtures; these are not an authority certificate or actual face measurements. */
export function currentReferenceIdentityFixture(){
  const fixture=issuedDraftAssetFixture("foreground",2),{job,asset}=fixture,{saved}=h3ProjectFixture();
  saved.project.id=job.projectId;saved.project.ownerId=job.ownerId;saved.revision='"revision-1"';
  const original=fixture.policy,oldHash=original.body.identityReferenceHashes[0],newHash="e".repeat(64);
  const galleries=original.body.galleries.map(gallery=>({...gallery,rawSha256:gallery.rawSha256===oldHash?newHash:gallery.rawSha256}));
  const galleryProfileSha256=issuedGalleryProfileSha256(galleries);
  const body:CurrentIdentityPolicy["body"]={...original.body,version:1,purpose:CURRENT_IDENTITY_PURPOSE,
    originalPolicy:{kind:"issued",id:original.id,sha256:original.sha256},
    references:original.body.references.map(reference=>({...reference,rawSha256:reference.rawSha256===oldHash?newHash:reference.rawSha256})),
    identityReferenceHashes:[newHash],galleries,galleryProfileSha256,
    preprocessVersion:`opencv412-aligncrop112-rgb-f32-nchw-unit-centroid-v1-gallery-v2-${galleryProfileSha256}`};
  const policy:CurrentIdentityPolicy={version:1,id:`h3-current-policy-${identityPolicySha256(body)}`,sha256:identityPolicySha256(body),body};
  const references=body.references.map(reference=>({id:reference.assetId,role:reference.role,kind:reference.role==="identity"?"character":"environment",
    displayName:reference.canonicalName,fileName:`${reference.assetId}.png`,promptHint:"",createdAt:"2026-11-06T00:00:00Z",storageBucket:reference.bucket,storagePath:reference.objectKey,storageStatus:"uploaded"}));
  const project=saved.draft.musicVideoProject!;
  const receiptBody:GenerationScopeReceipt["body"]={version:1,kind:"reference-version-migration",ownerId:job.ownerId,projectId:job.projectId,baselineRevision:saved.revision!,
    fromSourceContext:"old",toSourceContext:project.sourceContextSignature??"old",fromInputSignature:project.placementPlan!.inputSignature,toInputSignature:project.placementPlan!.inputSignature,
    scopeSignature:project.placementPlan!.inputSignature,semanticSha256:generationSemanticSha256(project),references:references as GenerationScopeReceipt["body"]["references"],
    rawReferences:body.references.map(reference=>({assetId:reference.assetId,bucket:reference.bucket,objectKey:reference.objectKey,etag:reference.etag!,sha256:reference.rawSha256,byteLength:10})),
    sourceMediaVersions:[],appendedReferenceIds:[],storySha256:"1".repeat(64),sourceInventorySha256:"2".repeat(64),
    referenceMigration:{version:1,authority:"r31-approved-diego-e71-v1",contextSha256:"c".repeat(64),baselineSha256:"b".repeat(64),adoptionSha256:"a".repeat(64),
      replacements:[{assetId:job.references[0].assetId,fromSha256:oldHash,toSha256:newHash}],historicalReferences:[],origins:[{jobId:job.id,...currentIdentityOrigin(job)}]}};
  const receipt:GenerationScopeReceipt={version:1,id:`generation-scope-${generationScopeSha256(receiptBody)}`,sha256:generationScopeSha256(receiptBody),body:receiptBody};
  const context:CurrentIdentityContext={migrationSha256:receipt.sha256,contextSha256:"c".repeat(64),replacements:receiptBody.referenceMigration!.replacements,assessments:{},activeAssessments:{}};
  const scope=buildCurrentIdentityScope(job,asset,context,policy,"00000000-0000-4000-8000-000000000001");
  const {referenceHashes:_old,issuedPolicy:_issued,...oldProof}=JSON.parse(JSON.stringify(asset.identityVerification!));void _old;void _issued;
  const proof:CurrentIdentityProof={...oldProof,purpose:CURRENT_IDENTITY_PURPOSE,evaluationReferenceHashes:body.references.map(reference=>reference.rawSha256),identityReferenceHashes:[newHash],evaluationPolicy:policy,origin:currentIdentityProofOrigin(scope)};
  proof.verifier.preprocessVersion=body.preprocessVersion;
  proof.draftSimilarityFilter!.policyId=policy.id;proof.draftSimilarityFilter!.policySha256=policy.sha256;
  for(const sample of [...proof.samples,...proof.draftSimilarityFilter!.samples])for(const score of [...sample.scores,...(sample.candidateScores??[])])if(score.referenceHash===oldHash)score.referenceHash=newHash;
  const assessment:CurrentIdentityAssessment={version:1,scope,status:"ready",assessedAt:"2026-11-07T00:00:00Z",proof,proofSha256:identityPolicySha256(proof)};
  context.assessments[scope.id]=assessment;context.activeAssessments[asset.id]=scope.id;
  saved.draft.musicVideoProject={...project,generationScope:receipt,currentIdentity:context};saved.draft.generatedAssets=[asset];
  return {...fixture,saved,receipt,context,currentPolicy:policy,assessment,oldHash,newHash};
}
