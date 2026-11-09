import { studioS3OriginOptions } from "./studioS3Origin";
import { createHash } from "node:crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { canonicalIdentityPolicyJson, getH3PolicyFamily, normalizeH3IssuedDraftPolicy,
  type H3IdentityPolicyPreflightResult, type H3IssuedDraftPolicy, type H3IssuedDraftPolicyBinding,
  type H3IssuedDraftPolicyBody, type H3PolicyRawReference } from "@/components/studio/issuedIdentityPolicy";
import type { H3GenerationJob } from "@/components/studio/h3Generation";
import { getMediaGatewayConfig } from "./mediaGateway";
import { normalizeStudioOwnerSegment, normalizeStudioProjectId } from "./studioStoragePaths";
import { H3_FIRST_FRAME_PROFILE, h3FirstFrameBinding } from "@/components/studio/h3FirstFrame";

let cached: { fingerprint: string; client: S3Client } | undefined;
const MAX_POLICY_BYTES = 256 * 1024;
export const identityPolicySha256 = (value: unknown) => createHash("sha256").update(canonicalIdentityPolicyJson(value), "utf8").digest("hex");
function storage() {
  const gateway = getMediaGatewayConfig(), endpoint = process.env.RUSTFS_S3_ENDPOINT;
  const accessKeyId = process.env.RUSTFS_ACCESS_KEY, secretAccessKey = process.env.RUSTFS_SECRET_KEY;
  if (!gateway || !endpoint || !accessKeyId || !secretAccessKey || new URL(endpoint).protocol !== "https:") throw new Error("Durable identity policy storage is not configured.");
  const fingerprint = identityPolicySha256([endpoint, accessKeyId, secretAccessKey, process.env.RUSTFS_S3_ORIGIN_ADDRESS?.trim() || "", process.env.RUSTFS_REGION ?? ""]);
  if (cached?.fingerprint !== fingerprint) {
    cached?.client.destroy();
    cached = { fingerprint, client: new S3Client({ ...studioS3OriginOptions(endpoint), endpoint, region: process.env.RUSTFS_REGION || "us-east-1", forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey }, requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" }) };
  }
  return { client: cached.client, bucket: gateway.bucket };
}
function key(ownerId: string, projectId: string, id: string) {
  if (!/^h3-policy-[a-f0-9]{64}$/.test(id) || projectId !== normalizeStudioProjectId(projectId)) throw new Error("Invalid issued identity policy binding.");
  return `media-uploads/projects/${normalizeStudioOwnerSegment(ownerId)}/identity-policies/${projectId}/${id}.json`;
}
function status(error: unknown) { return (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode; }

export function identityPolicyPreflightBinding(job: H3GenerationJob, rawReferences: H3PolicyRawReference[]) {
  const family = getH3PolicyFamily(job.request.identityPolicyFamily ?? "");
  if (!family) throw new Error("A fixed identity policy family must be chosen for this job.");
  return identityPolicySha256({ ownerId: job.ownerId, projectId: job.projectId, generationModel: job.profile,
    familyId: family.id, familySha256: family.sha256, references: rawReferences,
    ...(job.firstFrame?{firstFrame:h3FirstFrameBinding(job.firstFrame)}:{}) });
}

/** Exact canonical job references, including their pinned storage versions, anchor issuance. */
export function assertIssuedH3DraftPolicyMatchesJob(policy: H3IssuedDraftPolicy, job: H3GenerationJob, rawReferenceHashes: readonly string[]) {
  const family = getH3PolicyFamily(job.request.identityPolicyFamily ?? "");
  const body = policy.body;
  if(canonicalIdentityPolicyJson(body.firstFrame??null)!==canonicalIdentityPolicyJson(job.firstFrame?h3FirstFrameBinding(job.firstFrame):null))throw new Error("Issued first-frame artifact binding differs.");
  if (!family || policy.familyId !== family.id || policy.familySha256 !== family.sha256
    || body.ownerId !== job.ownerId || body.projectId !== job.projectId || body.generationModel !== job.profile
    || rawReferenceHashes.length !== job.references.length || body.references.length !== job.references.length
    || policy.sha256 !== identityPolicySha256(body) || policy.id !== `h3-policy-${policy.sha256}`
    || (job.identityPolicy && canonicalIdentityPolicyJson(job.identityPolicy) !== canonicalIdentityPolicyJson({ version: policy.version, id: policy.id,
      sha256: policy.sha256, familyId: policy.familyId, familySha256: policy.familySha256 }))) throw new Error("Issued identity policy does not match this owned job.");
  for (const [index, reference] of job.references.entries()) {
    if (!reference.etag || !/^[a-f0-9]{64}$/.test(rawReferenceHashes[index] ?? "")
      || canonicalIdentityPolicyJson(body.references[index]) !== canonicalIdentityPolicyJson({ ...reference, rawSha256: rawReferenceHashes[index] })) {
      throw new Error("Issued identity policy raw references changed.");
    }
  }
  const identities = body.references.filter(reference => reference.role === "identity");
  if (identities.length !== family.scope.requiredIdentityCount || new Set(identities.map(reference => reference.rawSha256)).size !== identities.length
    || canonicalIdentityPolicyJson(body.identityReferenceHashes) !== canonicalIdentityPolicyJson(identities.map(reference => reference.rawSha256))
    || body.galleries.length !== identities.length || body.preprocessVersion !== `${family.model.preprocessBaseVersion}-gallery-v2-${body.galleryProfileSha256}`) {
    throw new Error("Issued identity gallery is incomplete or ambiguous.");
  }
  for (const [index, reference] of identities.entries()) {
    const gallery = body.galleries[index];
    if (gallery.referenceAssetId !== reference.assetId || gallery.canonicalName !== reference.canonicalName || gallery.rawSha256 !== reference.rawSha256) {
      throw new Error("Issued identity gallery does not match its declared raw authority.");
    }
  }
}

export async function readIssuedH3DraftPolicy(ownerId: string, projectId: string, binding: H3IssuedDraftPolicyBinding): Promise<H3IssuedDraftPolicy | null> {
  const { client, bucket } = storage();
  let value: unknown;
  try {
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key(ownerId, projectId, binding.id) }), { abortSignal: AbortSignal.timeout(15_000) });
    if (!response.Body || (response.ContentLength ?? 0) > MAX_POLICY_BYTES) throw new Error("Issued identity policy exceeds its storage bound.");
    const text = await response.Body.transformToString();
    if (Buffer.byteLength(text, "utf8") > MAX_POLICY_BYTES) throw new Error("Issued identity policy exceeds its storage bound.");
    value = JSON.parse(text);
  } catch (error) { if (status(error) === 404) return null; throw error; }
  const policy = normalizeH3IssuedDraftPolicy(value);
  if (!policy || policy.body.ownerId !== ownerId || policy.body.projectId !== projectId
    || policy.id !== binding.id || policy.sha256 !== binding.sha256 || policy.familyId !== binding.familyId || policy.familySha256 !== binding.familySha256
    || identityPolicySha256((value as H3IssuedDraftPolicy).body) !== policy.sha256 || identityPolicySha256(policy.body) !== policy.sha256) {
    throw new Error("The canonical issued identity policy is corrupt or belongs to another project.");
  }
  return policy;
}

