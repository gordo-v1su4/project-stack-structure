import type { SavedStudioProject } from "./studioProjectStore";
import type { H3GenerationJob } from "@/components/studio/h3Generation";
import { generationScopeSha256, generationSemanticSha256, sourceReferenceManifest, exactExistingSourceReprise, type GenerationScopeReceipt } from "@/components/studio/generationScope";
import { currentIdentityContextSha256, currentIdentityOrigin } from "@/components/studio/currentReferenceIdentity";
import { placementInputSignature,buildEditPlanPreviewSegments } from "@/components/studio/musicVideoProject";
import { preserveReviewedStoryArrangement } from "@/components/studio/reconfirmStoryProject";
import { buildStoryContentSignature } from "@/components/studio/storyTreatments";
import { buildStudioSourceContextSignature } from "@/components/studio/studioSourceContext";
import { createGeneratedDraftSelection,applyDraftGeneratedAssets } from "@/components/studio/generatedDraft";
import {buildGeneratedAssetPlaybackUrl} from "@/components/studio/generatedAssets";
import { sourceConfirmationBaselineSha256 } from "@/components/studio/sourceConfirmationClient";
import { originalReferences, sourceSha, storySha, SourceConfirmationError } from "./generationScopeServer";
import { pinGenerationScopeRawReferences } from "./generationScopeRawReferences";
import { storeGenerationScopeReceipt } from "./generationScopeStore";
import {readGenerationScopeReceipt} from "./generationScopeStore";
import {readCurrentIdentityAssessment,readCurrentIdentityPolicy} from "./currentIdentityStore";
import {readH3Job} from "./h3JobStore";
import {originalCurrentIdentityPolicy} from "@/components/studio/currentReferenceIdentity";
import type {PersistedStudioProjectDraft} from "@/components/studio/projectPersistence";
import {hydrateStudioProjectDraft} from "@/components/studio/projectPersistence";
import {pinApprovedHistoricalDiegoBackup} from "./historicalIdentityReference";

export function referenceMigrationAdoptionSha256(draft:PersistedStudioProjectDraft){
  const project={...draft.musicVideoProject};delete project.generationScope;delete project.currentIdentity;
  const selection={...draft.generatedDraft};delete selection.sourceConfirmationSha256;
  return sourceConfirmationBaselineSha256({...draft,musicVideoProject:project as NonNullable<PersistedStudioProjectDraft["musicVideoProject"]>,generatedDraft:selection as NonNullable<PersistedStudioProjectDraft["generatedDraft"]>});
}
/** Called inside the conditional named-project update, before its one CAS write. */
export async function validateReferenceMigrationAdoption(ownerId:string,current:SavedStudioProject,candidate:PersistedStudioProjectDraft,expectedRevision:string){
  if(current.project.ownerId!==ownerId||current.revision!==expectedRevision)throw new SourceConfirmationError("The owned conditional project revision changed.");
  const before=current.draft.musicVideoProject?.currentIdentity,after=candidate.musicVideoProject?.currentIdentity;
  if(!before&&!after){if(candidate.musicVideoProject?.generationScope?.body.kind==="reference-version-migration")throw new SourceConfirmationError("A migration requires its current-reference context.");return;}
  if(!after||!candidate.musicVideoProject?.generationScope)throw new SourceConfirmationError("The active current-reference context cannot be removed.");
  const migration=await readGenerationScopeReceipt(ownerId,current.project.id,`generation-scope-${after.migrationSha256}`),facts=migration?.body.referenceMigration;
  if(!migration||migration.body.kind!=="reference-version-migration"||!facts||after.contextSha256!==facts.contextSha256
    ||generationScopeSha256(after.replacements)!==generationScopeSha256(facts.replacements))throw new SourceConfirmationError("The canonical current-reference migration differs.");
  const nextReceipt=candidate.musicVideoProject.generationScope;
  if(nextReceipt.sha256!==migration.sha256&&nextReceipt.body.currentIdentityMigrationSha256!==migration.sha256)throw new SourceConfirmationError("The current-reference migration chain cannot be switched.");
  const canonicalNext=await readGenerationScopeReceipt(ownerId,current.project.id,nextReceipt.id);
  if(!canonicalNext||generationScopeSha256(canonicalNext)!==generationScopeSha256(nextReceipt))throw new SourceConfirmationError("Canonical source confirmation is unavailable.");
  if(before){
    if(before.migrationSha256!==after.migrationSha256||before.contextSha256!==after.contextSha256||generationScopeSha256(before.replacements)!==generationScopeSha256(after.replacements))throw new SourceConfirmationError("The active current-reference context cannot be replaced implicitly.");
    for(const[id,record]of Object.entries(before.assessments))if(generationScopeSha256(after.assessments[id])!==generationScopeSha256(record))throw new SourceConfirmationError("Historical current-reference evidence must be preserved.");
  }else if(current.revision!==expectedRevision||migration.body.baselineRevision!==expectedRevision
    ||sourceConfirmationBaselineSha256(current.draft)!==facts.baselineSha256||referenceMigrationAdoptionSha256(candidate)!==facts.adoptionSha256
    ||Object.keys(after.assessments).length||Object.keys(after.activeAssessments).length)throw new SourceConfirmationError("The prepared migration no longer matches its exact baseline or pending candidate.");
  if(Object.keys(after.assessments).length>128||Object.keys(after.activeAssessments).length>128)throw new SourceConfirmationError("Current-reference evidence exceeds its bound.");
  for(const[id,record]of Object.entries(after.assessments)){
    const canonical=await readCurrentIdentityAssessment(ownerId,current.project.id,id);
    if(!canonical||generationScopeSha256(canonical)!==generationScopeSha256(record)||record.scope.contextSha256!==after.contextSha256||record.scope.migrationSha256!==after.migrationSha256)throw new SourceConfirmationError("Current-reference evidence is not canonical for this project.");
    const job=await readH3Job(ownerId,current.project.id,record.scope.jobId),origin=job&&currentIdentityOrigin(job);
    if(!job||!origin||origin.originalJobSha256!==record.scope.originalJobSha256||origin.originalTargetSha256!==record.scope.originalTargetSha256||origin.originalProofSha256!==record.scope.originalProofSha256)throw new SourceConfirmationError("Current-reference generation lineage changed.");
    if(record.status==="ready"){
      const policy=await readCurrentIdentityPolicy(ownerId,current.project.id,record.scope.policyId);
      if(!policy||generationScopeSha256(policy)!==generationScopeSha256(record.proof.evaluationPolicy)
        ||generationScopeSha256(policy.body.originalPolicy)!==generationScopeSha256(originalCurrentIdentityPolicy(job)))throw new SourceConfirmationError("Current-reference policy is not canonical for this take.");
    }
  }
  for(const[assetId,id]of Object.entries(after.activeAssessments))if(after.assessments[id]?.scope.assetId!==assetId)throw new SourceConfirmationError("Active assessment does not match its take.");
}

