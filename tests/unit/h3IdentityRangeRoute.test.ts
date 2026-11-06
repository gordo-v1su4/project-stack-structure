import { describe,expect,mock,test } from "bun:test";
import { h3IdentityAssessmentFixture } from "../helpers/h3IdentityAssessment";
import type { H3IdentityAssessment, H3IdentityAssessmentScope } from "@/components/studio/h3IdentityAssessment";
let f=h3IdentityAssessmentFixture(), signedIn=true,rejected=false,dispatches=0,captured:H3IdentityAssessmentScope|undefined;
const records=new Map<string,H3IdentityAssessment>(),claims=new Map<string,string>();
const forbidden=async()=>{throw Error("Unexpected render or mutation");};
mock.module("@/lib/session",()=>({getSessionUser:async()=>signedIn?{id:f.job.ownerId}:null,unauthorizedResponse:()=>Response.json({}, {status:401})}));
mock.module("@/lib/studioProjectStore",()=>({readStudioProject:async(o:string,p:string)=>o===f.job.ownerId&&p===f.job.projectId?{project:{id:p,ownerId:o},draft:{generatedAssets:rejected?[{...f.asset,reviewStatus:"rejected"}]:[]}}:null}));
mock.module("@/lib/h3JobStore",()=>({readH3Job:async(o:string,p:string,j:string)=>o===f.job.ownerId&&p===f.job.projectId&&j===f.job.id?f.job:null,
  updateH3Job:forbidden,pinH3JobReferences:forbidden,claimH3GenerationIntent:forbidden,createH3Job:forbidden,listH3Jobs:async()=>[f.job]}));
mock.module("@/lib/triggerOrchestration",()=>({triggerH3Generation:forbidden,retrieveTriggerRun:forbidden,
  triggerH3IdentityRecheck:async(_j:unknown,_i:string,scope:H3IdentityAssessmentScope)=>{dispatches++;captured=scope;return{id:"cpu-range-run"};}}));
mock.module("@/lib/h3IdentityAssessmentStore",()=>({readH3IdentityAssessment:async(_o:string,_p:string,_j:string,id:string)=>records.get(id)??null,
  claimH3IdentityAssessment:async(scope:H3IdentityAssessmentScope)=>{const body=JSON.stringify(scope),previous=claims.get(scope.requestIntentId);if(previous&&previous!==body)throw Error("Changed intent");claims.set(scope.requestIntentId,body);}}));
const {GET,PATCH}=await import("@/app/api/generate/h3/route");
function reset(){f=h3IdentityAssessmentFixture();signedIn=true;rejected=false;dispatches=0;captured=undefined;records.clear();claims.clear();}
const request=(patch:Record<string,unknown>={})=>new Request("https://app.test/api/generate/h3",{method:"PATCH",body:JSON.stringify({projectId:f.job.projectId,jobId:f.job.id,action:"recheck_identity",requestIntentId:f.scope.requestIntentId,trimStart:.5,...patch})});
const get=(id=f.scope.id)=>GET(new Request(`https://app.test/api/generate/h3?${new URLSearchParams({projectId:f.job.projectId,jobId:f.job.id,assessmentId:id})}`));
describe("owned append-only range assessment route",()=>{
  test("a new request without an explicit range never claims an intent, dispatches or changes the original proof",async()=>{
    reset();const before=JSON.stringify(f.job),response=await PATCH(request({trimStart:undefined}));
    expect(response.status).toBe(409);expect((await response.json()).error).toContain("choose a source handle");
    expect(dispatches).toBe(0);expect(claims.size).toBe(0);expect(JSON.stringify(f.job)).toBe(before);
  });
  test("captures only canonical range authority and never mutates the original job",async()=>{
    reset();const before=JSON.stringify(f.job),response=await PATCH(request({ownerId:"forged",policySha256:"f".repeat(64)}));
    expect(response.status).toBe(202);expect((await response.json()).assessmentId).toBe(f.scope.id);
    expect(captured).toEqual(f.scope);expect(JSON.stringify(f.job)).toBe(before);expect(dispatches).toBe(1);
    expect((await PATCH(request({trimStart:.75}))).status).toBe(409);expect(dispatches).toBe(1);
  });
  test("rejects invalid bounds, foreign project, anonymous requests and saved rejection before dispatch",async()=>{
    reset();for(const trimStart of [-1,5,".5",null])expect((await PATCH(request({trimStart}))).status).toBe(409);
    expect((await PATCH(request({projectId:"foreign"}))).status).toBe(404);
    rejected=true;expect((await PATCH(request())).status).toBe(409);
    signedIn=false;expect((await PATCH(request())).status).toBe(401);expect((await get()).status).toBe(401);expect(dispatches).toBe(0);
  });
  test("polls only the requested stored assessment and rejects malformed or stale evidence",async()=>{
    reset();expect((await (await get()).json()).assessment).toBe(null);
    records.set(f.scope.id,f.record);const response=await get();expect(response.status).toBe(200);
    expect((await response.json()).assessment.proof.verifiedStartFrame).toBe(12);
    expect((await get("../foreign")).status).toBe(400);
    records.set(f.scope.id,{...f.record,scope:{...f.scope,mediaSha256:"f".repeat(64)}});
    expect((await get()).status).toBe(503);
  });
});