/** Worker-only issuance: browser policy bodies, numeric scope and owner claims never reach this function. */
export async function issueH3DraftPolicy(input: { job: H3GenerationJob; rawReferences: H3PolicyRawReference[]; preflight: H3IdentityPolicyPreflightResult }): Promise<H3IssuedDraftPolicy> {
  const { job, rawReferences, preflight } = input;
  const family = getH3PolicyFamily(job.request.identityPolicyFamily ?? "");
  if (!family || !["h3-ref2va-int8-v3",H3_FIRST_FRAME_PROFILE].includes(job.profile) || preflight.version !== 1 || preflight.status !== "ready"
    || preflight.bindingSha256 !== identityPolicyPreflightBinding(job, rawReferences)
    || preflight.familyId !== family.id || preflight.familySha256 !== family.sha256
    || canonicalIdentityPolicyJson(preflight.model) !== canonicalIdentityPolicyJson(family.model)
    || !/^[a-f0-9]{64}$/.test(preflight.galleryProfileSha256 ?? "")) throw new Error("Reference preflight did not establish a usable fixed-family gallery.");
  const body: H3IssuedDraftPolicyBody = { version: 1, ownerId: job.ownerId, projectId: job.projectId, generationModel: job.profile as H3IssuedDraftPolicyBody["generationModel"],
    familyId: family.id, familySha256: family.sha256, references: rawReferences,
    identityReferenceHashes: rawReferences.filter(reference => reference.role === "identity").map(reference => reference.rawSha256),
    galleries: preflight.galleries, galleryProfileSha256: preflight.galleryProfileSha256!,
    preprocessVersion: `${family.model.preprocessBaseVersion}-gallery-v2-${preflight.galleryProfileSha256}`,
    ...(job.firstFrame?{firstFrame:h3FirstFrameBinding(job.firstFrame)}:{}) };
  const sha256 = identityPolicySha256(body);
  const candidate = { version: 1, id: `h3-policy-${sha256}`, sha256, familyId: family.id, familySha256: family.sha256, body, issuedAt: new Date().toISOString() };
  const policy = normalizeH3IssuedDraftPolicy(candidate);
  if (!policy || identityPolicySha256(policy.body) !== sha256) throw new Error("Reference preflight returned malformed or out-of-scope evidence.");
  assertIssuedH3DraftPolicyMatchesJob(policy, job, rawReferences.map(reference => reference.rawSha256));
  const { client, bucket } = storage();
  const encoded = JSON.stringify(policy);
  if (Buffer.byteLength(encoded, "utf8") > MAX_POLICY_BYTES) throw new Error("Issued identity policy exceeds its storage bound.");
  try {
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key(job.ownerId, job.projectId, policy.id), Body: encoded,
      ContentType: "application/json", IfNoneMatch: "*" }), { abortSignal: AbortSignal.timeout(15_000) });
    return policy;
  } catch (error) {
    if (status(error) !== 409 && status(error) !== 412) throw error;
    const existing = await readIssuedH3DraftPolicy(job.ownerId, job.projectId, policy);
    if (!existing || canonicalIdentityPolicyJson(existing.body) !== canonicalIdentityPolicyJson(policy.body)) throw new Error("Issued identity policy already exists with different evidence.");
    return existing;
  }
}
