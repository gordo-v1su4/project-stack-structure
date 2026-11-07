import {readFile,stat,writeFile} from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {createHash} from "node:crypto";
import {CURRENT_IDENTITY_PURPOSE,originalCurrentIdentityPolicy,type CurrentIdentityPolicy} from "@/components/studio/currentReferenceIdentity";
import {getH3PolicyFamily,identityPolicySha256,issuedGalleryProfileSha256,normalizeGallery,type H3IdentityPolicyPreflightResult,type H3PolicyRawReference} from "@/components/studio/issuedIdentityPolicy";
import type {H3GenerationJob} from "@/components/studio/h3Generation";
import type {GenerationScopeReceipt} from "@/components/studio/generationScope";
import {downloadH3ReferenceImage} from "./h3JobStore";
import {runPreflight} from "./h3DraftPolicyPreparation";
import {storeCurrentIdentityPolicy} from "./currentIdentityStore";
import {assertIssuedH3DraftPolicyMatchesJob,readIssuedH3DraftPolicy} from "./h3DraftPolicyStore";

export async function prepareCurrentIdentityPolicy(job:H3GenerationJob,migration:GenerationScopeReceipt,tempFolder:string,
  options:{runPreflight?:(input:string,output:string)=>Promise<void>}={}) {
  const originalPolicy=originalCurrentIdentityPolicy(job);
  if(job.identityPolicy){const original=await readIssuedH3DraftPolicy(job.ownerId,job.projectId,job.identityPolicy);
    if(!original)throw new Error("Canonical historical policy is unavailable.");assertIssuedH3DraftPolicyMatchesJob(original,job,job.referenceHashes??[]);}
  const family=getH3PolicyFamily(job.identityPolicy?.familyId??"sface-yunet-foreground-frontal-v1");
  if(!family)throw new Error("Unsupported current-reference preparation family.");
  const references:{raw:H3PolicyRawReference;path:string;hash:string;canonicalName:string;role:string}[]=[];
  for(const [index,original]of job.references.entries()){
    const pin=migration.body.rawReferences.find(reference=>reference.assetId===original.assetId);
    if(!pin||pin.bucket!==original.bucket||pin.objectKey!==original.objectKey)throw new Error("Current reference is outside this historical job's lineage.");
    const snapshot={...original,etag:pin.etag,version:identityPolicySha256({purpose:CURRENT_IDENTITY_PURPOSE,assetId:original.assetId,etag:pin.etag,rawSha256:pin.sha256})};
    const media=await downloadH3ReferenceImage(snapshot),bytes=new Uint8Array(media.bytes);
    if(bytes.length!==pin.byteLength||bytes.length>32*1024*1024||createHash("sha256").update(bytes).digest("hex")!==pin.sha256)throw new Error("Pinned current reference bytes changed.");
    const metadata=await sharp(bytes,{limitInputPixels:32*1024*1024}).metadata();
    if(!metadata.width||!metadata.height||Math.max(metadata.width,metadata.height)>8192||metadata.width*metadata.height>32*1024*1024||!["png","jpeg","webp"].includes(metadata.format??""))throw new Error("Current reference headers exceed their image bounds.");
    const local=path.join(tempFolder,`current-reference-${index}`);await writeFile(local,bytes);
    references.push({raw:{...snapshot,rawSha256:pin.sha256},path:local,hash:pin.sha256,canonicalName:original.canonicalName,role:original.role});
  }
  const raw=references.map(reference=>reference.raw),bindingSha256=identityPolicySha256({purpose:CURRENT_IDENTITY_PURPOSE,ownerId:job.ownerId,projectId:job.projectId,originalPolicy,references:raw,family});
  const input=path.join(tempFolder,"current-policy-input.json"),output=path.join(tempFolder,"current-policy-report.json");
  await writeFile(input,JSON.stringify({version:1,bindingSha256,family,references:references.map(reference=>({...reference.raw,localPath:reference.path}))}));
  await(options.runPreflight??runPreflight)(input,output);
  if((await stat(output)).size>256*1024)throw new Error("Current-reference preflight exceeds its report bound.");
  const report=JSON.parse(await readFile(output,"utf8"))as H3IdentityPolicyPreflightResult;
  const identities=raw.filter(reference=>reference.role==="identity");
  const galleries=identities.map(reference=>normalizeGallery(report.galleries?.find(gallery=>gallery.referenceAssetId===reference.assetId),reference,family));
  if(report.version!==1||report.status!=="ready"||report.bindingSha256!==bindingSha256||report.familyId!==family.id||report.familySha256!==family.sha256
    ||identityPolicySha256(report.model)!==identityPolicySha256(family.model)||galleries.some(gallery=>!gallery)||report.galleries.length!==identities.length
    ||report.galleryProfileSha256!==issuedGalleryProfileSha256(galleries as NonNullable<typeof galleries[number]>[]))throw new Error("Current reference did not establish an exact coherent gallery.");
  const body:CurrentIdentityPolicy["body"]={version:1,purpose:CURRENT_IDENTITY_PURPOSE,ownerId:job.ownerId,projectId:job.projectId,generationModel:job.profile,
    originalPolicy,familyId:family.id,familySha256:family.sha256,references:raw,identityReferenceHashes:identities.map(reference=>reference.rawSha256),
    galleries:galleries as NonNullable<typeof galleries[number]>[],galleryProfileSha256:report.galleryProfileSha256!,preprocessVersion:`${family.model.preprocessBaseVersion}-gallery-v2-${report.galleryProfileSha256}`};
  const sha256=identityPolicySha256(body),policy:CurrentIdentityPolicy={version:1,id:`h3-current-policy-${sha256}`,sha256,body};
  await storeCurrentIdentityPolicy(policy);
  return {policy,references:references.map(reference=>({path:reference.path,hash:reference.hash,canonicalName:reference.canonicalName,role:reference.role,
    ...(policy.body.galleries.find(gallery=>gallery.rawSha256===reference.hash)?{faceRegions:policy.body.galleries.find(gallery=>gallery.rawSha256===reference.hash)!.faceRegions}:{})}))};
}
