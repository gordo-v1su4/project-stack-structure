import type {GeneratedStudioAsset} from "@/components/studio/generatedAssets";
import type {H3GenerationJob} from "@/components/studio/h3Generation";
import {currentIdentityOrigin,originalCurrentIdentityPolicy,withCurrentReferenceIdentity,type CurrentIdentityContext} from "@/components/studio/currentReferenceIdentity";
import {identityPolicySha256} from "@/components/studio/issuedIdentityPolicy";
import {readCurrentIdentityAssessment,readCurrentIdentityPolicy} from "./currentIdentityStore";

/** Inline UI evidence is a cache. Every acceptance boundary retrieves its canonical worker record and policy. */
export async function canonicalCurrentIdentityAsset(ownerId:string,projectId:string,job:H3GenerationJob,asset:GeneratedStudioAsset,context?:CurrentIdentityContext){
  const projected=withCurrentReferenceIdentity([asset],context)[0],binding=projected.currentReferenceIdentity;
  if(!binding?.required)return projected;
  const inline=binding.assessment;
  if(!inline)return projected;
  const record=await readCurrentIdentityAssessment(ownerId,projectId,inline.scope.id);
  if(!record||identityPolicySha256(record)!==identityPolicySha256(inline))throw new Error("Canonical current-reference assessment differs from its project binding.");
  const origin=currentIdentityOrigin(job);
  if(record.scope.jobId!==job.id||record.scope.assetId!==asset.id||record.scope.originalJobSha256!==origin.originalJobSha256
    ||record.scope.originalProofSha256!==origin.originalProofSha256||record.scope.originalTargetSha256!==origin.originalTargetSha256
    ||record.scope.migrationSha256!==context!.migrationSha256||record.scope.contextSha256!==context!.contextSha256)throw new Error("Current-reference historical lineage changed.");
  if(record.status==="ready"){
    const policy=await readCurrentIdentityPolicy(ownerId,projectId,record.scope.policyId);
    if(!policy||identityPolicySha256(policy)!==identityPolicySha256(record.proof.evaluationPolicy)
      ||policy.sha256!==record.scope.policySha256||identityPolicySha256(policy.body.originalPolicy)!==identityPolicySha256(originalCurrentIdentityPolicy(job)))throw new Error("Canonical current-reference evaluation policy changed.");
  }
  return projected;
}
