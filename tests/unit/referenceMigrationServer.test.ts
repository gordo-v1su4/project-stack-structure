import{beforeEach,describe,expect,mock,test}from"bun:test";
import{currentReferenceIdentityFixture}from"../helpers/currentReferenceIdentity";
import{sourceConfirmationBaselineSha256}from"@/components/studio/sourceConfirmationClient";
import{generationScopeSha256}from"@/components/studio/generationScope";
const actualScope=await import("@/lib/generationScopeStore"),actualJobs=await import("@/lib/h3JobStore"),actualCurrent=await import("@/lib/currentIdentityStore");
let fixture=currentReferenceIdentityFixture(),missing=false,missingPolicy=false;
mock.module("@/lib/generationScopeStore",()=>({...actualScope,readGenerationScopeReceipt:async()=>missing?null:fixture.receipt}));
mock.module("@/lib/h3JobStore",()=>({...actualJobs,readH3Job:async()=>fixture.job}));
mock.module("@/lib/currentIdentityStore",()=>({...actualCurrent,readCurrentIdentityAssessment:async()=>missing?null:fixture.assessment,readCurrentIdentityPolicy:async()=>missingPolicy?null:fixture.currentPolicy}));
const{validateReferenceMigrationAdoption,referenceMigrationAdoptionSha256}=await import("@/lib/referenceMigrationServer");
beforeEach(()=>{fixture=currentReferenceIdentityFixture();missing=missingPolicy=false;});
function initial(){
  const current=structuredClone(fixture.saved);delete current.draft.musicVideoProject!.generationScope;delete current.draft.musicVideoProject!.currentIdentity;
  const candidate=structuredClone(fixture.saved.draft);candidate.musicVideoProject!.currentIdentity!.assessments={};candidate.musicVideoProject!.currentIdentity!.activeAssessments={};
  fixture.receipt.body.referenceMigration!.baselineSha256=sourceConfirmationBaselineSha256(current.draft);
  fixture.receipt.body.referenceMigration!.adoptionSha256=referenceMigrationAdoptionSha256(candidate);
  fixture.receipt.sha256=generationScopeSha256(fixture.receipt.body);fixture.receipt.id=`generation-scope-${fixture.receipt.sha256}`;
  candidate.musicVideoProject!.generationScope=fixture.receipt;candidate.musicVideoProject!.currentIdentity!.migrationSha256=fixture.receipt.sha256;
  return{current,candidate};
}
describe("current-reference migration adoption transaction",()=>{
  test("only the exact pending candidate can adopt its enrolled receipt, without mutating bank or selections",async()=>{
    const{current,candidate}=initial(),before=JSON.stringify(current.draft);
    await validateReferenceMigrationAdoption(current.project.ownerId,current,candidate,current.revision!);
    expect(JSON.stringify(current.draft)).toBe(before);expect(candidate.generatedAssets).toEqual(current.draft.generatedAssets);
  });
  for(const change of ["revision","baseline","bank","story","source","selection","early-record","foreign"]){
    test(`rejects ${change} at initial adoption`,async()=>{
      const{current,candidate}=initial();let owner=current.project.ownerId,expected=current.revision!;
      switch(change){case"revision":expected='"changed"';break;case"baseline":current.draft.storyState.vocalStemName="changed";break;
        case"bank":candidate.generatedAssets![0].prompt="changed";break;case"story":candidate.storyState.storyBeats=[];candidate.storyState.activeBeatId="changed";break;
        case"source":candidate.videoSources=[{name:"injected"}as never];break;case"selection":candidate.generatedDraft={planSignature:"other",revision:99,assetIds:[]};break;
        case"early-record":candidate.musicVideoProject!.currentIdentity!.assessments[fixture.assessment.scope.id]=fixture.assessment;break;case"foreign":owner="other";break;}
      await expect(validateReferenceMigrationAdoption(owner,current,candidate,expected)).rejects.toThrow();
    });
  }
  test("already active identical context permits ordinary edits but canonically validates assessment and policy pointers",async()=>{
    const current=fixture.saved,candidate=structuredClone(current.draft);candidate.storyState.activeBeatId="ordinary-selection";
    await validateReferenceMigrationAdoption(current.project.ownerId,current,candidate,current.revision!);
    missingPolicy=true;await expect(validateReferenceMigrationAdoption(current.project.ownerId,current,candidate,current.revision!)).rejects.toThrow("policy");
    missingPolicy=false;missing=true;await expect(validateReferenceMigrationAdoption(current.project.ownerId,current,candidate,current.revision!)).rejects.toThrow();
  });
  for(const change of ["drop","switch","replacement","history","pointer"]){
    test(`active migration rejects ${change} bypass`,async()=>{
      const current=fixture.saved,candidate=structuredClone(current.draft),context=candidate.musicVideoProject!.currentIdentity!;
      switch(change){case"drop":delete candidate.musicVideoProject!.currentIdentity;break;case"switch":context.migrationSha256="d".repeat(64);break;
        case"replacement":context.replacements[0].toSha256="d".repeat(64);break;case"history":context.assessments={};break;case"pointer":context.activeAssessments.other=fixture.assessment.scope.id;break;}
      await expect(validateReferenceMigrationAdoption(current.project.ownerId,current,candidate,current.revision!)).rejects.toThrow();
    });
  }
});
