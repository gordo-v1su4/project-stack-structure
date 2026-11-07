import{beforeEach,describe,expect,mock,test}from"bun:test";
import{createHash}from"node:crypto";
import{readFile,writeFile}from"node:fs/promises";
import{currentReferenceIdentityFixture}from"../helpers/currentReferenceIdentity";
import{buildCurrentIdentityRequest,buildCurrentIdentityScopeBase,currentIdentityOrigin,type CurrentIdentityAssessment}from"@/components/studio/currentReferenceIdentity";
import{identityPolicySha256}from"@/components/studio/issuedIdentityPolicy";
import{sourceConfirmationBaselineSha256}from"@/components/studio/sourceConfirmationClient";
let fixture=currentReferenceIdentityFixture(),request:ReturnType<typeof buildCurrentIdentityRequest>,reads=0,drift=false,records:CurrentIdentityAssessment[]=[],outcomes:unknown[]=[],stages:string[]=[];
const bytes=new TextEncoder().encode("immutable native synthetic media");
const mediaGateway=await import("@/lib/mediaGateway");
mock.module("@/lib/studioProjectStore",()=>({readStudioProject:async()=>{reads++;return drift&&reads>1?{...fixture.saved,revision:'"changed"'}:fixture.saved;}}));
mock.module("@/lib/h3JobStore",()=>({readH3Job:async()=>fixture.job}));
mock.module("@/lib/h3IdentityAssessmentStore",()=>({readH3IdentityAssessment:async()=>null}));
mock.module("@/lib/generationScopeStore",()=>({readGenerationScopeReceipt:async()=>fixture.receipt}));
mock.module("@/lib/currentIdentityStore",()=>({readCurrentIdentityRequest:async()=>request,readCurrentIdentityRequestOutcome:async()=>null,
  writeCurrentIdentityRequestRun:async()=>{},storeCurrentIdentityAssessment:async(record:CurrentIdentityAssessment)=>{records.push(record);return record;},
  writeCurrentIdentityRequestOutcome:async(_request:unknown,outcome:unknown)=>{outcomes.push(outcome);}}));
mock.module("@/lib/currentIdentityPolicyPreparation",()=>({prepareCurrentIdentityPolicy:async()=>({policy:fixture.currentPolicy,references:[]})}));
mock.module("@/lib/h3IdentityVerification",()=>({executeVerifier:async()=>{throw new Error("must use injected offline process");}}));
mock.module("@/lib/mediaGateway",()=>({...mediaGateway,getMediaGatewayConfig:()=>({bucket:"studio"}),downloadMediaGatewayFile:async()=>({bytes})}));
mock.module("@/components/studio/mediaProbe",()=>({probeMediaFile:async()=>({})}));
mock.module("@/lib/h3GenerationRunner",()=>({validateH3VideoProbe:()=>{}}));
mock.module("@/lib/generationScopeRawReferences",()=>({verifyGenerationScopeRawReferences:async()=>[]}));
const{runCurrentIdentityRequest,assertCurrentIdentityRequestState}=await import("@/lib/currentIdentityRunner");
beforeEach(()=>{
  fixture=currentReferenceIdentityFixture();reads=0;drift=false;records=[];outcomes=[];stages=[];
  const sha=createHash("sha256").update(bytes).digest("hex");fixture.asset.mediaSha256=sha;fixture.asset.identityVerification!.mediaSha256=sha;
  fixture.context.assessments={};fixture.context.activeAssessments={};
  fixture.receipt.body.referenceMigration!.origins=[{jobId:fixture.job.id,...currentIdentityOrigin(fixture.job)}];
  fixture.receipt.sha256=identityPolicySha256(fixture.receipt.body);fixture.receipt.id=`generation-scope-${fixture.receipt.sha256}`;fixture.context.migrationSha256=fixture.receipt.sha256;
  request=buildCurrentIdentityRequest({migrationId:fixture.receipt.id,expectedRevision:fixture.saved.revision!,baselineSha256:sourceConfirmationBaselineSha256(fixture.saved.draft),scope:buildCurrentIdentityScopeBase(fixture.job,fixture.asset,fixture.context,"00000000-0000-4000-8000-000000000001")});
});
const process=async(inputPath:string,outputPath:string)=>{
  const input=JSON.parse(await readFile(inputPath,"utf8"));
  if(fixture.assessment.status!=="ready")throw new Error("fixture");
  const proof=structuredClone(fixture.assessment.proof);proof.mediaSha256=input.mediaSha256;
  await writeFile(outputPath,JSON.stringify({...proof,origin:input.origin}));
};
describe("CPU-only current-reference worker",()=>{
  test("appends its separate bound report and never changes canonical generation or selected bank",async()=>{
    const before=JSON.stringify(fixture.job),bank=JSON.stringify(fixture.saved.draft.generatedAssets);
    const output=await runCurrentIdentityRequest(fixture.job.ownerId,fixture.job.projectId,request.id,"run-one",{stage:label=>stages.push(label),runVerifier:process});
    expect(output.status).toBe("ready");expect(records.length).toBe(1);expect(records[0].status).toBe("ready");
    if(records[0].status!=="ready")throw new Error("fixture");expect(records[0].proof.evaluationReferenceHashes).not.toEqual(records[0].scope.generationReferenceHashes);
    expect(JSON.stringify(fixture.job)).toBe(before);expect(JSON.stringify(fixture.saved.draft.generatedAssets)).toBe(bank);expect(outcomes.length).toBe(1);
  });
  test("late project drift appends a failed record instead of making completed evidence active",async()=>{
    drift=true;await expect(runCurrentIdentityRequest(fixture.job.ownerId,fixture.job.projectId,request.id,"run-one",{stage:label=>stages.push(label),runVerifier:process})).rejects.toThrow("original generation evidence is unchanged");
    expect(records.length).toBe(1);expect(records[0].status).toBe("failed");expect(fixture.context.activeAssessments).toEqual({});
  });
  test("process errors expose only a fixed classification",async()=>{
    await expect(runCurrentIdentityRequest(fixture.job.ownerId,fixture.job.projectId,request.id,"run-one",{stage:label=>stages.push(label),runVerifier:async()=>{throw new Error("SECRET https://private.example/object?signature=credential embedding=[.1,.2]");}})).rejects.toThrow("Current-reference assessment failed; original generation evidence is unchanged.");
    expect(JSON.stringify({records,outcomes,stages})).not.toContain("SECRET");expect(JSON.stringify({records,outcomes,stages})).not.toContain("private.example");
  });
  test("changed canonical origin or exact selected range fails before processing",async()=>{
    fixture.job.request.prompt="changed";
    await expect(assertCurrentIdentityRequestState(request,fixture.saved,fixture.job,fixture.receipt)).rejects.toThrow("lineage");
    expect(records.length).toBe(0);
  });
});
