import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { H3_FIRST_FRAME_PREPARATION, h3FirstFrameDigest, isH3FirstFrameId, normalizeH3FirstFrameArtifact, normalizeH3FirstFrameAssessment,
  type H3FirstFrameArtifact, type H3FirstFrameAssessment, type H3FirstFrameBody } from "@/components/studio/h3FirstFrame";
import type { H3GenerationJob } from "@/components/studio/h3Generation";
import { getMediaGatewayConfig } from "./mediaGateway";
import { mediaUploadBelongsToOwner } from "./essentiaUpload";
import { normalizeStudioOwnerSegment, normalizeStudioProjectId } from "./studioStoragePaths";
import { H3RequestError } from "./h3GenerationServer";

const MAX=32*1024*1024, MAX_JSON=256*1024;
let cached:{fingerprint:string;client:S3Client}|undefined;
function storage(){
  const gateway=getMediaGatewayConfig(),endpoint=process.env.RUSTFS_S3_ENDPOINT,accessKeyId=process.env.RUSTFS_ACCESS_KEY,secretAccessKey=process.env.RUSTFS_SECRET_KEY;
  if(!gateway||!endpoint||!accessKeyId||!secretAccessKey||new URL(endpoint).protocol!=="https:")throw new H3RequestError("Durable first-frame storage is not configured.",503);
  const fingerprint=h3FirstFrameDigest([endpoint,accessKeyId,secretAccessKey,process.env.RUSTFS_REGION??""]);
  if(cached?.fingerprint!==fingerprint){cached?.client.destroy();cached={fingerprint,client:new S3Client({endpoint,region:process.env.RUSTFS_REGION||"us-east-1",forcePathStyle:true,
    credentials:{accessKeyId,secretAccessKey},requestChecksumCalculation:"WHEN_REQUIRED",responseChecksumValidation:"WHEN_REQUIRED"})};}
  return {client:cached.client,bucket:gateway.bucket};
}
export function h3FirstFramePrefix(ownerId:string,projectId:string,artifactId:string){
  if(!isH3FirstFrameId(artifactId)||projectId!==normalizeStudioProjectId(projectId))throw new H3RequestError("Invalid first-frame artifact.");
  return `media-uploads/projects/${normalizeStudioOwnerSegment(ownerId)}/generation-conditioning/${projectId}/${artifactId}`;
}
const status=(e:unknown)=>(e as {$metadata?:{httpStatusCode?:number}})?.$metadata?.httpStatusCode;
async function getBytes(key:string,max:number){
  const {client,bucket}=storage();
  const response=await client.send(new GetObjectCommand({Bucket:bucket,Key:key}),{abortSignal:AbortSignal.timeout(60_000)});
  const body=response.Body;
  if(!body||!Number.isSafeInteger(response.ContentLength)||!response.ContentLength||response.ContentLength>max||!(Symbol.asyncIterator in body)){
    if(body&&"destroy" in body&&typeof body.destroy==="function")body.destroy();throw new H3RequestError("First-frame storage returned an invalid bounded object.",503);
  }
  const chunks:Uint8Array[]=[];let size=0;
  try{for await(const chunk of body as AsyncIterable<Uint8Array>){if(!(chunk instanceof Uint8Array))throw Error("Invalid stream");size+=chunk.byteLength;if(size>max||size>response.ContentLength)throw Error("Oversized stream");chunks.push(chunk);}}
  catch{body.destroy?.();throw new H3RequestError("First-frame storage bytes could not be verified.",503);}
  if(size!==response.ContentLength)throw new H3RequestError("First-frame storage returned incomplete bytes.",503);
  return Buffer.concat(chunks);
}
async function putOnce(key:string,bytes:Uint8Array,type:string){
  const {client,bucket}=storage();
  try{await client.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:bytes,ContentType:type,IfNoneMatch:"*"}),{abortSignal:AbortSignal.timeout(60_000)});}
  catch(error){if(![409,412].includes(status(error)??0))throw error;const existing=await getBytes(key,Math.max(bytes.byteLength,1));if(!existing.equals(Buffer.from(bytes)))throw new H3RequestError("Immutable first-frame artifact conflicts with stored bytes.",409);}
}
export async function validateH3FirstFramePng(bytes:Uint8Array,expectedSha256:string){
  if(!/^[a-f0-9]{64}$/.test(expectedSha256)||bytes.byteLength<33||bytes.byteLength>MAX||createHash("sha256").update(bytes).digest("hex")!==expectedSha256)throw new H3RequestError("First-frame PNG bytes do not match the expected SHA256.");
  const b=Buffer.from(bytes);
  if(!b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||b.toString("ascii",12,16)!=="IHDR"||b.readUInt32BE(16)!==1344||b.readUInt32BE(20)!==768)throw new H3RequestError("Choose an opaque 1344×768 PNG; images are never resized automatically.");
  let offset=8,ended=false;
  while(offset+12<=b.length){const length=b.readUInt32BE(offset),kind=b.toString("ascii",offset+4,offset+8);if(length>b.length-offset-12||kind==="acTL")throw new H3RequestError("Choose one complete PNG, not an animation.");offset+=length+12;if(kind==="IEND"){ended=true;break;}}
  if(!ended||offset!==b.length||b[24]!==8||![2,6].includes(b[25]))throw new H3RequestError("Choose one complete 8-bit RGB or opaque RGBA PNG.");
  try{const image=sharp(b,{limitInputPixels:1344*768,failOn:"warning"}),m=await image.metadata();if(m.width!==1344||m.height!==768||m.pages&&m.pages!==1)throw Error("Shape");const result=await image.raw().toBuffer({resolveWithObject:true});if(result.info.channels===4){for(let i=3;i<result.data.length;i+=4)if(result.data[i]!==255)throw Error("Alpha");}else if(result.info.channels!==3)throw Error("Channels");}
  catch{throw new H3RequestError("First-frame PNG must decode to opaque native-size RGB pixels.");}
}
export function assertH3FirstFrameMatchesJob(artifact:H3FirstFrameArtifact,job:H3GenerationJob){
  const body=artifact.body;
  if(!normalizeH3FirstFrameArtifact(artifact)||body.ownerId!==job.ownerId||body.projectId!==job.projectId||body.planSignature!==job.request.planSignature
    ||body.target.timelineItemId!==job.target.timelineItemId||body.target.requirementId!==job.target.requirementId||body.target.sectionId!==job.target.sectionId
    ||body.target.songStart!==job.request.songStart||body.target.songEnd!==job.request.songEnd||h3FirstFrameDigest(body.references)!==h3FirstFrameDigest(job.references))throw new H3RequestError("The prepared first frame belongs to a different target or reference version.",409);
}
export async function registerH3FirstFrame(job:H3GenerationJob,upload:{bucket:string;objectKey:string},expectedSha256:string){
  const {bucket}=storage();
  if(upload.bucket!==bucket||!mediaUploadBelongsToOwner(upload.objectKey,job.ownerId)||upload.objectKey.includes("\\")||upload.objectKey.split("/").some(p=>!p||p==="."||p===".."))throw new H3RequestError("Choose an uploaded image owned by this account.",403);
  const bytes=await getBytes(upload.objectKey,MAX);await validateH3FirstFramePng(bytes,expectedSha256);
  const body:H3FirstFrameBody={version:1,ownerId:job.ownerId,projectId:job.projectId,planSignature:job.request.planSignature,
    target:{timelineItemId:job.target.timelineItemId,...(job.target.requirementId?{requirementId:job.target.requirementId}:{}),sectionId:job.target.sectionId,songStart:job.request.songStart,songEnd:job.request.songEnd},references:job.references,
    pngSha256:expectedSha256,byteCount:bytes.length,width:1344,height:768,preparationVersion:H3_FIRST_FRAME_PREPARATION};
  const sha256=h3FirstFrameDigest(body),artifact:H3FirstFrameArtifact={version:1,id:`h3-frame-${sha256}`,sha256,body};
  if(!normalizeH3FirstFrameArtifact(artifact))throw new H3RequestError("The first-frame descriptor could not be frozen.",409);
  const prefix=h3FirstFramePrefix(job.ownerId,job.projectId,artifact.id);
  await putOnce(`${prefix}/first-frame.png`,bytes,"image/png");await putOnce(`${prefix}/record.json`,Buffer.from(JSON.stringify(artifact)),"application/json");return artifact;
}
export async function readH3FirstFrame(ownerId:string,projectId:string,id:string){
  let raw:unknown;try{raw=JSON.parse((await getBytes(`${h3FirstFramePrefix(ownerId,projectId,id)}/record.json`,MAX_JSON)).toString("utf8"));}catch(error){if(status(error)===404)return null;throw error;}
  const artifact=normalizeH3FirstFrameArtifact(raw);if(!artifact||artifact.id!==id||artifact.body.ownerId!==ownerId||artifact.body.projectId!==projectId)throw new H3RequestError("The owned first-frame descriptor is invalid.",409);return artifact;
}
export async function downloadH3FirstFrame(artifact:H3FirstFrameArtifact){
  if(!normalizeH3FirstFrameArtifact(artifact))throw new H3RequestError("Invalid first-frame descriptor.",409);
  const bytes=await getBytes(`${h3FirstFramePrefix(artifact.body.ownerId,artifact.body.projectId,artifact.id)}/first-frame.png`,MAX);
  if(bytes.length!==artifact.body.byteCount)throw new H3RequestError("First-frame byte count changed.",409);await validateH3FirstFramePng(bytes,artifact.body.pngSha256);return bytes;
}
export async function writeH3FirstFrameAssessment(artifact:H3FirstFrameArtifact,report:H3FirstFrameAssessment){
  const proof=normalizeH3FirstFrameAssessment(report);if(!proof||proof.artifactId!==artifact.id||proof.descriptorSha256!==artifact.sha256||proof.pngSha256!==artifact.body.pngSha256)throw new Error("Still evidence does not match its artifact.");
  const key=`${h3FirstFramePrefix(artifact.body.ownerId,artifact.body.projectId,artifact.id)}/assessments/${proof.policySha256}.json`;
  await putOnce(key,Buffer.from(JSON.stringify(proof)),"application/json");return proof;
}
export async function readH3FirstFrameAssessment(artifact:H3FirstFrameArtifact,policySha256:string){
  if(!/^[a-f0-9]{64}$/.test(policySha256))throw new Error("Invalid still policy digest.");
  try{const raw=JSON.parse((await getBytes(`${h3FirstFramePrefix(artifact.body.ownerId,artifact.body.projectId,artifact.id)}/assessments/${policySha256}.json`,MAX_JSON)).toString("utf8"));const proof=normalizeH3FirstFrameAssessment(raw);if(!proof||proof.policySha256!==policySha256||proof.artifactId!==artifact.id||proof.descriptorSha256!==artifact.sha256||proof.pngSha256!==artifact.body.pngSha256)throw new Error("Canonical still evidence is invalid.");return proof;}
  catch(error){if(status(error)===404)return null;throw error;}
}
