import { generatedAssetDraftIdentityBlockReason, type GeneratedStudioAsset } from "./generatedAssets";

/** Choose only a measured earlier take from this project/plan, inside its selected trim. */
export function earlierH3FirstFrameSource(assets:GeneratedStudioAsset[],projectId:string|null,planSignature:string|undefined,songStart:number,identityReferenceAssetIds:readonly string[]){
  if(!projectId||!planSignature||!Number.isFinite(songStart)||!identityReferenceAssetIds.length||new Set(identityReferenceAssetIds).size!==identityReferenceAssetIds.length)return undefined;
  const candidates=assets.filter(asset=>{
    const parts=asset.fullStorage?.objectKey?.split("/");
    const identities=asset.identityVerification?.issuedPolicy?.body.galleries.map(gallery=>gallery.referenceAssetId);
    return asset.provider==="swarmui"&&asset.jobId?.startsWith("h3-")&&asset.status==="completed"&&asset.reviewStatus!=="rejected"
      &&identities?.length===identityReferenceAssetIds.length&&identities.every((id,index)=>id===identityReferenceAssetIds[index])
      &&asset.width===1344&&asset.height===768&&asset.mediaFrameRate===24&&asset.target?.planSignature===planSignature
      &&asset.target.songEnd<=songStart+1e-6&&parts?.length===7&&parts[0]==="media-uploads"&&parts[1]==="projects"&&parts[3]==="generated"
      &&parts[4]===projectId&&parts[5]===asset.jobId&&parts[6]==="shot.mp4"&&generatedAssetDraftIdentityBlockReason(asset)===null;
  }).sort((a,b)=>b.target!.songEnd-a.target!.songEnd||b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id));
  for(const asset of candidates){
    const first=Math.floor((asset.trimStart??0)*24+1e-6),end=Math.ceil(((asset.trimStart??0)+asset.target!.songEnd-asset.target!.songStart)*24-1e-6);
    if(end<=first||!Number.isSafeInteger(asset.mediaFrameCount)||end>asset.mediaFrameCount!)continue;
    const frameIndex=end-1,trimEnd=(asset.trimStart??0)+asset.target!.songEnd-asset.target!.songStart;
    const timeSeconds=(Math.max(asset.trimStart??0,frameIndex/24)+Math.min(trimEnd,(frameIndex+1)/24))/2;
    return{asset,frameIndex,timeSeconds};
  }
  return undefined;
}
