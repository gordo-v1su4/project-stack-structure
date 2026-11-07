import{beforeEach,describe,expect,mock,test}from"bun:test";
import{createHash}from"node:crypto";
import{mkdtemp,readFile,rm,writeFile}from"node:fs/promises";
import{tmpdir}from"node:os";
import path from"node:path";
import{currentReferenceIdentityFixture}from"../helpers/currentReferenceIdentity";
import{getH3PolicyFamily,identityPolicySha256,issuedGalleryProfileSha256}from"@/components/studio/issuedIdentityPolicy";
import{H3_DRAFT_SIMILARITY_POLICY_ID,H3_DRAFT_SIMILARITY_POLICY_SHA256}from"@/components/studio/identityDraftPolicy";
let fixture=currentReferenceIdentityFixture(),downloads:Array<{etag?:string;objectKey:string}>=[],issues=0,badBytes=false,tooLarge=false,preflights=0;
const content=(index:number)=>new TextEncoder().encode(`current-raw-reference-${index}`);
mock.module("sharp",()=>({default:()=>({metadata:async()=>({width:tooLarge?8193:1448,height:1086,format:"png"})})}));
mock.module("@/lib/h3JobStore",()=>({downloadH3ReferenceImage:async(reference:{etag?:string;objectKey:string})=>{downloads.push(reference);const index=fixture.job.references.findIndex(ref=>ref.objectKey===reference.objectKey);return{bytes:badBytes?new Uint8Array([99]):content(index),mime:"image/png"};}}));
mock.module("@/lib/h3DraftPolicyStore",()=>({readIssuedH3DraftPolicy:async()=>fixture.policy,assertIssuedH3DraftPolicyMatchesJob:()=>{},issueH3DraftPolicy:async()=>{throw new Error("Generation policy must never be reissued");},identityPolicyPreflightBinding:()=>"unused"}));
mock.module("@/lib/currentIdentityStore",()=>({storeCurrentIdentityPolicy:async(policy:unknown)=>{issues++;return policy;}}));
const{prepareCurrentIdentityPolicy}=await import("@/lib/currentIdentityPolicyPreparation");
beforeEach(()=>{fixture=currentReferenceIdentityFixture();downloads=[];issues=preflights=0;badBytes=tooLarge=false;
  fixture.receipt.body.rawReferences=fixture.job.references.map((reference,index)=>({assetId:reference.assetId,bucket:reference.bucket,objectKey:reference.objectKey,etag:`"current-${index}"`,sha256:createHash("sha256").update(content(index)).digest("hex"),byteLength:content(index).length}));});
async function run(legacy=false,reject=false){
  if(legacy){delete fixture.job.identityPolicy;fixture.job.profile="h3-ref2va-int8-v2";fixture.job.result!.asset.model=fixture.job.profile;fixture.job.result!.asset.identityVerification!.draftSimilarityFilter!.policyId=H3_DRAFT_SIMILARITY_POLICY_ID;fixture.job.result!.asset.identityVerification!.draftSimilarityFilter!.policySha256=H3_DRAFT_SIMILARITY_POLICY_SHA256;}
  const folder=await mkdtemp(path.join(tmpdir(),"current-policy-test-"));
  try{return await prepareCurrentIdentityPolicy(fixture.job,fixture.receipt,folder,{runPreflight:async(input,output)=>{
    preflights++;const request=JSON.parse(await readFile(input,"utf8")),family=getH3PolicyFamily(request.family.id)!;
    const identities=request.references.filter((reference:{role:string})=>reference.role==="identity");
    const galleries=identities.map((reference:{assetId:string;canonicalName:string;rawSha256:string})=>({...fixture.policy.body.galleries[0],referenceAssetId:reference.assetId,canonicalName:reference.canonicalName,rawSha256:reference.rawSha256}));
    await writeFile(output,JSON.stringify({version:1,bindingSha256:request.bindingSha256,familyId:family.id,familySha256:family.sha256,status:reject?"unverifiable":"ready",model:family.model,galleries,galleryProfileSha256:issuedGalleryProfileSha256(galleries)}));
  }});}finally{await rm(folder,{recursive:true,force:true});}
}
describe("truthful current-reference policy preparation",()=>{
  test("forwards current pinned ETag and fullhash while preserving the old generation package",async()=>{
    const before=identityPolicySha256(fixture.job);const prepared=await run();
    expect(downloads.map(reference=>reference.etag)).toEqual(['"current-0"','"current-1"']);
    expect(prepared.policy.body.references.map(reference=>reference.rawSha256)).toEqual(fixture.receipt.body.rawReferences.map(reference=>reference.sha256));
    expect(prepared.policy.body.originalPolicy.kind).toBe("issued");expect(prepared.policy.body.familyId).toBe("sface-yunet-foreground-frontal-v2");
    expect(identityPolicySha256(fixture.job)).toBe(before);expect(issues).toBe(1);expect(preflights).toBe(1);
  });
  test("legacy single-face policy stays explicitly legacy with strict .94 preparation",async()=>{
    const prepared=await run(true);expect(prepared.policy.body.originalPolicy).toEqual({kind:"legacy",id:H3_DRAFT_SIMILARITY_POLICY_ID,sha256:H3_DRAFT_SIMILARITY_POLICY_SHA256});
    expect(getH3PolicyFamily(prepared.policy.body.familyId)!.frontalGeometry.minimumDetectionScore).toBe(.94);expect(prepared.policy.body.generationModel).toBe("h3-ref2va-int8-v2");
  });
  test("changed bytes and oversized image headers fail before numerical preparation or issuance",async()=>{
    badBytes=true;await expect(run()).rejects.toThrow("bytes changed");expect(issues).toBe(0);expect(preflights).toBe(0);
    badBytes=false;tooLarge=true;await expect(run()).rejects.toThrow("bounds");expect(issues).toBe(0);expect(preflights).toBe(0);
  });
  test("unusable current gallery cannot issue a policy or trigger a generation policy",async()=>{
    await expect(run(false,true)).rejects.toThrow("coherent gallery");expect(issues).toBe(0);expect(preflights).toBe(1);
  });
});
