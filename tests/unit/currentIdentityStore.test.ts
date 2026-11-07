import {beforeEach,describe,expect,mock,test} from "bun:test";
import {GetObjectCommand,PutObjectCommand} from "@aws-sdk/client-s3";
import {currentReferenceIdentityFixture} from "../helpers/currentReferenceIdentity";
import {buildCurrentIdentityRequest,buildCurrentIdentityScopeBase} from "@/components/studio/currentReferenceIdentity";
const objects=new Map<string,Uint8Array>(),calls:unknown[]=[];
let failRead=false;
mock.module("@/lib/generationScopeStore",()=>({sourceConfirmationStorage:()=>({bucket:"studio",client:{send:async(command:unknown)=>{
  calls.push(command);const input=(command as GetObjectCommand).input,key=input.Key!;
  if(command instanceof GetObjectCommand){if(failRead)throw new Error("PRIVATE-transport-input");const bytes=objects.get(key);if(!bytes)throw {$metadata:{httpStatusCode:404}};
    return {ContentLength:bytes.length,Body:{transformToByteArray:async()=>bytes}};}
  if(!(command instanceof PutObjectCommand)||command.input.IfNoneMatch!=="*")throw new Error("Unconditional write prohibited");
  if(objects.has(key))throw {$metadata:{httpStatusCode:412}};objects.set(key,new TextEncoder().encode(String(command.input.Body)));return {};
}}})}));
const store=await import("@/lib/currentIdentityStore");
beforeEach(()=>{objects.clear();calls.length=0;failRead=false;});
describe("immutable current-reference records",()=>{
  test("request intent is immutable and discoverable by UUID after an unknown dispatch acknowledgement",async()=>{
    const{job,asset,context}=currentReferenceIdentityFixture();
    const request=buildCurrentIdentityRequest({migrationId:`generation-scope-${context.migrationSha256}`,expectedRevision:'"r1"',baselineSha256:"b".repeat(64),scope:buildCurrentIdentityScopeBase(job,asset,context,"00000000-0000-4000-8000-000000000001")});
    await store.claimCurrentIdentityRequest(request);
    expect(await store.readCurrentIdentityRequest(job.ownerId,job.projectId,request.scope.requestIntentId)).toEqual(request);
    expect(await store.readCurrentIdentityRequest(job.ownerId,job.projectId,request.id)).toEqual(request);
    await store.claimCurrentIdentityRequest(request);
    const changed=buildCurrentIdentityRequest({...request,scope:{...request.scope,trimStart:1}});
    await expect(store.claimCurrentIdentityRequest(changed)).rejects.toThrow("Immutable");
    expect(await store.readCurrentIdentityRequestRun(job.ownerId,job.projectId,request.id)).toBeNull();
    await store.writeCurrentIdentityRequestRun(request,"run-one");
    await expect(store.writeCurrentIdentityRequestRun(request,"run-two")).rejects.toThrow("Immutable");
  });
  test("a terminal failed or completed range is never overwritten by a retry or new report",async()=>{
    const{assessment,job}=currentReferenceIdentityFixture();
    const failed={version:1 as const,scope:assessment.scope,status:"failed" as const,assessedAt:"first",errorCode:"assessment-failed" as const};
    await store.storeCurrentIdentityAssessment(failed);
    expect(await store.storeCurrentIdentityAssessment(assessment)).toEqual(failed);
    expect(await store.readCurrentIdentityAssessment(job.ownerId,job.projectId,assessment.scope.id)).toEqual(failed);
    expect((calls.filter(call=>call instanceof PutObjectCommand)as PutObjectCommand[]).every(call=>call.input.IfNoneMatch==="*")).toBe(true);
  });
  test("policy digest and owner/project scope are verified on canonical reads",async()=>{
    const{currentPolicy,job}=currentReferenceIdentityFixture();await store.storeCurrentIdentityPolicy(currentPolicy);
    expect(await store.readCurrentIdentityPolicy(job.ownerId,job.projectId,currentPolicy.id)).toEqual(currentPolicy);
    expect(await store.readCurrentIdentityPolicy("other",job.projectId,currentPolicy.id)).toBeNull();
    const key=[...objects.keys()][0],forged=structuredClone(currentPolicy);forged.body.ownerId="other";objects.set(key,new TextEncoder().encode(JSON.stringify(forged)));
    await expect(store.readCurrentIdentityPolicy(job.ownerId,job.projectId,currentPolicy.id)).rejects.toThrow("owned");
  });
  test("canonical report hash and bounded reads fail closed",async()=>{
    const{assessment,job}=currentReferenceIdentityFixture();await store.storeCurrentIdentityAssessment(assessment);
    const key=[...objects.keys()][0],forged=structuredClone(assessment);if(forged.status!=="ready")throw new Error("fixture");forged.proof.mediaSha256="f".repeat(64);objects.set(key,new TextEncoder().encode(JSON.stringify(forged)));
    await expect(store.readCurrentIdentityAssessment(job.ownerId,job.projectId,assessment.scope.id)).rejects.toThrow("owned");
    objects.set(key,new Uint8Array(2*1024*1024+1));await expect(store.readCurrentIdentityAssessment(job.ownerId,job.projectId,assessment.scope.id)).rejects.toThrow("bound");
    failRead=true;await expect(store.readCurrentIdentityAssessment(job.ownerId,job.projectId,assessment.scope.id)).rejects.toThrow("transport");
  });
});
