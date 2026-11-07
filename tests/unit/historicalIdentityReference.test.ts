import{beforeEach,describe,expect,mock,test}from"bun:test";
import{currentReferenceIdentityFixture}from"../helpers/currentReferenceIdentity";
import{currentIdentityOrigin}from"@/components/studio/currentReferenceIdentity";
import{identityPolicySha256}from"@/components/studio/issuedIdentityPolicy";
import type{H3ReferenceSnapshot}from"@/components/studio/h3Generation";
const OLD="47d772694e0c14397707f31b7802fe91d434da1e4b54be7bac3eb00037364381",ASSET="character-1-1788717231561-sy1hpa";
let fixture=currentReferenceIdentityFixture(),calls:H3ReferenceSnapshot[]=[],missing=false,conditionalFailure=false;
mock.module("@/lib/h3JobStore",()=>({downloadH3ReferenceImage:async(reference:H3ReferenceSnapshot)=>{calls.push(reference);if(conditionalFailure)throw new Error("conditional 412");return{bytes:new Uint8Array(10),mime:"image/png"};}}));
mock.module("@/lib/generationScopeStore",()=>({readGenerationScopeReceipt:async()=>missing?null:fixture.receipt}));
const{historicalIdentityReferenceResolver}=await import("@/lib/historicalIdentityReference");
beforeEach(()=>{
  fixture=currentReferenceIdentityFixture();calls=[];missing=conditionalFailure=false;
  const reference=fixture.job.references[0];reference.assetId=ASSET;reference.canonicalName="Diego";fixture.job.referenceHashes![0]=OLD;
  fixture.receipt.body.referenceMigration!.historicalReferences=[{assetId:ASSET,bucket:reference.bucket,objectKey:reference.objectKey,etag:reference.etag!,sha256:OLD}];
  fixture.receipt.body.referenceMigration!.historicalBackups=[{assetId:ASSET,bucket:reference.bucket,objectKey:`media-uploads/${fixture.job.ownerId}/reference-backups/exact-old.png`,etag:'"backup-etag"',sha256:OLD,byteLength:10}];
  fixture.receipt.body.referenceMigration!.origins=[{jobId:fixture.job.id,...currentIdentityOrigin(fixture.job)}];
  fixture.receipt.sha256=identityPolicySha256(fixture.receipt.body);fixture.receipt.id=`generation-scope-${fixture.receipt.sha256}`;fixture.context.migrationSha256=fixture.receipt.sha256;
});
describe("migration-authorized historical reference transport",()=>{
  test("without an active migration the original conditional transport remains the only path",async()=>{
    delete fixture.saved.draft.musicVideoProject!.currentIdentity;expect(await historicalIdentityReferenceResolver(fixture.job,fixture.saved)).toBe(undefined);expect(calls).toHaveLength(0);
  });
  test("uses the backup locator's own ETag, verifies full SHA and never rewrites original job reference",async()=>{
    const before=JSON.stringify(fixture.job),resolver=await historicalIdentityReferenceResolver(fixture.job,fixture.saved);
    await expect(resolver!(fixture.job.references[0],0)).rejects.toThrow("bytes differ");
    expect(calls).toHaveLength(1);expect(calls[0].objectKey).toContain("reference-backups/");expect(calls[0].etag).toBe('"backup-etag"');
    expect(calls[0].etag).not.toBe(fixture.job.references[0].etag);expect(JSON.stringify(fixture.job)).toBe(before);
  });
  test("backup conditional failure does not fall back to the overwritten original key",async()=>{
    conditionalFailure=true;const resolver=await historicalIdentityReferenceResolver(fixture.job,fixture.saved);
    await expect(resolver!(fixture.job.references[0],0)).rejects.toThrow("412");expect(calls).toHaveLength(1);expect(calls[0].objectKey).not.toBe(fixture.job.references[0].objectKey);
  });
  test("changed original ETag or lineage cannot authorize historical bytes",async()=>{
    const resolver=await historicalIdentityReferenceResolver(fixture.job,fixture.saved);
    await expect(resolver!({...fixture.job.references[0],etag:'"changed"'},0)).rejects.toThrow("generation bindings");expect(calls).toHaveLength(0);
    fixture.job.request.prompt="changed";await expect(historicalIdentityReferenceResolver(fixture.job,fixture.saved)).rejects.toThrow("lineage");
  });
  test("a missing canonical migration or foreign backup locator fails closed",async()=>{
    missing=true;await expect(historicalIdentityReferenceResolver(fixture.job,fixture.saved)).rejects.toThrow("unavailable");missing=false;
    fixture.receipt.body.referenceMigration!.historicalBackups![0].objectKey="media-uploads/other/reference-backups/old.png";
    const resolver=await historicalIdentityReferenceResolver(fixture.job,fixture.saved);await expect(resolver!(fixture.job.references[0],0)).rejects.toThrow("bindings");expect(calls).toHaveLength(0);
  });
  test("unchanged environment references keep their exact ordinary pinned read",async()=>{
    const resolver=await historicalIdentityReferenceResolver(fixture.job,fixture.saved);await resolver!(fixture.job.references[1],1);expect(calls).toEqual([fixture.job.references[1]]);
  });
});
