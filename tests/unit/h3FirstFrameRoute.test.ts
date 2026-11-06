import {describe,expect,mock,test}from"bun:test";
import{h3ProjectFixture}from"../helpers/h3Project";
const fixture=h3ProjectFixture();let signedIn=true,writes=0;
mock.module("@/lib/session",()=>({getSessionUser:async()=>signedIn?{id:"github-test"}:null,unauthorizedResponse:()=>Response.json({},{status:401})}));
mock.module("@/lib/studioProjectStore",()=>({readStudioProject:async(owner:string,id:string)=>owner==="github-test"&&id==="project-1"?fixture.saved:null}));
mock.module("@/lib/mediaGateway",()=>({getMediaGatewayConfig:()=>({bucket:"studio"}),normalizeMediaPath:(v:string)=>v}));
mock.module("@/lib/h3JobStore",()=>({pinH3JobReferences:async(job:unknown)=>job}));
mock.module("@/lib/h3FirstFrameStore",()=>({registerH3FirstFrame:async()=>{writes++;return{id:"artifact-fixture"};},readH3FirstFrame:async()=>null}));
const{POST,GET}=await import("@/app/api/generate/h3/first-frame-artifacts/route");
const post=(body:unknown)=>new Request("http://app.test/api/generate/h3/first-frame-artifacts",{method:"POST",body:JSON.stringify(body)});
const input=()=>({shot:{...fixture.request,identityPolicyFamily:"sface-yunet-foreground-frontal-v2"},upload:{bucket:"studio",objectKey:"owned"},expectedSha256:"a".repeat(64)});
describe("first-frame registration authentication/current target",()=>{
 test("both methods require a session before storage",async()=>{signedIn=false;writes=0;expect((await POST(post(input()))).status).toBe(401);expect((await GET(new Request("http://app.test?projectId=project-1&artifactId=x"))).status).toBe(401);expect(writes).toBe(0);signedIn=true;});
 test("valid owned reference authorities register without dispatch or project save",async()=>{writes=0;const before=JSON.stringify(fixture.saved);expect((await POST(post(input()))).status).toBe(200);expect(writes).toBe(1);expect(JSON.stringify(fixture.saved)).toBe(before);});
 test("stale plan/foreign project/wrong family do not write artifacts",async()=>{writes=0;for(const shot of [{...input().shot,planSignature:"old"},{...input().shot,projectId:"other"},{...input().shot,identityPolicyFamily:"sface-yunet-foreground-frontal-v1"}])expect((await POST(post({...input(),shot}))).status).toBeGreaterThanOrEqual(400);expect(writes).toBe(0);});
});