/** The approved image replacement is narrow, explicit and distinct from library append equivalence. */
export async function prepareReferenceVersionMigration(params:{ownerId:string;saved:SavedStudioProject;expectedRevision:string;jobs:H3GenerationJob[]}) {
  const {ownerId,saved,expectedRevision,jobs}=params,draft=saved.draft,project=draft.musicVideoProject,story=draft.storyState;
  if(saved.project.ownerId!==ownerId||saved.revision!==expectedRevision||!expectedRevision)throw new SourceConfirmationError("The project revision changed.");
  if(!project?.placementPlan||project.generationScope||project.currentIdentity||!story.storyGenerated||!story.confirmedTreatmentSnapshot
    ||story.confirmedTreatmentId!==story.confirmedTreatmentSnapshot.id||story.confirmedTreatmentSnapshot.reconciliation?.status==="pending"
    ||story.storyContentSignature!==buildStoryContentSignature(story.confirmedTreatmentSnapshot,story.storyBeats)
    ||story.confirmedSourceContextSignature!==project.sourceContextSignature)throw new SourceConfirmationError("The unchanged confirmed historical arrangement is required.");
  if(jobs.length>128||jobs.some(job=>job.ownerId!==ownerId||job.projectId!==saved.project.id))throw new SourceConfirmationError("Generation history exceeds its owned scope.");
  const replacement={assetId:"character-1-1788717231561-sy1hpa",fromSha256:"47d772694e0c14397707f31b7802fe91d434da1e4b54be7bac3eb00037364381",toSha256:"e71f4d4325a61641d98de57604ff09e425aeefd07f994606f189c06f88c47c4a"};
  const oldScope=placementInputSignature(project,project.placementPlan.settings);
  const original=await originalReferences(ownerId,saved.project.id,draft,jobs,oldScope,replacement);
  const historicalBackup=await pinApprovedHistoricalDiegoBackup(ownerId,saved.project.id,original.rawReferences[0].bucket);
  const added=(draft.referenceAssets??[]).filter(reference=>!original.references.some(entry=>entry.id===reference.id));
  const storyText=JSON.stringify({sections:project.storySections,items:project.editPlan.timelineItems,treatment:story.confirmedTreatmentSnapshot,beats:story.storyBeats}).toLowerCase();
  if(new Set((draft.referenceAssets??[]).map(reference=>reference.id)).size!==(draft.referenceAssets??[]).length
    ||added.some(reference=>!reference.displayName.trim()||storyText.includes(reference.displayName.trim().toLowerCase())||jobs.some(job=>job.references.some(ref=>ref.assetId===reference.id))))
    throw new SourceConfirmationError("Supplemental references must remain unrelated to this historical arrangement.");
  const rawReferences=[...original.rawReferences,...await pinGenerationScopeRawReferences(ownerId,sourceReferenceManifest(added))].sort((a,b)=>a.assetId.localeCompare(b.assetId));
  const contextSha256=currentIdentityContextSha256(original.rawReferences);
  const currentContext=buildStudioSourceContextSignature({analysis:draft.analysis?{...draft.analysis,audioUrl:draft.analysis.storageUrl??""}:null,
    videoSources:draft.videoSources.map(source=>({...source,videoUrl:source.storageUrl??""})),referenceAssets:draft.referenceAssets??[]});
  const reprise=exactExistingSourceReprise(saved.project.id,project);
  const next=preserveReviewedStoryArrangement(project,{...project,sourceContextSignature:currentContext,
    placementPlan:{...project.placementPlan,inputSignature:placementInputSignature({...project,sourceContextSignature:currentContext})}},reprise);
  const body:GenerationScopeReceipt["body"]={version:1,kind:"reference-version-migration",ownerId,projectId:saved.project.id,baselineRevision:expectedRevision,
    fromSourceContext:project.sourceContextSignature!,toSourceContext:currentContext,fromInputSignature:oldScope,toInputSignature:next.placementPlan!.inputSignature,
    scopeSignature:oldScope,semanticSha256:generationSemanticSha256(next),references:sourceReferenceManifest(draft.referenceAssets??[]),rawReferences,
    sourceMediaVersions:original.sourceMediaVersions,appendedReferenceIds:added.map(reference=>reference.id).sort(),storySha256:storySha(draft),sourceInventorySha256:sourceSha(draft),
    referenceMigration:{version:1,authority:"r31-approved-diego-e71-v1",contextSha256,baselineSha256:sourceConfirmationBaselineSha256(draft),adoptionSha256:"0".repeat(64),replacements:[replacement],historicalReferences:original.historicalReferences,historicalBackups:[historicalBackup],
      origins:jobs.filter(job=>job.target.planSignature===oldScope&&job.state==="ready"&&job.result).map(job=>({jobId:job.id,...currentIdentityOrigin(job)})).sort((a,b)=>a.jobId.localeCompare(b.jobId))},...(reprise?{reprise}:{})};
  const sha256=generationScopeSha256(body),receipt:GenerationScopeReceipt={version:1,id:`generation-scope-${sha256}`,sha256,body};
  const oldDraft=draft.generatedDraft??createGeneratedDraftSelection(oldScope);
  if(oldDraft.planSignature!==oldScope)throw new SourceConfirmationError("The selected draft differs from the historical arrangement.");
  const runtime=hydrateStudioProjectDraft({draft:{...draft,musicVideoProject:{...next,generationScope:receipt}}});
  const base=buildEditPlanPreviewSegments({project:runtime.musicVideoProject,videoSources:runtime.videoSources,editSettings:story.editSettings});
  const actual=applyDraftGeneratedAssets(base,runtime.generatedAssets,oldDraft),visible=new Set(actual.map(segment=>segment.videoUrl));
  const requeued=runtime.generatedAssets.filter(asset=>asset.reviewStatus==="approved"&&!oldDraft.assetIds.includes(asset.id)&&visible.has(buildGeneratedAssetPlaybackUrl(asset)??""))
    .sort((a,b)=>Date.parse(a.approvedAt??a.createdAt)-Date.parse(b.approvedAt??b.createdAt)).map(asset=>asset.id);
  body.referenceMigration!.requeuedApprovedAssetIds=requeued;
  const candidate={...draft,musicVideoProject:{...next,generationScope:receipt,currentIdentity:{migrationSha256:sha256,contextSha256,replacements:[replacement],assessments:{},activeAssessments:{}}},
    storyState:{...story,confirmedSourceContextSignature:currentContext},
    generatedDraft:{...oldDraft,revision:oldDraft.revision+1,assetIds:[...requeued,...oldDraft.assetIds],sourceConfirmationSha256:sha256,sourceReviewRequired:true,currentIdentityApprovalSha256:undefined},
    workflowUiSettings:{...draft.workflowUiSettings,committedSplit:undefined,finalExport:undefined,finalExportIntent:undefined}};
  body.referenceMigration!.adoptionSha256=referenceMigrationAdoptionSha256(candidate);
  receipt.sha256=generationScopeSha256(body);receipt.id=`generation-scope-${receipt.sha256}`;
  candidate.musicVideoProject.currentIdentity.migrationSha256=receipt.sha256;candidate.generatedDraft.sourceConfirmationSha256=receipt.sha256;
  await storeGenerationScopeReceipt(receipt);
  return {draft:candidate,receipt,expectedRevision,baselineSha256:sourceConfirmationBaselineSha256(draft)};
}
