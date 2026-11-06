import {describe,expect,test} from "bun:test";
import {createHash} from "node:crypto";
import {H3_FIRST_FRAME_PROFILE,H3_FIRST_FRAME_PREPARATION,h3FirstFrameBinding,h3FirstFrameDigest,normalizeH3FirstFrameArtifact,normalizeH3FirstFrameReceipt} from "@/components/studio/h3FirstFrame";
import {H3_LEGACY_PROFILE,H3_PROFILE,H3_CONDITIONING_PREPARATION_VERSION,type H3GenerationProfileOptions} from "@/components/studio/h3Generation";
import {h3GenerationJobId,materializeH3Job,parseH3Request} from "@/lib/h3GenerationServer";
import {buildH3Workflow,compileH3Prompt,H3_I2VA_MODEL} from "@/lib/h3Workflow";
import {identityPolicySha256,normalizeH3PublicIssuedDraftPolicy,currentIdentityEvidenceSha256} from "@/components/studio/issuedIdentityPolicy";
import {generatedAssetDraftIdentityBlockReason} from "@/components/studio/generatedAssetIdentity";
import {hydrateGeneratedStudioAssets} from "@/components/studio/generatedAssets";
import {h3ProjectFixture} from "../helpers/h3Project";
import {firstFrameArtifactFixture,firstFrameAssessmentFixture} from "../helpers/h3FirstFrame";
import {issuedDraftAssetFixture} from "../helpers/issuedDraftAsset";
const sha=(v:unknown)=>createHash("sha256").update(JSON.stringify(v)).digest("hex");
describe("explicit native first-frame contract",()=>{
 test("old requests and legacy/v3 job identity tuples are byte-identical",()=>{
  const{saved,request}=h3ProjectFixture(),parsed=parseH3Request(request),job=materializeH3Job("github-test",saved,parsed,"studio");
  expect(Object.hasOwn(parsed,"conditioning")).toBe(false);
  expect(h3GenerationJobId(job.ownerId,parsed,job.references,{profile:H3_LEGACY_PROFILE})).toBe(`h3-${sha([H3_LEGACY_PROFILE,job.ownerId,parsed,job.references])}`);
  expect(job.id).toBe(`h3-${sha([H3_PROFILE,job.ownerId,parsed,job.references,H3_CONDITIONING_PREPARATION_VERSION])}`);
 });
 test("rejects malformed or unknown supplied modes instead of dropping them",()=>{
  const{request}=h3ProjectFixture();
  for(const conditioning of [null,{}, {kind:"reference"},{kind:"first-frame",artifactId:`h3-frame-${"a".repeat(64)}`,expectedSha256:"a".repeat(64),path:"/private"}])expect(()=>parseH3Request({...request,identityPolicyFamily:"sface-yunet-foreground-frontal-v2",conditioning})).toThrow();
 });
 test("new mode has an immutable graph, native alignment and different artifact-bound ID",()=>{
  const{saved,request}=h3ProjectFixture(),base=materializeH3Job("github-test",saved,request,"studio"),artifact=firstFrameArtifactFixture(base);
  const input=parseH3Request({...request,identityPolicyFamily:"sface-yunet-foreground-frontal-v2",conditioning:{kind:"first-frame",artifactId:artifact.id,expectedSha256:artifact.body.pngSha256}});
  const options:H3GenerationProfileOptions={profile:H3_FIRST_FRAME_PROFILE,conditioningPreparationVersion:H3_FIRST_FRAME_PREPARATION,firstFrame:artifact};
  const job=materializeH3Job("github-test",saved,input,"studio",options),built=buildH3Workflow(job,["owned/frame.png"]);
  expect(built.frames).toBe(124);expect((built.workflow.model as {inputs:Record<string,unknown>}).inputs.unet_name).toBe(H3_I2VA_MODEL);
  expect((built.workflow.cond as {class_type:string;inputs:Record<string,unknown>}).class_type).toBe("MiniMaxH3ImageToVideo");expect((built.workflow.cond as {class_type:string;inputs:Record<string,unknown>}).inputs.first_frame).toEqual(["reference_0",0]);
  expect((built.workflow.cond as {class_type:string;inputs:Record<string,unknown>}).inputs.last_frame).toBe(undefined);expect((built.workflow.cond as {class_type:string;inputs:Record<string,unknown>}).inputs.ref_image_size).toBe(undefined);expect((built.workflow.cond as {class_type:string;inputs:Record<string,unknown>}).inputs.audio_vae).toBe(undefined);
  expect(built.prompt.startsWith("For the target video, at 0.00 seconds")).toBe(true);expect(built.prompt).toContain("integrated_multimodal_description: [Shot 1]");expect(built.prompt).not.toContain("subject_definitions:");
  expect(()=>buildH3Workflow(job,["raw1","raw2"])).toThrow();expect(()=>materializeH3Job("github-test",saved,input,"studio")).toThrow();
  expect(()=>h3GenerationJobId(job.ownerId,input,job.references,{...options,firstFrame:{...artifact,sha256:"f".repeat(64)}})).toThrow();
  expect(compileH3Prompt(base).prompt).toContain("subject_definitions:");
 });
 test("a still receipt cannot stand in for video evidence and swapping it invalidates approval",()=>{
  const{asset,policy}=issuedDraftAssetFixture();
  policy.body.familyId="sface-yunet-foreground-frontal-v2";const familySha="45bd64dac164694b7715c7afd65debdea3a9b5db24725016f30fd05cea6ec6f4";policy.body.familySha256=familySha;policy.familyId=policy.body.familyId;policy.familySha256=familySha;
  const body={version:1 as const,ownerId:policy.body.ownerId,projectId:policy.body.projectId,planSignature:asset.target!.planSignature!,target:{timelineItemId:asset.target!.timelineItemId,requirementId:asset.target!.requirementId,sectionId:asset.target!.sectionId,songStart:asset.target!.songStart,songEnd:asset.target!.songEnd},
    references:policy.body.references.map(({rawSha256,...r})=>{void rawSha256;return{...r,etag:r.etag??"etag"};}),pngSha256:"a".repeat(64),byteCount:100,width:1344 as const,height:768 as const,preparationVersion:H3_FIRST_FRAME_PREPARATION};
  const digest=h3FirstFrameDigest(body),artifact={version:1 as const,id:`h3-frame-${digest}`,sha256:digest,body};
  policy.body.references=body.references.map((r,i)=>({...r,rawSha256:asset.generationReferenceHashes![i]}));policy.body.generationModel=H3_FIRST_FRAME_PROFILE;policy.body.firstFrame=h3FirstFrameBinding(artifact);policy.sha256=identityPolicySha256(policy.body);policy.id=`h3-policy-${policy.sha256}`;
  expect(normalizeH3FirstFrameArtifact(artifact)).toEqual(artifact);expect(normalizeH3PublicIssuedDraftPolicy(policy)).not.toBe(undefined);
  asset.model=H3_FIRST_FRAME_PROFILE;asset.identityVerification!.generationModel=asset.model;asset.identityVerification!.issuedPolicy={...policy};
  asset.identityVerification!.draftSimilarityFilter!.policyId=policy.id;asset.identityVerification!.draftSimilarityFilter!.policySha256=policy.sha256;
  asset.firstFrame={artifact,assessment:firstFrameAssessmentFixture(artifact,policy)};
  expect(normalizeH3FirstFrameReceipt(asset.firstFrame)).toEqual(asset.firstFrame);expect(generatedAssetDraftIdentityBlockReason(asset)).toBeNull();
  const original=currentIdentityEvidenceSha256(asset);expect(hydrateGeneratedStudioAssets([asset])[0].firstFrame).toEqual(asset.firstFrame);
  asset.firstFrame.assessment.decodedPixelSha256="e".repeat(64);expect(currentIdentityEvidenceSha256(asset)).not.toBe(original);
  asset.identityVerification=undefined;expect(generatedAssetDraftIdentityBlockReason(asset)).not.toBeNull();
 });
});
