import{describe,expect,test}from"bun:test";import{earlierH3FirstFrameSource}from"@/components/studio/h3FirstFrameSource";import{issuedDraftAssetFixture}from"../helpers/issuedDraftAsset";
import{generatedAssetDraftIdentityBlockReason}from"@/components/studio/generatedAssetIdentity";import{identityPolicySha256}from"@/components/studio/issuedIdentityPolicy";
describe("earlier native frame source",()=>{
 test("chooses the final included native frame even when the selected trim has a fractional-frame tail",()=>{const{asset}=issuedDraftAssetFixture();asset.width=1344;asset.height=768;const source=earlierH3FirstFrameSource([asset],"new-named-character-project","plan",3,["maya"])!;expect(source.asset.id).toBe(asset.id);expect(source.frameIndex).toBe(36);expect(source.timeSeconds).toBeGreaterThan(1.5);expect(source.timeSeconds).toBeLessThan(1.51);});
 test("rejects foreign/old-plan/rejected/unmeasured/future/non-native takes",()=>{for(const change of ["project","plan","rejected","unmeasured","future","resolution"]){const{asset}=issuedDraftAssetFixture();asset.width=1344;asset.height=768;if(change==="project")asset.fullStorage!.objectKey=asset.fullStorage!.objectKey.replace("new-named-character-project","other");if(change==="plan")asset.target!.planSignature="old";if(change==="rejected")asset.reviewStatus="rejected";if(change==="unmeasured")delete asset.identityVerification;if(change==="resolution")asset.width=1659;expect(earlierH3FirstFrameSource([asset],"new-named-character-project","plan",change==="future"?0:3,["maya"])).toBe(undefined);}});
 test("skips a closer incompatible solo or pair and offers the older exact identity authority",()=>{
  const older=issuedDraftAssetFixture().asset;older.width=1344;older.height=768;
  for(const kind of ["foreground","joint"] as const){const newer=issuedDraftAssetFixture(kind).asset;newer.width=1344;newer.height=768;newer.target!.songStart+=2;newer.target!.songEnd+=2;
   if(kind==="foreground"){const policy=newer.identityVerification!.issuedPolicy!;policy.body.references[0].assetId="other-identity";policy.body.galleries[0].referenceAssetId="other-identity";policy.sha256=identityPolicySha256(policy.body);policy.id=`h3-policy-${policy.sha256}`;newer.identityVerification!.draftSimilarityFilter!.policyId=policy.id;newer.identityVerification!.draftSimilarityFilter!.policySha256=policy.sha256;}
   expect(generatedAssetDraftIdentityBlockReason(newer)).toBeNull();
   expect(earlierH3FirstFrameSource([newer,older],"new-named-character-project","plan",5,["maya"])?.asset).toBe(older);
  }
 });
});
