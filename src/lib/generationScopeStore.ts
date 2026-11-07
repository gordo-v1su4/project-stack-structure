import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { generationScopeSha256, normalizeGenerationScopeReceipt, type GenerationScopeReceipt } from "@/components/studio/generationScope";
import { getMediaGatewayConfig } from "./mediaGateway";
import { normalizeStudioOwnerSegment, normalizeStudioProjectId } from "./studioStoragePaths";

let cached: { fingerprint: string; client: S3Client } | undefined;
const MAX_BYTES = 128 * 1024;
function storage() {
  const gateway = getMediaGatewayConfig(), endpoint = process.env.RUSTFS_S3_ENDPOINT;
  const accessKeyId = process.env.RUSTFS_ACCESS_KEY, secretAccessKey = process.env.RUSTFS_SECRET_KEY;
  if (!gateway || !endpoint || !accessKeyId || !secretAccessKey || new URL(endpoint).protocol !== "https:") throw new Error("Source confirmation storage is unavailable.");
  const fingerprint = generationScopeSha256([endpoint, accessKeyId, secretAccessKey, process.env.RUSTFS_REGION ?? ""]);
  if (cached?.fingerprint !== fingerprint) {
    cached?.client.destroy();
    cached = { fingerprint, client: new S3Client({ endpoint, region: process.env.RUSTFS_REGION || "us-east-1", forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey }, requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" }) };
  }
  return { client: cached.client, bucket: gateway.bucket };
}
function key(ownerId: string, projectId: string, id: string) {
  if (!/^generation-scope-[a-f0-9]{64}$/.test(id) || projectId !== normalizeStudioProjectId(projectId)) throw new Error("Invalid source confirmation receipt.");
  return `media-uploads/projects/${normalizeStudioOwnerSegment(ownerId)}/generation-scopes/${projectId}/${id}.json`;
}
const status = (error: unknown) => (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
export async function readGenerationScopeReceipt(ownerId: string, projectId: string, id: string): Promise<GenerationScopeReceipt | null> {
  const { client, bucket } = storage();
  let value: unknown;
  try {
    const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key(ownerId, projectId, id) }), { abortSignal: AbortSignal.timeout(15_000) });
    if (!result.Body || (result.ContentLength ?? 0) > MAX_BYTES) throw new Error("Source confirmation receipt exceeds its bound.");
    const bytes = await result.Body.transformToByteArray();
    if (bytes.length > MAX_BYTES) throw new Error("Source confirmation receipt exceeds its bound.");
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) { if (status(error) === 404) return null; throw error; }
  const receipt = normalizeGenerationScopeReceipt(value);
  if (!receipt || receipt.id !== id || receipt.body.ownerId !== ownerId || receipt.body.projectId !== projectId) throw new Error("The canonical source confirmation receipt is invalid.");
  return receipt;
}
export async function storeGenerationScopeReceipt(receipt: GenerationScopeReceipt): Promise<void> {
  if (!normalizeGenerationScopeReceipt(receipt)) throw new Error("Invalid source confirmation receipt.");
  const { client, bucket } = storage(), { ownerId, projectId } = receipt.body;
  const body = JSON.stringify(receipt);
  if (Buffer.byteLength(body) > MAX_BYTES) throw new Error("Source confirmation receipt exceeds its bound.");
  try {
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key(ownerId, projectId, receipt.id), Body: body,
      ContentType: "application/json", IfNoneMatch: "*" }), { abortSignal: AbortSignal.timeout(15_000) });
  } catch (error) {
    if (status(error) !== 412) throw error;
    const prior = await readGenerationScopeReceipt(ownerId, projectId, receipt.id);
    if (generationScopeSha256(prior) !== generationScopeSha256(receipt)) throw new Error("An immutable source confirmation receipt differs.");
  }
}

