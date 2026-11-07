import type { H3GenerationJob } from "./h3Generation";
import type { GeneratedStudioAsset, GeneratedAssetIdentityVerification } from "./generatedAssets";
import type { H3PolicyGallery, H3PolicyRawReference, H3IdentityPolicyFamilyId } from "./issuedIdentityPolicy";
import { getH3PolicyFamily, identityPolicySha256,currentIdentityEvidenceSha256,normalizeGallery,issuedGalleryProfileSha256 } from "./issuedIdentityPolicy";
import { h3IdentityAssessmentTrimWindow } from "./h3IdentityAssessment";
import {normalizeIdentityFrameEvidence} from "./generatedAssetIdentity";
import { resolveH3DraftSimilarityPolicy } from "./identityDraftPolicy";

export const CURRENT_IDENTITY_PURPOSE = "current-reference-assessment-v1" as const;
export type CurrentIdentityPolicy = { version: 1; id: string; sha256: string; body: {
  version: 1; purpose: typeof CURRENT_IDENTITY_PURPOSE; ownerId: string; projectId: string;
  generationModel: string; familyId: H3IdentityPolicyFamilyId; familySha256: string;
  originalPolicy: { kind: "legacy" | "issued"; id: string; sha256: string };
  references: H3PolicyRawReference[]; identityReferenceHashes: string[]; galleries: H3PolicyGallery[];
  galleryProfileSha256: string; preprocessVersion: string;
} };
export type CurrentIdentityScope = { version: 1; purpose: typeof CURRENT_IDENTITY_PURPOSE; id: string;
  requestIntentId: string; ownerId: string; projectId: string; jobId: string; assetId: string;
  migrationSha256: string; contextSha256: string; originalJobSha256: string; originalTargetSha256: string;
  originalProofSha256: string; selectedProofSha256: string; generationReferenceHashes: string[];
  mediaSha256: string; frameCount: number; frameRate: 24; durationSeconds: number;
  trimStart: number; trimDuration: number; firstFrame: number; endFrameExclusive: number;
  policyId: string; policySha256: string;
};
export type CurrentIdentityProof = Omit<GeneratedAssetIdentityVerification, "referenceHashes" | "issuedPolicy"> & {
  purpose: typeof CURRENT_IDENTITY_PURPOSE; evaluationReferenceHashes: string[]; evaluationPolicy: CurrentIdentityPolicy;
  origin:Pick<CurrentIdentityScope,"originalJobSha256"|"originalTargetSha256"|"originalProofSha256"|"selectedProofSha256"|"contextSha256"|"generationReferenceHashes">;
};
export function currentIdentityProofOrigin(scope:CurrentIdentityScope):CurrentIdentityProof["origin"]{
  return {originalJobSha256:scope.originalJobSha256,originalTargetSha256:scope.originalTargetSha256,originalProofSha256:scope.originalProofSha256,
    selectedProofSha256:scope.selectedProofSha256,contextSha256:scope.contextSha256,generationReferenceHashes:[...scope.generationReferenceHashes]};
}
/** Shares strict frame/score normalization without reinterpreting evaluation references as generation inputs. */
export function normalizeCurrentIdentityProof(value:unknown):CurrentIdentityProof|undefined{
  try{
    if(!value||typeof value!=="object")return undefined;
    const proof=value as CurrentIdentityProof&Record<string,unknown>,common=normalizeIdentityFrameEvidence(value),policy=proof.evaluationPolicy,body=policy?.body;
    const validHash=(hash:unknown):hash is string=>typeof hash==="string"&&/^[a-f0-9]{64}$/.test(hash);
    const validHashes=(hashes:unknown):hashes is string[]=>Array.isArray(hashes)&&hashes.length>0&&hashes.length<=32&&hashes.every(validHash)&&new Set(hashes).size===hashes.length;
    if(!common||common.status!=="unverifiable"||proof.purpose!==CURRENT_IDENTITY_PURPOSE
      ||"referenceHashes"in proof||"generationReferenceHashes"in proof||"issuedPolicy"in proof
      ||!validHashes(proof.evaluationReferenceHashes)||!validHashes(proof.identityReferenceHashes)||!proof.identityReferenceHashes.every(hash=>proof.evaluationReferenceHashes.includes(hash))
      ||!proof.origin||![proof.origin.originalJobSha256,proof.origin.originalTargetSha256,proof.origin.originalProofSha256,proof.origin.selectedProofSha256,proof.origin.contextSha256].every(validHash)
      ||!validHashes(proof.origin.generationReferenceHashes)||!body||body.version!==1||body.purpose!==CURRENT_IDENTITY_PURPOSE||policy.version!==1
      ||policy.sha256!==identityPolicySha256(body)||policy.id!==`h3-current-policy-${policy.sha256}`||!body.ownerId||!body.projectId||!body.originalPolicy
      ||!["legacy","issued"].includes(body.originalPolicy.kind)||!validHash(body.originalPolicy.sha256)
      ||!Array.isArray(body.references)||body.references.length<1||body.references.length>32||new Set(body.references.map(reference=>reference.assetId)).size!==body.references.length
      ||body.references.some(reference=>![reference.assetId,reference.canonicalName,reference.bucket,reference.objectKey,reference.version,reference.etag].every(value=>typeof value==="string"&&value.length>0&&value.length<=2048)||!validHash(reference.rawSha256)))return undefined;
    const family=getH3PolicyFamily(body.familyId),identities=body.references.filter(reference=>reference.role==="identity");
    if(!family||body.familySha256!==family.sha256||identities.length!==family.scope.requiredIdentityCount||!Array.isArray(body.galleries)||body.galleries.length!==identities.length
      ||identityPolicySha256(body.references.map(reference=>reference.rawSha256))!==identityPolicySha256(proof.evaluationReferenceHashes)
      ||identityPolicySha256(identities.map(reference=>reference.rawSha256))!==identityPolicySha256(proof.identityReferenceHashes)
      ||identityPolicySha256(body.identityReferenceHashes)!==identityPolicySha256(proof.identityReferenceHashes))return undefined;
    const galleries=identities.map((reference,index)=>normalizeGallery(body.galleries[index],reference,family));
    if(galleries.some(gallery=>!gallery)||issuedGalleryProfileSha256(galleries as NonNullable<typeof galleries[number]>[])!==body.galleryProfileSha256
      ||body.preprocessVersion!==`${family.model.preprocessBaseVersion}-gallery-v2-${body.galleryProfileSha256}`)return undefined;
    if(body.originalPolicy.kind==="legacy"){
      const old=resolveH3DraftSimilarityPolicy(body.originalPolicy.id,body.originalPolicy.sha256);
      if(!old||"foregroundDominance"in old||"galleryBindings"in old||old.generationModel!==body.generationModel||family.id!=="sface-yunet-foreground-frontal-v1")return undefined;
    }else if(body.originalPolicy.id!==`h3-policy-${body.originalPolicy.sha256}`)return undefined;
    return {...common,purpose:CURRENT_IDENTITY_PURPOSE,evaluationReferenceHashes:[...proof.evaluationReferenceHashes],identityReferenceHashes:[...proof.identityReferenceHashes],evaluationPolicy:policy,
      origin:{originalJobSha256:proof.origin.originalJobSha256,originalTargetSha256:proof.origin.originalTargetSha256,originalProofSha256:proof.origin.originalProofSha256,
        selectedProofSha256:proof.origin.selectedProofSha256,contextSha256:proof.origin.contextSha256,generationReferenceHashes:[...proof.origin.generationReferenceHashes]}};
  }catch{return undefined;}
}
export type CurrentIdentityAssessment = { version: 1; scope: CurrentIdentityScope; assessedAt: string } & (
  { status: "ready"; proofSha256: string; proof: CurrentIdentityProof } | { status: "failed"; errorCode: "assessment-failed" }
);
export type CurrentIdentityContext = { migrationSha256: string; contextSha256: string;
  replacements: { assetId: string; fromSha256: string; toSha256: string }[];
  assessments: Record<string, CurrentIdentityAssessment>;
  activeAssessments: Record<string,string>;
};
export type CurrentIdentityRuntimeBinding = { required: boolean; context: CurrentIdentityContext; assessment?: CurrentIdentityAssessment };
export type CurrentIdentityRequest = {version:1;id:string;migrationId:string;expectedRevision:string;baselineSha256:string;
  identityAssessmentId?:string; scope:Omit<CurrentIdentityScope,"id"|"policyId"|"policySha256">};
