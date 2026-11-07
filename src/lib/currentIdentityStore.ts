import {GetObjectCommand,PutObjectCommand} from "@aws-sdk/client-s3";
import {identityPolicySha256} from "@/components/studio/issuedIdentityPolicy";
import type {CurrentIdentityAssessment,CurrentIdentityPolicy,CurrentIdentityRequest} from "@/components/studio/currentReferenceIdentity";
import {sourceConfirmationStorage} from "./generationScopeStore";
import {normalizeStudioOwnerSegment,normalizeStudioProjectId} from "./studioStoragePaths";
type Kind="policies"|"assessments"|"intents"|"requests"|"request-results"|"request-runs";
const limit=(kind:Kind)=>kind==="assessments"?2*1024*1024:128*1024;
function key(ownerId:string,projectId:string,kind:Kind,id:string){
  if(normalizeStudioProjectId(projectId)!==projectId||!(kind==="intents"?/^[a-f0-9-]{36}$/i:/^h3-current-(?:policy|assessment|request)-[a-f0-9]{64}$/).test(id))throw new Error("Invalid current-identity record identity.");
  return `media-uploads/projects/${normalizeStudioOwnerSegment(ownerId)}/current-identity/${projectId}/${kind}/${id}.json`;
}
const status=(error:unknown)=>(error as {$metadata?:{httpStatusCode?:number}})?.$metadata?.httpStatusCode;
async function read(ownerId:string,projectId:string,kind:Kind,id:string):Promise<unknown|null>{
  const{client,bucket}=sourceConfirmationStorage();
  try{
    const response=await client.send(new GetObjectCommand({Bucket:bucket,Key:key(ownerId,projectId,kind,id)}),{abortSignal:AbortSignal.timeout(15_000)});
    if(!response.Body||(response.ContentLength??0)>limit(kind))throw new Error("Current-identity record exceeds its bound.");
    const bytes=await response.Body.transformToByteArray();if(bytes.length>limit(kind))throw new Error("Current-identity record exceeds its bound.");
    return JSON.parse(new TextDecoder().decode(bytes));
  }catch(error){if(status(error)===404)return null;throw error;}
}
async function write(ownerId:string,projectId:string,kind:Kind,id:string,value:unknown){
  const{client,bucket}=sourceConfirmationStorage(),body=JSON.stringify(value);
  if(Buffer.byteLength(body)>limit(kind))throw new Error("Current-identity record exceeds its bound.");
  try{await client.send(new PutObjectCommand({Bucket:bucket,Key:key(ownerId,projectId,kind,id),Body:body,ContentType:"application/json",IfNoneMatch:"*"}),{abortSignal:AbortSignal.timeout(15_000)});return value;}
  catch(error){if(![409,412].includes(status(error)??0))throw error;const prior=await read(ownerId,projectId,kind,id);
    if(identityPolicySha256(prior)!==identityPolicySha256(value))throw new Error("Immutable current-identity inputs or result differ.");return prior;}
}
export async function storeCurrentIdentityPolicy(policy:CurrentIdentityPolicy){
  if(policy.id!==`h3-current-policy-${identityPolicySha256(policy.body)}`||policy.sha256!==identityPolicySha256(policy.body))throw new Error("Invalid current-identity policy digest.");
  await write(policy.body.ownerId,policy.body.projectId,"policies",policy.id,policy);return policy;
}
export async function readCurrentIdentityPolicy(ownerId:string,projectId:string,id:string):Promise<CurrentIdentityPolicy|null>{
  const value=await read(ownerId,projectId,"policies",id) as CurrentIdentityPolicy|null;if(!value)return null;
  if(value.version!==1||value.id!==id||value.body.ownerId!==ownerId||value.body.projectId!==projectId
    ||value.sha256!==identityPolicySha256(value.body)||id!==`h3-current-policy-${value.sha256}`)throw new Error("Invalid owned current-identity policy.");return value;
}
export async function claimCurrentIdentityRequest(request:CurrentIdentityRequest){
  const {ownerId,projectId,requestIntentId}=request.scope;
  await write(ownerId,projectId,"intents",requestIntentId,request);
  await write(ownerId,projectId,"requests",request.id,request);return request;
}
export async function readCurrentIdentityRequest(ownerId:string,projectId:string,id:string):Promise<CurrentIdentityRequest|null>{
  const value=await read(ownerId,projectId,/^h3-current-request-/.test(id)?"requests":"intents",id) as CurrentIdentityRequest|null;
  if(!value)return null;const{id:recordId,...body}=value;
  if(value.version!==1||value.scope.ownerId!==ownerId||value.scope.projectId!==projectId||recordId!==`h3-current-request-${identityPolicySha256(body)}`)
    throw new Error("Invalid owned current-identity request.");return value;
}
export type CurrentIdentityRequestOutcome={requestId:string;status:"ready";assessmentId:string}|{requestId:string;status:"failed";errorCode:"assessment-failed";assessmentId?:string};
export const writeCurrentIdentityRequestRun=(request:CurrentIdentityRequest,runId:string)=>write(request.scope.ownerId,request.scope.projectId,"request-runs",request.id,{runId});
export const readCurrentIdentityRequestRun=(ownerId:string,projectId:string,id:string)=>read(ownerId,projectId,"request-runs",id) as Promise<{runId:string}|null>;
export const writeCurrentIdentityRequestOutcome=(request:CurrentIdentityRequest,outcome:CurrentIdentityRequestOutcome)=>write(request.scope.ownerId,request.scope.projectId,"request-results",request.id,outcome);
export const readCurrentIdentityRequestOutcome=(ownerId:string,projectId:string,id:string)=>read(ownerId,projectId,"request-results",id) as Promise<CurrentIdentityRequestOutcome|null>;
export async function readCurrentIdentityAssessment(ownerId:string,projectId:string,id:string):Promise<CurrentIdentityAssessment|null>{
  const value=await read(ownerId,projectId,"assessments",id) as CurrentIdentityAssessment|null;if(!value)return null;
  const{ id:_id,...body}=value.scope;void _id;
  if(value.version!==1||value.scope.ownerId!==ownerId||value.scope.projectId!==projectId||value.scope.id!==id
    ||id!==`h3-current-assessment-${identityPolicySha256(body)}`||!["ready","failed"].includes(value.status)
    ||(value.status==="ready"&&value.proofSha256!==identityPolicySha256(value.proof)))throw new Error("Invalid owned current-identity assessment.");return value;
}
export async function storeCurrentIdentityAssessment(record:CurrentIdentityAssessment){
  const prior=await readCurrentIdentityAssessment(record.scope.ownerId,record.scope.projectId,record.scope.id);
  if(prior){if(identityPolicySha256(prior.scope)!==identityPolicySha256(record.scope))throw new Error("Immutable current-identity scope differs.");return prior;}
  try{await write(record.scope.ownerId,record.scope.projectId,"assessments",record.scope.id,record);return record;}
  catch(error){const existing=await readCurrentIdentityAssessment(record.scope.ownerId,record.scope.projectId,record.scope.id);
    if(existing&&identityPolicySha256(existing.scope)===identityPolicySha256(record.scope))return existing;throw error;}
}
