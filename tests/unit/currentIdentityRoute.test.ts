import{beforeEach,describe,expect,mock,test}from"bun:test";
import{currentReferenceIdentityFixture}from"../helpers/currentReferenceIdentity";
import{CURRENT_IDENTITY_PURPOSE,buildCurrentIdentityRequest}from"@/components/studio/currentReferenceIdentity";
let fixture=currentReferenceIdentityFixture(),user:{id:string}|null=null,reads=0,dispatches=0,claims=0,run:{runId:string}|null=null,stored:ReturnType<typeof buildCurrentIdentityRequest>|null=null,lostTriggerAck=false,lostWriteAck=false;
mock.module("@/lib/session",()=>({getSessionUser:async()=>user,unauthorizedResponse:()=>Response.json({error:"Unauthorized"},{status:401})}));
mock.module("@/lib/studioProjectStore",()=>({readStudioProject:async(owner:string,id:string)=>{reads++;return owner===fixture.job.ownerId&&id===fixture.job.projectId?fixture.saved:null;}}));
mock.module("@/lib/h3JobStore",()=>({readH3Job:async()=>fixture.job}));
mock.module("@/lib/generationScopeStore",()=>({readGenerationScopeReceipt:async()=>fixture.receipt}));
mock.module("@/lib/currentIdentityRunner",()=>({migrationIdentityContext:()=>fixture.context,resolveCurrentIdentitySelection:async()=>fixture.asset,
  assertCurrentIdentityRequestState:async(request:ReturnType<typeof buildCurrentIdentityRequest>)=>{if(request.expectedRevision!==fixture.saved.revision||request.scope.purpose!==CURRENT_IDENTITY_PURPOSE)throw new Error("changed");}}));
mock.module("@/lib/currentIdentityStore",()=>({claimCurrentIdentityRequest:async(request:ReturnType<typeof buildCurrentIdentityRequest>)=>{claims++;if(stored&&stored.id!==request.id)throw new Error("bound");stored=request;},
  readCurrentIdentityRequestRun:async()=>run,writeCurrentIdentityRequestRun:async(_request:unknown,id:string)=>{if(lostWriteAck)throw new Error("ACK lost");run={runId:id};},
  readCurrentIdentityRequest:async()=>stored,readCurrentIdentityRequestOutcome:async()=>stored?{requestId:stored.id,status:"ready",assessmentId:fixture.assessment.scope.id}:null,
  readCurrentIdentityAssessment:async()=>fixture.assessment}));
mock.module("@/lib/triggerOrchestration",()=>({triggerCurrentIdentityRequest:async()=>{dispatches++;if(lostTriggerAck)throw new Error("Accepted but ACK lost");return{id:"run-cpu-only"};}}));
const route=await import("@/app/api/generate/h3/current-identity/route");
beforeEach(()=>{fixture=currentReferenceIdentityFixture();user={id:fixture.job.ownerId};reads=dispatches=claims=0;run=null;stored=null;lostTriggerAck=lostWriteAck=false;});
const body=()=>({projectId:fixture.job.projectId,expectedRevision:fixture.saved.revision,migrationId:fixture.receipt.id,jobId:fixture.job.id,assetId:fixture.asset.id,trimStart:fixture.asset.trimStart??0,requestIntentId:"00000000-0000-4000-8000-000000000001"});
describe("current-reference assessment route",()=>{
  test("anonymous GET and POST short-circuit every project read and dispatch",async()=>{
    user=null;expect((await route.GET(new Request("https://app.test/api/generate/h3/current-identity?projectId=x"))).status).toBe(401);
    expect((await route.POST(new Request("https://app.test/api/generate/h3/current-identity",{method:"POST",body:JSON.stringify(body())}))).status).toBe(401);
    expect(reads).toBe(0);expect(dispatches).toBe(0);expect(claims).toBe(0);
  });
  test("one exact request claims a durable intent and repeat receipt returns the same CPU run",async()=>{
    const post=()=>route.POST(new Request("https://app.test/api/generate/h3/current-identity",{method:"POST",body:JSON.stringify(body())}));
    const first=await post();expect(first.status).toBe(202);const response=await first.json();expect(response.request.scope.generationReferenceHashes).toEqual(fixture.job.referenceHashes);
    expect(response.runId).toBe("run-cpu-only");expect((await post()).status).toBe(202);expect(dispatches).toBe(1);
    const read=await route.GET(new Request(`https://app.test/api/generate/h3/current-identity?projectId=${fixture.job.projectId}&requestIntentId=${body().requestIntentId}`));
    const recovered=await read.json();expect(recovered.request.id).toBe(response.request.id);expect(recovered.assessment).toEqual(fixture.assessment);expect(dispatches).toBe(1);
  });
  test("a changed expected revision or foreign project cannot claim or dispatch",async()=>{
    for(const change of [{expectedRevision:'"other"'},{projectId:"foreign"},{assetId:"other"}]){
      const response=await route.POST(new Request("https://app.test/api/generate/h3/current-identity",{method:"POST",body:JSON.stringify({...body(),...change})}));expect(response.status).toBe(409);
      expect((await response.json()).code).toBe("CHECK_NOT_SUBMITTED");
    }expect(claims).toBe(0);expect(dispatches).toBe(0);
  });
  for(const lost of ["trigger ACK","run receipt write"])test(`after claim a lost ${lost} is submission-unknown, never a retryable rejection`,async()=>{
    lostTriggerAck=lost==="trigger ACK";lostWriteAck=lost==="run receipt write";
    const response=await route.POST(new Request("https://app.test/api/generate/h3/current-identity",{method:"POST",body:JSON.stringify(body())}));
    expect(response.status).toBe(503);expect((await response.json()).code).toBe("SUBMISSION_UNKNOWN");expect(claims).toBe(1);expect(dispatches).toBe(1);
    const read=await route.GET(new Request(`https://app.test/api/generate/h3/current-identity?projectId=${fixture.job.projectId}&requestIntentId=${body().requestIntentId}`));
    expect((await read.json()).request).not.toBeNull();expect(dispatches).toBe(1);
  });
  test("GET-only recovery can observe missing intents without creating work",async()=>{
    for(const query of [`requestIntentId=${body().requestIntentId}`,`requestId=h3-current-request-${"a".repeat(64)}`]){
      const response=await route.GET(new Request(`https://app.test/api/generate/h3/current-identity?projectId=${fixture.job.projectId}&${query}`));
      expect(response.status).toBe(404);expect(response.headers.get("cache-control")).toBe("no-store");
      const value=await response.json();expect(value.code).toBe("CURRENT_IDENTITY_REQUEST_NOT_FOUND");expect(value.request).toBeNull();
    }expect(dispatches).toBe(0);expect(claims).toBe(0);
  });
  test("missing projects and invalid lookups never assert exact owned request absence",async()=>{
    const foreign=await route.GET(new Request(`https://app.test/api/generate/h3/current-identity?projectId=foreign&requestIntentId=${body().requestIntentId}`));
    expect(foreign.status).toBe(404);expect((await foreign.json()).code).not.toBe("CURRENT_IDENTITY_REQUEST_NOT_FOUND");
    const invalid=await route.GET(new Request(`https://app.test/api/generate/h3/current-identity?projectId=${fixture.job.projectId}&requestIntentId=invalid`));
    expect(invalid.status).toBe(409);expect((await invalid.json()).code).not.toBe("CURRENT_IDENTITY_REQUEST_NOT_FOUND");
    expect(dispatches).toBe(0);expect(claims).toBe(0);
  });
});
