import {afterEach,describe,expect,mock,test} from "bun:test";
import sharp from "sharp";
import {createHash} from "node:crypto";
import {materializeH3Job} from "@/lib/h3GenerationServer";
import {h3ProjectFixture} from "../helpers/h3Project";
const objects=new Map<string,Buffer>();let declaredLength:number|undefined;let gets=0,puts=0;
class GetObjectCommand{constructor(public input:Record<string,unknown>){}}
class PutObjectCommand{constructor(public input:Record<string,unknown>){}}
class ListObjectsV2Command{constructor(public input:Record<string,unknown>){}}
const fail=(code:number)=>Object.assign(new Error("test-only storage error"),{$metadata:{httpStatusCode:code}});
class S3Client{destroy(){}async send(command:GetObjectCommand|PutObjectCommand){const k=String(command.input.Key);if(command instanceof GetObjectCommand){gets++;const bytes=objects.get(k);if(!bytes)throw fail(404);return {ContentLength:declaredLength??bytes.length,Body:{async *[Symbol.asyncIterator](){yield bytes;},destroy(){}}};}puts++;expect(command.input.IfNoneMatch).toBe("*");if(objects.has(k))throw fail(412);objects.set(k,Buffer.from(command.input.Body as Uint8Array));return{};}}
mock.module("@aws-sdk/client-s3",()=>({S3Client,GetObjectCommand,PutObjectCommand,ListObjectsV2Command}));
mock.module("@/lib/mediaGateway",()=>({getMediaGatewayConfig:()=>({bucket:"studio"})}));
const {registerH3FirstFrame,readH3FirstFrame,downloadH3FirstFrame,validateH3FirstFramePng,assertH3FirstFrameMatchesJob}=await import("@/lib/h3FirstFrameStore");
const names=["RUSTFS_S3_ENDPOINT","RUSTFS_ACCESS_KEY","RUSTFS_SECRET_KEY"] as const,previous=names.map(n=>process.env[n]);
afterEach(()=>names.forEach((n,i)=>{if(previous[i]===undefined)delete process.env[n];else process.env[n]=previous[i];}));
const hash=(b:Uint8Array)=>createHash("sha256").update(b).digest("hex");
async function setup(){objects.clear();declaredLength=undefined;gets=puts=0;process.env.RUSTFS_S3_ENDPOINT="https://storage.test";process.env.RUSTFS_ACCESS_KEY="test-only";process.env.RUSTFS_SECRET_KEY="test-only";
 const fixture=h3ProjectFixture(),job=materializeH3Job("github-test",fixture.saved,fixture.request,"studio");job.references.forEach((r,i)=>r.etag=`etag-${i}`);
 const bytes=await sharp({create:{width:1344,height:768,channels:3,background:"black"}}).png().toBuffer(),key="media-uploads/github-test/h3-first-frames/uuid/frame.png";objects.set(key,bytes);return{...fixture,job,bytes,upload:{bucket:"studio",objectKey:key}};
}
describe("owned write-once native first-frame storage",()=>{
 test("freezes exact bytes outside the project and reuses exact replay",async()=>{const{saved,job,bytes,upload}=await setup(),before=JSON.stringify(saved);const a=await registerH3FirstFrame(job,upload,hash(bytes)),b=await registerH3FirstFrame(job,upload,hash(bytes));expect(a).toEqual(b);expect(objects.size).toBe(3);expect(puts).toBe(4);expect(JSON.stringify(saved)).toBe(before);expect(await readH3FirstFrame(job.ownerId,job.projectId,a.id)).toEqual(a);expect(await downloadH3FirstFrame(a)).toEqual(bytes);expect(await readH3FirstFrame("other",job.projectId,a.id)).toBeNull();});
 test("rejects foreign bucket/owner/traversal before a storage read",async()=>{const{job,bytes}=await setup();for(const upload of [{bucket:"other",objectKey:"media-uploads/github-test/a"},{bucket:"studio",objectKey:"media-uploads/other/a"},{bucket:"studio",objectKey:"media-uploads/github-test/../a"}])await expect(registerH3FirstFrame(job,upload,hash(bytes))).rejects.toThrow();expect(gets).toBe(0);expect(puts).toBe(0);});
 test("bounded stream rejects undersized declarations and oversized objects",async()=>{const{job,bytes,upload}=await setup();for(const declared of [bytes.length-1,32*1024*1024+1]){declaredLength=declared;await expect(registerH3FirstFrame(job,upload,hash(bytes))).rejects.toThrow();}expect(puts).toBe(0);});
 test("rejects incorrect SHA, dimensions, nonopaque alpha and truncated PNG",async()=>{const{bytes}=await setup();await expect(validateH3FirstFramePng(bytes,"b".repeat(64))).rejects.toThrow("SHA256");for(const candidate of [await sharp({create:{width:1659,height:948,channels:3,background:"black"}}).png().toBuffer(),await sharp({create:{width:1344,height:768,channels:4,background:{r:0,g:0,b:0,alpha:.5}}}).png().toBuffer(),bytes.subarray(0,bytes.length-5)])await expect(validateH3FirstFramePng(candidate,hash(candidate))).rejects.toThrow();});
 test("changed canonical pixels or same-key bytes cannot inherit an artifact",async()=>{const{job,bytes,upload}=await setup(),a=await registerH3FirstFrame(job,upload,hash(bytes));const key=[...objects.keys()].find(k=>k.endsWith("first-frame.png"))!;objects.set(key,Buffer.from(bytes.map((v,i)=>i===bytes.length-1?v^1:v)));await expect(downloadH3FirstFrame(a)).rejects.toThrow();await expect(registerH3FirstFrame(job,upload,hash(bytes))).rejects.toThrow("conflicts");});
 test("target and pinned raw-reference changes reject reuse",async()=>{const{job,bytes,upload}=await setup(),a=await registerH3FirstFrame(job,upload,hash(bytes));expect(()=>assertH3FirstFrameMatchesJob(a,job)).not.toThrow();for(const changed of [{...job,request:{...job.request,songEnd:4}},{...job,references:job.references.map(r=>({...r,etag:"replaced"}))},{...job,ownerId:"other"}])expect(()=>assertH3FirstFrameMatchesJob(a,changed)).toThrow();});
});
