import {mkdtemp,readFile,rm,stat,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {CURRENT_IDENTITY_PURPOSE,buildCurrentIdentityScope,buildCurrentIdentityScopeBase,currentIdentityOrigin,normalizeCurrentIdentityProof,
  type CurrentIdentityRequest,type CurrentIdentityContext,type CurrentIdentityScope} from "@/components/studio/currentReferenceIdentity";
import {identityPolicySha256} from "@/components/studio/issuedIdentityPolicy";
import {identityAssessmentAsset} from "@/components/studio/h3IdentityAssessment";
import {sourceConfirmationBaselineSha256} from "@/components/studio/sourceConfirmationClient";
import type {H3GenerationJob} from "@/components/studio/h3Generation";
import type {GenerationScopeReceipt} from "@/components/studio/generationScope";
import type {SavedStudioProject} from "./studioProjectStore";
import {readStudioProject} from "./studioProjectStore";
import {readH3Job} from "./h3JobStore";
import {readH3IdentityAssessment} from "./h3IdentityAssessmentStore";
import {readGenerationScopeReceipt} from "./generationScopeStore";
import {readCurrentIdentityRequest,readCurrentIdentityRequestOutcome,storeCurrentIdentityAssessment,writeCurrentIdentityRequestOutcome,writeCurrentIdentityRequestRun} from "./currentIdentityStore";
import {prepareCurrentIdentityPolicy} from "./currentIdentityPolicyPreparation";
import {executeVerifier} from "./h3IdentityVerification";
import {downloadMediaGatewayFile,getMediaGatewayConfig} from "./mediaGateway";
import {probeMediaFile} from "@/components/studio/mediaProbe";
import {validateH3VideoProbe} from "./h3GenerationRunner";
import {normalizeStudioOwnerSegment} from "./studioStoragePaths";
import {verifyGenerationScopeRawReferences} from "./generationScopeRawReferences";

export function migrationIdentityContext(migration:GenerationScopeReceipt):CurrentIdentityContext {
  const facts=migration.body.referenceMigration;
  if(migration.body.kind!=="reference-version-migration"||!facts)throw new Error("Canonical current-reference migration required.");
  return {migrationSha256:migration.sha256,contextSha256:facts.contextSha256,replacements:facts.replacements,assessments:{},activeAssessments:{}};
}
export async function resolveCurrentIdentitySelection(job:H3GenerationJob,saved:SavedStudioProject,trimStart:number,assessmentId?:string){
  const original=job.result?.asset;
  if(!original||job.state!=="ready"||original.reviewStatus==="rejected"||original.identityVerification?.status==="rejected"
    ||saved.draft.generatedAssets?.some(asset=>(asset.id===original.id||asset.jobId===job.id)&&asset.reviewStatus==="rejected"))throw new Error("Rejected or incomplete canonical takes cannot be reassessed.");
  let selected=original;
  if(assessmentId){const assessment=await readH3IdentityAssessment(job.ownerId,job.projectId,job.id,assessmentId);
    if(!assessment)throw new Error("The canonical historical range assessment is unavailable.");selected=identityAssessmentAsset(assessment,job,trimStart);}
  return {...selected,trimStart};
}
export async function assertCurrentIdentityRequestState(request:CurrentIdentityRequest,saved:SavedStudioProject,job:H3GenerationJob,migration:GenerationScopeReceipt){
  const context=migrationIdentityContext(migration),active=saved.draft.musicVideoProject?.currentIdentity;
  if(saved.project.ownerId!==request.scope.ownerId||saved.project.id!==request.scope.projectId||job.ownerId!==request.scope.ownerId||job.projectId!==request.scope.projectId
    ||saved.revision!==request.expectedRevision||sourceConfirmationBaselineSha256(saved.draft)!==request.baselineSha256
    ||migration.id!==request.migrationId||migration.body.ownerId!==request.scope.ownerId||migration.body.projectId!==request.scope.projectId
    ||(!active&&(migration.body.baselineRevision!==saved.revision||migration.body.referenceMigration!.baselineSha256!==request.baselineSha256))
    ||(active&&(active.migrationSha256!==context.migrationSha256||active.contextSha256!==context.contextSha256
      ||identityPolicySha256(active.replacements)!==identityPolicySha256(context.replacements))))throw new Error("The exact current-reference request baseline changed.");
  const origin=migration.body.referenceMigration!.origins.find(entry=>entry.jobId===job.id);
  if(!origin||identityPolicySha256(origin)!==identityPolicySha256({jobId:job.id,...currentIdentityOrigin(job)}))throw new Error("The historical canonical generation lineage changed.");
  const selected=await resolveCurrentIdentitySelection(job,saved,request.scope.trimStart,request.identityAssessmentId);
  if(identityPolicySha256(buildCurrentIdentityScopeBase(job,selected,context,request.scope.requestIntentId))!==identityPolicySha256(request.scope))throw new Error("The canonical range, proof or target changed.");
  return {context,selected};
}
export async function runCurrentIdentityRequest(ownerId:string,projectId:string,requestId:string,runId:string,options:{stage:(label:string)=>void;runVerifier?:(input:string,output:string)=>Promise<void>;runPreflight?:(input:string,output:string)=>Promise<void>} ){
  const request=await readCurrentIdentityRequest(ownerId,projectId,requestId);
  if(!request)throw new Error("Current-reference request not found.");
  await writeCurrentIdentityRequestRun(request,runId);
  const existing=await readCurrentIdentityRequestOutcome(ownerId,projectId,requestId);if(existing)return existing;
  const folder=await mkdtemp(path.join(tmpdir(),"stack-current-identity-"));let scope:CurrentIdentityScope|undefined;
  try{
    const [saved,job,migration]=await Promise.all([readStudioProject(ownerId,projectId,{fresh:true}),readH3Job(ownerId,projectId,request.scope.jobId),readGenerationScopeReceipt(ownerId,projectId,request.migrationId)]);
    if(!saved||!job||!migration)throw new Error("Canonical current-reference inputs are unavailable.");
    const {context,selected}=await assertCurrentIdentityRequestState(request,saved,job,migration);
    options.stage("Preparing the current approved reference gallery without changing generation history");
    const prepared=await prepareCurrentIdentityPolicy(job,migration,folder,{runPreflight:options.runPreflight});
    scope=buildCurrentIdentityScope(job,selected,context,prepared.policy,request.scope.requestIntentId);
    const config=getMediaGatewayConfig(),storage=job.result!.asset.fullStorage,expected=`media-uploads/projects/${normalizeStudioOwnerSegment(ownerId)}/generated/${projectId}/${job.id}/shot.mp4`;
    if(!config||storage?.bucket!==config.bucket||storage.objectKey!==expected)throw new Error("Current-reference take media is outside its owned job.");
    const media=await downloadMediaGatewayFile({bucket:config.bucket,objectKey:expected,fileName:"shot.mp4"}),bytes=new Uint8Array(media.bytes);
    if(createHash("sha256").update(bytes).digest("hex")!==scope.mediaSha256)throw new Error("Canonical shot bytes changed.");
    const videoPath=path.join(folder,"shot.mp4");await writeFile(videoPath,bytes);
    validateH3VideoProbe(await probeMediaFile(videoPath),scope.frameCount,scope.trimDuration);
    const inputPath=path.join(folder,"current-input.json"),outputPath=path.join(folder,"current-report.json");
    const input={version:1,purpose:CURRENT_IDENTITY_PURPOSE,ownerId,projectId,assetId:scope.assetId,jobId:scope.jobId,generationModel:job.profile,
      origin:{originalJobSha256:scope.originalJobSha256,originalTargetSha256:scope.originalTargetSha256,originalProofSha256:scope.originalProofSha256,selectedProofSha256:scope.selectedProofSha256,contextSha256:scope.contextSha256,generationReferenceHashes:scope.generationReferenceHashes},
      evaluationPolicy:prepared.policy,evaluationReferenceHashes:prepared.policy.body.references.map(reference=>reference.rawSha256),identityReferenceHashes:prepared.policy.body.identityReferenceHashes,
      videoPath,mediaSha256:scope.mediaSha256,frameCount:scope.frameCount,fps:24,durationSeconds:scope.durationSeconds,verifiedStartFrame:scope.firstFrame,verifiedEndFrameExclusive:scope.endFrameExclusive,references:prepared.references};
    await writeFile(inputPath,JSON.stringify(input));options.stage("Checking every intended native frame against the current reference");
    await(options.runVerifier??executeVerifier)(inputPath,outputPath);
    if((await stat(outputPath)).size>2*1024*1024)throw new Error("Current-reference report exceeds its bound.");
    const proof=normalizeCurrentIdentityProof(JSON.parse(await readFile(outputPath,"utf8")));
    if(!proof||proof.purpose!==CURRENT_IDENTITY_PURPOSE||proof.status!=="unverifiable"||proof.assetId!==scope.assetId||proof.jobId!==job.id||proof.mediaSha256!==scope.mediaSha256
      ||proof.frameCount!==scope.frameCount||proof.frameRate!==24||proof.durationSeconds!==scope.durationSeconds||proof.verifiedStartFrame!==scope.firstFrame||proof.verifiedEndFrameExclusive!==scope.endFrameExclusive
      ||identityPolicySha256(proof.origin)!==identityPolicySha256(input.origin)||identityPolicySha256(proof.evaluationPolicy)!==identityPolicySha256(prepared.policy)
      ||identityPolicySha256(proof.evaluationReferenceHashes)!==identityPolicySha256(input.evaluationReferenceHashes)||identityPolicySha256(proof.identityReferenceHashes)!==identityPolicySha256(input.identityReferenceHashes)
      ||!Array.isArray(proof.samples)||!proof.draftSimilarityFilter||!Array.isArray(proof.draftSimilarityFilter.samples))throw new Error("Current-reference report does not match its explicit evaluation binding.");
    const [latest,currentJob]=await Promise.all([readStudioProject(ownerId,projectId,{fresh:true}),readH3Job(ownerId,projectId,job.id)]);
    if(!latest||!currentJob)throw new Error("Current-reference inputs changed during CPU processing.");
    await assertCurrentIdentityRequestState(request,latest,currentJob,migration);
    const relevant=migration.body.rawReferences.filter(reference=>job.references.some(original=>original.assetId===reference.assetId));
    await verifyGenerationScopeRawReferences(ownerId,migration.body.references.filter(reference=>relevant.some(pin=>pin.assetId===reference.id)),relevant);
    const record=await storeCurrentIdentityAssessment({version:1,scope,status:"ready",assessedAt:new Date().toISOString(),proof,proofSha256:identityPolicySha256(proof)});
    const outcome={requestId,status:"ready" as const,assessmentId:record.scope.id};await writeCurrentIdentityRequestOutcome(request,outcome);return outcome;
  }catch(error){
    if(scope)await storeCurrentIdentityAssessment({version:1,scope,status:"failed",assessedAt:new Date().toISOString(),errorCode:"assessment-failed"});
    const outcome={requestId,status:"failed" as const,errorCode:"assessment-failed" as const,...(scope?{assessmentId:scope.id}:{})};await writeCurrentIdentityRequestOutcome(request,outcome);
    options.stage("Current-reference assessment failed; original generation evidence is unchanged");void error;throw new Error("Current-reference assessment failed; original generation evidence is unchanged.");
  }finally{await rm(folder,{recursive:true,force:true});}
}
