import { describe,expect,mock,test } from "bun:test";
import { h3IdentityAssessmentFixture } from "../helpers/h3IdentityAssessment";

const objects = new Map<string,string>();
class Get { constructor(public input: { Key: string }) {} }
class Put { constructor(public input: { Key: string; Body: string; IfNoneMatch?: string }) {} }
class Client {
  destroy() {}
  async send(command: Get | Put) {
    const { Key } = command.input;
    if (command instanceof Put) {
      expect(command.input.IfNoneMatch).toBe("*");
      if (objects.has(Key)) throw Object.assign(new Error("exists"),{$metadata:{httpStatusCode:412}});
      objects.set(Key,command.input.Body); return {};
    }
    const text=objects.get(Key); if (!text) throw Object.assign(new Error("missing"),{$metadata:{httpStatusCode:404}});
    return {ContentLength:Buffer.byteLength(text),Body:{transformToString:async()=>text}};
  }
}
mock.module("@aws-sdk/client-s3",()=>({S3Client:Client,GetObjectCommand:Get,PutObjectCommand:Put}));
mock.module("@/lib/mediaGateway",()=>({getMediaGatewayConfig:()=>({bucket:"studio"}),normalizeMediaPath:(value:string)=>value}));
process.env.RUSTFS_S3_ENDPOINT="https://storage.test";process.env.RUSTFS_ACCESS_KEY="test";process.env.RUSTFS_SECRET_KEY="synthetic";
const {claimH3IdentityAssessment,readH3IdentityAssessment,writeH3IdentityAssessment}=await import("@/lib/h3IdentityAssessmentStore");

describe("append-only canonical assessment storage",()=>{
  test("an intent replays exact inputs but cannot change its trim or policy",async()=>{
    objects.clear();const {scope}=h3IdentityAssessmentFixture();
    await claimH3IdentityAssessment(scope);await claimH3IdentityAssessment(scope);
    expect(objects.size).toBe(1);
    await expect(claimH3IdentityAssessment({...scope,trimStart:.75})).rejects.toThrow("different range or policy");
  });
  test("first evidence wins a replay and cannot be overwritten or rebound",async()=>{
    objects.clear();const {record}=h3IdentityAssessmentFixture();
    await writeH3IdentityAssessment(record);
    const replay={...record,assessedAt:"2026-11-06T03:00:00Z"};
    expect((await writeH3IdentityAssessment(replay)).assessedAt).toBe(record.assessedAt);
    expect(objects.size).toBe(1);
    await expect(writeH3IdentityAssessment({...record,scope:{...record.scope,firstFrame:13}})).rejects.toThrow("different immutable inputs");
    const {scope}=record;
    expect(await readH3IdentityAssessment(scope.ownerId,scope.projectId,scope.jobId,scope.id)).toEqual(record);
    expect(await readH3IdentityAssessment("another-owner",scope.projectId,scope.jobId,scope.id)).toBe(null);
  });
  test("rejects forged path IDs and foreign content at the owned object key",async()=>{
    objects.clear();const {record}=h3IdentityAssessmentFixture(),{scope}=record;
    await expect(readH3IdentityAssessment(scope.ownerId,scope.projectId,scope.jobId,"../other")).rejects.toThrow("Invalid range");
    await writeH3IdentityAssessment(record);
    const key=[...objects.keys()][0];objects.set(key,JSON.stringify({...record,scope:{...scope,ownerId:"another-owner"}}));
    await expect(readH3IdentityAssessment(scope.ownerId,scope.projectId,scope.jobId,scope.id)).rejects.toThrow("different owned shot");
  });
});
