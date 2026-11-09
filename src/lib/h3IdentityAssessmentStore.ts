import { studioS3OriginOptions } from "./studioS3Origin";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { isH3IdentityAssessmentId, type H3IdentityAssessment, type H3IdentityAssessmentScope } from "@/components/studio/h3IdentityAssessment";
import { canonicalIdentityPolicyJson } from "@/components/studio/issuedIdentityPolicy";
import { getMediaGatewayConfig } from "./mediaGateway";
import { normalizeStudioOwnerSegment, normalizeStudioProjectId } from "./studioStoragePaths";

const MAX_BYTES = 2 * 1024 * 1024;
let cached: { hash: string; client: S3Client } | undefined;
function storage() {
  const gateway = getMediaGatewayConfig(), endpoint = process.env.RUSTFS_S3_ENDPOINT;
  const accessKeyId = process.env.RUSTFS_ACCESS_KEY, secretAccessKey = process.env.RUSTFS_SECRET_KEY;
  if (!gateway || !endpoint || !accessKeyId || !secretAccessKey || new URL(endpoint).protocol !== "https:") throw new Error("Durable assessment storage is not configured.");
  const hash = createHash("sha256").update(JSON.stringify([endpoint, accessKeyId, secretAccessKey, process.env.RUSTFS_S3_ORIGIN_ADDRESS?.trim() || "", process.env.RUSTFS_REGION])).digest("hex");
  if (cached?.hash !== hash) {
    cached?.client.destroy();
    cached = { hash, client: new S3Client({ ...studioS3OriginOptions(endpoint), endpoint, region: process.env.RUSTFS_REGION || "us-east-1", forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey }, requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" }) };
  }
  return { client: cached.client, bucket: gateway.bucket };
}
function key(ownerId: string, projectId: string, jobId: string, id: string) {
  if (!isH3IdentityAssessmentId(id) || !/^h3-[a-f0-9]{64}$/.test(jobId) || normalizeStudioProjectId(projectId) !== projectId) throw new Error("Invalid range assessment identity.");
  return `media-uploads/projects/${normalizeStudioOwnerSegment(ownerId)}/identity-assessments/${projectId}/${jobId}/${id}.json`;
}
const status = (error: unknown) => (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;

/** Lost dispatch recovery reuses exact inputs; one deliberate intent cannot change its trim. */
export async function claimH3IdentityAssessment(scope: H3IdentityAssessmentScope) {
  const prefix = key(scope.ownerId,scope.projectId,scope.jobId,scope.id).replace(/[^/]+$/,"");
  if (!/^[a-f0-9-]{36}$/i.test(scope.requestIntentId)) throw new Error("An assessment intent UUID is required.");
  const objectKey = `${prefix}intents/${scope.requestIntentId}.json`, { client,bucket } = storage();
  const body = canonicalIdentityPolicyJson(scope);
  try {
    await client.send(new PutObjectCommand({ Bucket: bucket,Key: objectKey,Body: body,ContentType:"application/json",IfNoneMatch:"*" }),{abortSignal:AbortSignal.timeout(15_000)});
  } catch(error) {
    if (status(error) !== 409 && status(error) !== 412) throw error;
    const response = await client.send(new GetObjectCommand({Bucket:bucket,Key:objectKey}),{abortSignal:AbortSignal.timeout(15_000)});
    if (!response.Body || (response.ContentLength ?? 0) > 16*1024) throw new Error("Invalid assessment intent binding.");
    const previous = await response.Body.transformToString();
    if (Buffer.byteLength(previous) > 16*1024 || canonicalIdentityPolicyJson(JSON.parse(previous)) !== body) throw new Error("This assessment intent already belongs to a different range or policy.");
  }
}

export async function readH3IdentityAssessment(ownerId: string, projectId: string, jobId: string, id: string): Promise<H3IdentityAssessment | null> {
  const objectKey = key(ownerId,projectId,jobId,id), { client,bucket } = storage();
  let record: H3IdentityAssessment;
  try {
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey }), { abortSignal: AbortSignal.timeout(15_000) });
    if (!response.Body || (response.ContentLength ?? 0) > MAX_BYTES) throw new Error("Range assessment exceeds its storage bound.");
    const text = await response.Body.transformToString();
    if (Buffer.byteLength(text) > MAX_BYTES) throw new Error("Range assessment exceeds its storage bound.");
    record = JSON.parse(text);
  } catch (error) { if (status(error) === 404) return null; throw error; }
  if (record?.version !== 1 || record.scope?.id !== id || record.scope.ownerId !== ownerId || record.scope.projectId !== projectId
    || record.scope.jobId !== jobId || !["ready","failed"].includes(record.status)) throw new Error("Range assessment belongs to a different owned shot.");
  return record;
}

/** Worker-only append: a completed or failed assessment intent is never overwritten. */
export async function writeH3IdentityAssessment(record: H3IdentityAssessment): Promise<H3IdentityAssessment> {
  const { scope } = record, objectKey = key(scope.ownerId,scope.projectId,scope.jobId,scope.id), { client,bucket } = storage();
  const body = JSON.stringify(record);
  if (Buffer.byteLength(body) > MAX_BYTES) throw new Error("Range assessment exceeds its storage bound.");
  try {
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: objectKey, Body: body, ContentType: "application/json", IfNoneMatch: "*" }), { abortSignal: AbortSignal.timeout(15_000) });
    return record;
  } catch (error) {
    if (status(error) !== 409 && status(error) !== 412) throw error;
    const existing = await readH3IdentityAssessment(scope.ownerId,scope.projectId,scope.jobId,scope.id);
    if (!existing || canonicalIdentityPolicyJson(existing.scope) !== canonicalIdentityPolicyJson(scope)) throw new Error("Assessment intent already has different immutable inputs.");
    return existing;
  }
}