function baselineKey(ownerId: string, projectId: string, scope: string, semantic: string) {
  if (projectId !== normalizeStudioProjectId(projectId) || !/^[a-f0-9]{64}$/.test(semantic)) throw new Error("Invalid generation baseline scope.");
  return `media-uploads/projects/${normalizeStudioOwnerSegment(ownerId)}/generation-scopes/${projectId}/baselines/${generationScopeSha256([scope, semantic])}.json`;
}
export async function readGenerationScopeBaseline(ownerId: string, projectId: string, scope: string, semantic: string): Promise<GenerationScopeReceipt | null> {
  const { client, bucket } = storage();
  try {
    const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: baselineKey(ownerId, projectId, scope, semantic) }), { abortSignal: AbortSignal.timeout(15_000) });
    if (!result.Body || (result.ContentLength ?? 0) > MAX_BYTES) throw new Error("Generation baseline exceeds its bound.");
    const bytes = await result.Body.transformToByteArray();
    if (bytes.length > MAX_BYTES) throw new Error("Generation baseline exceeds its bound.");
    const receipt = normalizeGenerationScopeReceipt(JSON.parse(new TextDecoder().decode(bytes)));
    if (!receipt || receipt.body.kind !== "baseline" || receipt.body.ownerId !== ownerId || receipt.body.projectId !== projectId
      || receipt.body.scopeSignature !== scope || receipt.body.semanticSha256 !== semantic) throw new Error("The canonical generation baseline differs.");
    return receipt;
  } catch (error) { if (status(error) === 404) return null; throw error; }
}
export async function storeGenerationScopeBaseline(receipt: GenerationScopeReceipt): Promise<void> {
  if (!normalizeGenerationScopeReceipt(receipt) || receipt.body.kind !== "baseline") throw new Error("Invalid generation baseline.");
  const { client, bucket } = storage(), b = receipt.body, body = JSON.stringify(receipt);
  if (Buffer.byteLength(body) > MAX_BYTES) throw new Error("Generation baseline exceeds its bound.");
  const target = baselineKey(b.ownerId, b.projectId, b.scopeSignature, b.semanticSha256);
  // Claim enrollment first. An issued baseline disappearing must never turn a historical scope into a new pixel/version enrollment.
  try {
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: `${target}.enrollment`, Body: JSON.stringify({ version: 1, id: receipt.id }),
      ContentType: "application/json", IfNoneMatch: "*" }), { abortSignal: AbortSignal.timeout(15_000) });
  } catch (error) {
    if (status(error) !== 412) throw error;
    const prior = await readGenerationScopeBaseline(b.ownerId, b.projectId, b.scopeSignature, b.semanticSha256);
    if (!prior || prior.body.sourceInventorySha256 !== b.sourceInventorySha256 || prior.body.storySha256 !== b.storySha256
      || generationScopeSha256(prior.body.rawReferences) !== generationScopeSha256(b.rawReferences)
      || generationScopeSha256(prior.body.sourceMediaVersions) !== generationScopeSha256(b.sourceMediaVersions)
      || generationScopeSha256(prior.body.references) !== generationScopeSha256(b.references)) throw new Error("The issued generation baseline is missing or changed. Its scope cannot be re-enrolled.");
    return;
  }
  try {
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: target, Body: body,
      ContentType: "application/json", IfNoneMatch: "*" }), { abortSignal: AbortSignal.timeout(15_000) });
  } catch (error) {
    if (status(error) !== 412) throw error;
    const prior = await readGenerationScopeBaseline(b.ownerId, b.projectId, b.scopeSignature, b.semanticSha256);
    if (!prior || prior.body.sourceInventorySha256 !== b.sourceInventorySha256 || prior.body.storySha256 !== b.storySha256
      || generationScopeSha256(prior.body.rawReferences) !== generationScopeSha256(b.rawReferences)
      || generationScopeSha256(prior.body.sourceMediaVersions) !== generationScopeSha256(b.sourceMediaVersions)
      || generationScopeSha256(prior.body.references) !== generationScopeSha256(b.references)) throw new Error("An immutable generation baseline differs.");
  }
}