export function buildCurrentIdentityRequest(input:Omit<CurrentIdentityRequest,"version"|"id">):CurrentIdentityRequest {
  const {id:_id,version:_version,...clean}=input as CurrentIdentityRequest;void _id;void _version;
  const body={version:1 as const,...clean};return {...body,id:`h3-current-request-${identityPolicySha256(body)}`};
}
export function attachCurrentIdentityAssessments<T extends {musicVideoProject: {currentIdentity?:CurrentIdentityContext}|null;generatedDraft?: {revision:number;sourceReviewRequired?:boolean}|null}>(candidate:T,records:CurrentIdentityAssessment[]):T {
  const context=candidate.musicVideoProject?.currentIdentity;
  if(!context)throw new Error("A verified current-reference migration is required.");
  const assessments={...context.assessments};
  const activeAssessments={...context.activeAssessments};
  if(new Set(records.map(record=>record.scope.assetId)).size!==records.length)throw new Error("Choose one explicit assessment per take.");
  for(const record of records){
    const {id,...scope}=record.scope;
    if(record.version!==1||record.scope.contextSha256!==context.contextSha256||record.scope.migrationSha256!==context.migrationSha256
      ||id!==`h3-current-assessment-${identityPolicySha256(scope)}`||(record.status==="ready"&&identityPolicySha256(record.proof)!==record.proofSha256))
      throw new Error("Assessment does not match this current-reference context.");
    if(assessments[id]&&identityPolicySha256(assessments[id])!==identityPolicySha256(record))throw new Error("A canonical assessment cannot be replaced.");
    assessments[id]=record;
    activeAssessments[record.scope.assetId]=id;
  }
  return {...candidate,musicVideoProject:{...candidate.musicVideoProject!,currentIdentity:{...context,assessments,activeAssessments}},
    ...(candidate.generatedDraft?{generatedDraft:{...candidate.generatedDraft,revision:candidate.generatedDraft.revision+1,sourceReviewRequired:true}}:{})};
}
export const currentIdentityPolicySha256 = (body: CurrentIdentityPolicy["body"]) => identityPolicySha256(body);
export function currentReferenceIdentityApprovalSha256(asset:GeneratedStudioAsset){
  const binding=asset.currentReferenceIdentity;
  return identityPolicySha256({historicalEvidenceSha256:currentIdentityEvidenceSha256(asset),...(binding?{migrationSha256:binding.context.migrationSha256,
    contextSha256:binding.context.contextSha256,required:binding.required,...(binding.assessment?{assessment:binding.assessment}:{})}:{})});
}
export function currentIdentityReviewSha256(context:CurrentIdentityContext){
  return identityPolicySha256({migrationSha256:context.migrationSha256,contextSha256:context.contextSha256,
    active:Object.entries(context.activeAssessments??{}).sort(([a],[b])=>a.localeCompare(b)).map(([assetId,id])=>({assetId,id,recordSha256:identityPolicySha256(context.assessments[id])}))});
}
export function currentIdentityContextSha256(references: readonly { assetId: string; sha256: string; etag: string }[]) {
  return identityPolicySha256([...references].sort((a,b)=>a.assetId.localeCompare(b.assetId)));
}
export function currentIdentityOrigin(job: H3GenerationJob) {
  return { originalJobSha256: identityPolicySha256(job), originalTargetSha256: identityPolicySha256(job.target),
    originalProofSha256: identityPolicySha256(job.result?.asset.identityVerification) };
}
export function originalCurrentIdentityPolicy(job: H3GenerationJob): CurrentIdentityPolicy["body"]["originalPolicy"] {
  if(job.identityPolicy)return {kind:"issued",id:job.identityPolicy.id,sha256:job.identityPolicy.sha256};
  const filter=job.result?.asset.identityVerification?.draftSimilarityFilter;
  const fixed=filter&&resolveH3DraftSimilarityPolicy(filter.policyId,filter.policySha256);
  if(!fixed||"galleryBindings" in fixed||"foregroundDominance" in fixed)throw new Error("Unsupported historical current-identity policy.");
  return {kind:"legacy",id:fixed.id,sha256:fixed.sha256};
}
export function buildCurrentIdentityScopeBase(job: H3GenerationJob, selected: GeneratedStudioAsset, context: CurrentIdentityContext, requestIntentId: string): Omit<CurrentIdentityScope,"id"|"policyId"|"policySha256"> {
  const original=job.result?.asset, window=h3IdentityAssessmentTrimWindow(selected);
  if(job.state!=="ready"||!original||original.id!==selected.id||original.reviewStatus==="rejected"||selected.reviewStatus==="rejected"
    ||!original.identityVerification||!selected.identityVerification||original.identityVerification.status==="rejected"||!original.mediaSha256||original.mediaSha256!==selected.mediaSha256
    ||!Number.isSafeInteger(original.mediaFrameCount)||original.mediaFrameCount!==job.frames||original.mediaFrameRate!==24
    ||selected.mediaFrameCount!==original.mediaFrameCount||selected.mediaFrameRate!==24||selected.durationSeconds!==original.durationSeconds
    ||identityPolicySha256(original.target)!==identityPolicySha256(selected.target)||!job.referenceHashes?.length
    ||!/^([a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/i.test(requestIntentId)
)
    throw new Error("Current identity assessment requires the exact unrejected canonical take and family.");
  const body={version:1 as const,purpose:CURRENT_IDENTITY_PURPOSE,requestIntentId,ownerId:job.ownerId,projectId:job.projectId,
    jobId:job.id,assetId:original.id,migrationSha256:context.migrationSha256,contextSha256:context.contextSha256,...currentIdentityOrigin(job),
    selectedProofSha256:identityPolicySha256(selected.identityVerification),generationReferenceHashes:[...job.referenceHashes],
    mediaSha256:original.mediaSha256,frameCount:original.mediaFrameCount!,frameRate:24 as const,durationSeconds:original.durationSeconds!,
    trimStart:window.trimStart,trimDuration:window.targetDuration,firstFrame:window.firstFrame,endFrameExclusive:window.endFrameExclusive};
  return body;
}
export function buildCurrentIdentityScope(job:H3GenerationJob,selected:GeneratedStudioAsset,context:CurrentIdentityContext,policy:CurrentIdentityPolicy,requestIntentId:string):CurrentIdentityScope {
  if(policy.body.ownerId!==job.ownerId||policy.body.projectId!==job.projectId||policy.body.generationModel!==job.profile
    ||identityPolicySha256(policy.body.originalPolicy)!==identityPolicySha256(originalCurrentIdentityPolicy(job))
    ||(job.identityPolicy&&(policy.body.familyId!==job.identityPolicy.familyId||policy.body.familySha256!==job.identityPolicy.familySha256))
    ||policy.sha256!==currentIdentityPolicySha256(policy.body)||policy.id!==`h3-current-policy-${policy.sha256}`)throw new Error("Current-reference policy differs from the original numerical screen.");
  const body={...buildCurrentIdentityScopeBase(job,selected,context,requestIntentId),policyId:policy.id,policySha256:policy.sha256};
  return {...body,id:`h3-current-assessment-${identityPolicySha256(body)}`};
}
export function currentIdentityAssessmentForAsset(asset: GeneratedStudioAsset, context: CurrentIdentityContext) {
  let window: ReturnType<typeof h3IdentityAssessmentTrimWindow>;
  try { window=h3IdentityAssessmentTrimWindow(asset); } catch { return undefined; }
  const record=context.assessments[context.activeAssessments?.[asset.id]];
  return record&&record.scope.contextSha256===context.contextSha256
    &&record.scope.assetId===asset.id&&record.scope.jobId===asset.jobId&&record.scope.mediaSha256===asset.mediaSha256
    &&record.scope.originalTargetSha256===identityPolicySha256(asset.target)
    &&record.scope.selectedProofSha256===identityPolicySha256(asset.identityVerification)
    &&record.scope.trimStart===window.trimStart&&record.scope.trimDuration===window.targetDuration
    &&record.scope.firstFrame===window.firstFrame&&record.scope.endFrameExclusive===window.endFrameExclusive?record:undefined;
}
/** Runtime projection only: storage sanitization omits the projection, preserving original bank records. */
export function stripCurrentReferenceIdentity(assets: GeneratedStudioAsset[]) {
  return assets.map(asset=>{
    if(!Object.prototype.hasOwnProperty.call(asset,"currentReferenceIdentity"))return asset;
    const {currentReferenceIdentity:_previous,...original}=asset;void _previous;return original;
  });
}
export function withCurrentReferenceIdentity(assets: GeneratedStudioAsset[], context?: CurrentIdentityContext):GeneratedStudioAsset[] {
  return stripCurrentReferenceIdentity(assets).map(original=>{
    if(!context)return original;
    const required=context.replacements.some(replacement=>original.identityReferenceHashes?.includes(replacement.fromSha256));
    return {...original,currentReferenceIdentity:{required,context,...(required?{assessment:currentIdentityAssessmentForAsset(original,context)}:{})}};
  });
}
function currentReferenceIdentityBindingBlockReasonUnchecked(asset: GeneratedStudioAsset): string | null {
  const binding=asset.currentReferenceIdentity;
  if(!binding?.required)return null;
  const record=binding.assessment, scope=record?.scope;
  const {id:_id,...scopeBody}=scope??{};void _id;
  if(!record||record.status!=="ready"||!scope||scope.contextSha256!==binding.context.contextSha256||scope.migrationSha256!==binding.context.migrationSha256
    ||scope.id!==`h3-current-assessment-${identityPolicySha256(scopeBody)}`
    ||currentIdentityAssessmentForAsset(asset,binding.context)?.scope.id!==scope.id
    ||identityPolicySha256(record.proof)!==record.proofSha256)return "Current approved reference requires an exact range assessment";
  const proof=normalizeCurrentIdentityProof(record.proof);
  if(!proof||identityPolicySha256(proof)!==record.proofSha256)return "Current-reference frame evidence is malformed";
  const policy=proof.evaluationPolicy,family=getH3PolicyFamily(policy?.body.familyId??"");
  if(!family||proof.purpose!==CURRENT_IDENTITY_PURPOSE||policy.body.purpose!==CURRENT_IDENTITY_PURPOSE
    ||policy.sha256!==identityPolicySha256(policy.body)||policy.id!==`h3-current-policy-${policy.sha256}`
    ||scope.policyId!==policy.id||scope.policySha256!==policy.sha256||policy.body.familySha256!==family.sha256
    ||proof.origin.originalJobSha256!==scope.originalJobSha256||proof.origin.originalTargetSha256!==scope.originalTargetSha256||proof.origin.originalProofSha256!==scope.originalProofSha256
    ||proof.origin.selectedProofSha256!==scope.selectedProofSha256||proof.origin.contextSha256!==scope.contextSha256||identityPolicySha256(proof.origin.generationReferenceHashes)!==identityPolicySha256(scope.generationReferenceHashes)
    ||proof.assetId!==asset.id||proof.jobId!==asset.jobId||proof.mediaSha256!==asset.mediaSha256
    ||proof.frameCount!==scope.frameCount||proof.frameRate!==24||proof.durationSeconds!==scope.durationSeconds
    ||proof.verifiedStartFrame!==scope.firstFrame||proof.verifiedEndFrameExclusive!==scope.endFrameExclusive
    ||identityPolicySha256(proof.evaluationReferenceHashes)!==identityPolicySha256(policy.body.references.map(reference=>reference.rawSha256))
    ||identityPolicySha256(proof.identityReferenceHashes)!==identityPolicySha256(policy.body.identityReferenceHashes)
    ||binding.context.replacements.some(replacement=>asset.identityReferenceHashes?.includes(replacement.fromSha256)
      &&!proof.identityReferenceHashes.includes(replacement.toSha256)))return "Current-reference evidence does not match its canonical context";
  return null;
}
export function currentReferenceIdentityBindingBlockReason(asset:GeneratedStudioAsset):string|null{
  try{return currentReferenceIdentityBindingBlockReasonUnchecked(asset);}catch{return "Current-reference frame evidence is malformed";}
}
