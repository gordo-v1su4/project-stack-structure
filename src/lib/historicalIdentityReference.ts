import {createHash} from "node:crypto";
import type {H3GenerationJob,H3ReferenceSnapshot} from "@/components/studio/h3Generation";
import type {ScopeRawReference} from "@/components/studio/generationScope";
import {currentIdentityOrigin} from "@/components/studio/currentReferenceIdentity";
import {identityPolicySha256} from "@/components/studio/issuedIdentityPolicy";
import {downloadH3ReferenceImage} from "./h3JobStore";
import {readGenerationScopeReceipt} from "./generationScopeStore";
import type {SavedStudioProject} from "./studioProjectStore";
const OLD="47d772694e0c14397707f31b7802fe91d434da1e4b54be7bac3eb00037364381",ASSET="character-1-1788717231561-sy1hpa";
export async function pinApprovedHistoricalDiegoBackup(ownerId:string,projectId:string,bucket:string):Promise<ScopeRawReference>{
  if(ownerId!=="github-179914528"||projectId!=="75101b25-fea6-42b1-b2c6-85a9d1deb8eb")throw new Error("Historical backup authority is outside this project.");
  const pin={assetId:ASSET,bucket,objectKey:`media-uploads/${ownerId}/reference-backups/2026-11-06/character-1-${OLD}.png`,etag:'"d9475dfaa1c5fa0f08367eac9f34d854"',sha256:OLD,byteLength:1965318};
  await readHistorical(pin);return pin;
}
async function readHistorical(pin:ScopeRawReference){
  const media=await downloadH3ReferenceImage({assetId:pin.assetId,canonicalName:"Diego",role:"identity",bucket:pin.bucket,objectKey:pin.objectKey,etag:pin.etag,version:`historical-bytes-${pin.sha256}`});
  if(media.bytes.byteLength!==pin.byteLength||createHash("sha256").update(new Uint8Array(media.bytes)).digest("hex")!==pin.sha256)throw new Error("Historical reference backup bytes differ.");
  return media;
}
/** Deterministic authorized resolution, never a fallback after a failed current-object read. Original snapshot/ETag are preserved. */
export async function historicalIdentityReferenceResolver(job:H3GenerationJob,saved:SavedStudioProject){
  const context=saved.draft.musicVideoProject?.currentIdentity;
  if(!context)return undefined;
  const migration=await readGenerationScopeReceipt(job.ownerId,job.projectId,`generation-scope-${context.migrationSha256}`),facts=migration?.body.referenceMigration;
  if(!migration||!facts||migration.body.ownerId!==job.ownerId||migration.body.projectId!==job.projectId||facts.contextSha256!==context.contextSha256)throw new Error("Canonical historical reference migration is unavailable.");
  const origin=facts.origins.find(entry=>entry.jobId===job.id);
  if(!origin||identityPolicySha256(origin)!==identityPolicySha256({jobId:job.id,...currentIdentityOrigin(job)}))throw new Error("Historical job lineage differs from its migration.");
  return async(reference:H3ReferenceSnapshot,index:number)=>{
    if(reference.assetId!==ASSET||job.referenceHashes?.[index]!==OLD)return downloadH3ReferenceImage(reference);
    const original=facts.historicalReferences.find(entry=>entry.assetId===ASSET),pin=facts.historicalBackups?.find(entry=>entry.assetId===ASSET);
    if(!pin||pin.sha256!==OLD||original?.sha256!==OLD||original.bucket!==reference.bucket||original.objectKey!==reference.objectKey||original.etag!==reference.etag
      ||pin.bucket!==reference.bucket||!pin.objectKey.startsWith(`media-uploads/${job.ownerId}/reference-backups/`))throw new Error("Historical resolver cannot alter original generation bindings.");
    return readHistorical(pin);
  };
}
