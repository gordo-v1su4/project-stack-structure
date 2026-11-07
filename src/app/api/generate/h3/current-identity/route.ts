import {getSessionUser,unauthorizedResponse} from "@/lib/session";
import {readStudioProject} from "@/lib/studioProjectStore";
import {readH3Job} from "@/lib/h3JobStore";
import {readGenerationScopeReceipt} from "@/lib/generationScopeStore";
import {buildCurrentIdentityRequest,buildCurrentIdentityScopeBase} from "@/components/studio/currentReferenceIdentity";
import {sourceConfirmationBaselineSha256} from "@/components/studio/sourceConfirmationClient";
import {assertCurrentIdentityRequestState,migrationIdentityContext,resolveCurrentIdentitySelection} from "@/lib/currentIdentityRunner";
import {claimCurrentIdentityRequest,readCurrentIdentityAssessment,readCurrentIdentityRequest,readCurrentIdentityRequestOutcome,readCurrentIdentityRequestRun,writeCurrentIdentityRequestRun} from "@/lib/currentIdentityStore";
import {triggerCurrentIdentityRequest} from "@/lib/triggerOrchestration";
import {studioJsonResponse} from "@/lib/studioJsonTransportServer";
export const runtime="nodejs";
export async function POST(request:Request){
  const user=await getSessionUser();if(!user)return unauthorizedResponse();
  let submissionMayExist=false;
  try{
    const text=await request.text();if(text.length>4096)throw new Error("Metadata bound");
    const input=JSON.parse(text);
    if(typeof input.projectId!=="string"||!/^[\w-]{1,96}$/.test(input.projectId)||typeof input.expectedRevision!=="string"||input.expectedRevision.length>200
      ||typeof input.migrationId!=="string"||!/^generation-scope-[a-f0-9]{64}$/.test(input.migrationId)||typeof input.jobId!=="string"||!/^h3-[a-f0-9]{64}$/.test(input.jobId)
      ||typeof input.assetId!=="string"||typeof input.trimStart!=="number"||!Number.isFinite(input.trimStart)||typeof input.requestIntentId!=="string")throw new Error("Invalid explicit request");
    const [saved,job,migration]=await Promise.all([readStudioProject(user.id,input.projectId,{fresh:true}),readH3Job(user.id,input.projectId,input.jobId),readGenerationScopeReceipt(user.id,input.projectId,input.migrationId)]);
    if(!saved||!job||!migration||saved.revision!==input.expectedRevision||job.result?.asset.id!==input.assetId)throw new Error("Owned canonical inputs changed");
    const selected=await resolveCurrentIdentitySelection(job,saved,input.trimStart,input.identityAssessmentId);
    const current=buildCurrentIdentityRequest({migrationId:migration.id,expectedRevision:input.expectedRevision,baselineSha256:sourceConfirmationBaselineSha256(saved.draft),
      ...(input.identityAssessmentId?{identityAssessmentId:input.identityAssessmentId}:{}),scope:buildCurrentIdentityScopeBase(job,selected,migrationIdentityContext(migration),input.requestIntentId)});
    await assertCurrentIdentityRequestState(current,saved,job,migration);
    // A claim can have persisted even when its acknowledgement is lost. From here recovery is GET-only.
    submissionMayExist=true;
    await claimCurrentIdentityRequest(current);
    const existingRun=await readCurrentIdentityRequestRun(user.id,input.projectId,current.id);
    const handle=existingRun??{runId:(await triggerCurrentIdentityRequest(job,current)).id};
    await writeCurrentIdentityRequestRun(current,handle.runId);
    return studioJsonResponse(request,{success:true,request:current,runId:handle.runId},202);
  }catch{return Response.json(submissionMayExist
    ?{success:false,code:"SUBMISSION_UNKNOWN",error:"The assessment may have been submitted. Recover this exact intent using a read-only lookup."}
    :{success:false,code:"CHECK_NOT_SUBMITTED",error:"The current-reference assessment could not bind this exact owned project, shot and range."},
    {status:submissionMayExist?503:409,headers:{"cache-control":"no-store"}});}
}
export async function GET(request:Request){
  const user=await getSessionUser();if(!user)return unauthorizedResponse();
  try{
    const query=new URL(request.url).searchParams,projectId=query.get("projectId");
    if(!projectId||!/^[\w-]{1,96}$/.test(projectId)||!await readStudioProject(user.id,projectId,{fresh:true}))return Response.json({success:false,error:"Project not found."},{status:404});
    const assessmentId=query.get("assessmentId");
    if(assessmentId){const assessment=await readCurrentIdentityAssessment(user.id,projectId,assessmentId);return studioJsonResponse(request,{success:true,assessment});}
    const id=query.get("requestId")??query.get("requestIntentId");
    if(!id||!(/^(?:h3-current-request-[a-f0-9]{64}|[a-f0-9-]{36})$/i).test(id))throw new Error("Missing or invalid exact request");
    const current=await readCurrentIdentityRequest(user.id,projectId,id);
    if(!current)return Response.json({success:false,code:"CURRENT_IDENTITY_REQUEST_NOT_FOUND",request:null,assessment:null},
      {status:404,headers:{"cache-control":"no-store"}});
    const [outcome,run]=await Promise.all([readCurrentIdentityRequestOutcome(user.id,projectId,current.id),readCurrentIdentityRequestRun(user.id,projectId,current.id)]);
    const assessment=outcome?.assessmentId?await readCurrentIdentityAssessment(user.id,projectId,outcome.assessmentId):null;
    return studioJsonResponse(request,{success:true,request:current,runId:run?.runId??null,outcome,assessment});
  }catch{return Response.json({success:false,error:"Canonical current-reference evidence is unavailable."},{status:409,headers:{"cache-control":"no-store"}});}
}
