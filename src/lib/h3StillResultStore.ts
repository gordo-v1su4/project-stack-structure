import { studioS3OriginOptions } from "./studioS3Origin";
import { createHash } from "node:crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { H3GenerationJob } from "@/components/studio/h3Generation";
import { normalizeH3FirstFrameArtifact } from "@/components/studio/h3FirstFrame";
import { getMediaGatewayConfig } from "./mediaGateway";
import { registerH3FirstFrame } from "./h3FirstFrameStore";
import { assertH3StillJob, type H3StillJob, type H3StillResult } from "./h3StillJobStore";
import { h3StillDigest, h3StillNativePreparation } from "./h3StillProfile";
import type { prepareH3StillImage } from "./h3StillImagePreparation";
import { StudioProjectConflictError } from "./studioProjectObjectStore";

export type H3StillByteStore = {
  bucket: string; read(key: string, maxBytes: number): Promise<Uint8Array | null>;
  /** Production implementation is always If-None-Match: *; never an overwrite. */
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
};
type Prepared = Awaited<ReturnType<typeof prepareH3StillImage>>;
type Dependencies = { bytes?: H3StillByteStore; register?: typeof registerH3FirstFrame };
const MAX_IMAGE = 32 * 1024 * 1024, MAX_RECEIPT = 64 * 1024;
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const equal = (a: unknown, b: unknown) => h3StillDigest(a) === h3StillDigest(b);

function storage() {
  const config = getMediaGatewayConfig(), endpoint = process.env.RUSTFS_S3_ENDPOINT,
    accessKeyId = process.env.RUSTFS_ACCESS_KEY, secretAccessKey = process.env.RUSTFS_SECRET_KEY;
  if (!config || !endpoint || new URL(endpoint).protocol !== "https:" || !accessKeyId || !secretAccessKey) throw new Error("Durable still storage is not configured.");
  const bucket = config.bucket;
  const client = new S3Client({ ...studioS3OriginOptions(endpoint), endpoint, region: process.env.RUSTFS_REGION || "us-east-1", forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey }, maxAttempts: 1, requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" });
  const bytes: H3StillByteStore = {
    bucket,
    async read(key, maxBytes) {
      try {
        const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: AbortSignal.timeout(30_000) });
        const body = result.Body;
        if (!body) throw new Error("Stored still object has no body.");
        try {
          if ((result.ContentLength ?? 0) > maxBytes || !(body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator]) throw new Error("Stored still object exceeds its byte contract.");
          const chunks: Buffer[] = []; let total = 0;
          for await (const chunk of body as AsyncIterable<Uint8Array>) {
            total += chunk.byteLength;
            if (total > maxBytes) throw new Error("Stored still object exceeds its byte contract.");
            chunks.push(Buffer.from(chunk));
          }
          return Buffer.concat(chunks);
        } finally { (body as { destroy?: () => void }).destroy?.(); }
      } catch (error) {
        if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return null;
        throw error;
      }
    },
    async put(key, value, contentType) {
      const result = await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: value, ContentType: contentType, IfNoneMatch: "*" }), { abortSignal: AbortSignal.timeout(30_000) });
      if (!result.ETag) throw new Error("Still object write has no durable acknowledgment.");
    },
  };
  return { bytes, destroy: () => client.destroy() };
}

function validate(job: H3StillJob, template: H3GenerationJob, prepared: Prepared) {
  assertH3StillJob(job);
  const descriptor = job.descriptor.body, shot = job.shotRequest;
  const target = template?.target;
  if (job.state !== "persisting" || !job.promptId || !job.workflowSha256 || !template || template.ownerId !== job.ownerId || template.projectId !== job.projectId
    || template.request.conditioning !== undefined || !equal(template, job.template) || !equal(template.request, shot)
    || !target || target.planSignature !== shot.planSignature
    || !equal({ timelineItemId: target.timelineItemId, sectionId: target.sectionId, ...(target.requirementId === undefined ? {} : { requirementId: target.requirementId }), songStart: target.songStart, songEnd: target.songEnd }, descriptor.target)
    || !equal(template.references.map(ref => ({ assetId: ref.assetId, canonicalName: ref.canonicalName, role: ref.role, bucket: ref.bucket, objectKey: ref.objectKey, version: ref.version, etag: ref.etag })), descriptor.references.map(({ rawSha256: _hash, ...ref }) => { void _hash; return ref; }))
    || (template.referenceHashes !== undefined && !equal(template.referenceHashes, descriptor.references.map(ref => ref.rawSha256)))) throw new Error("Still result template differs from its owned frozen shot and references.");
  const master = prepared?.master, native = prepared?.native, receipt = prepared?.preparation, contract = master && h3StillNativePreparation(master.pngSha256);
  if (!master || !native || !receipt || !(master.bytes instanceof Uint8Array) || !(native.bytes instanceof Uint8Array)
    || !master.bytes.byteLength || master.bytes.byteLength > MAX_IMAGE || !native.bytes.byteLength || native.bytes.byteLength > MAX_IMAGE
    || master.width !== 2048 || master.height !== 1152 || native.width !== 1344 || native.height !== 768
    || master.byteCount !== master.bytes.byteLength || native.byteCount !== native.bytes.byteLength
    || digest(master.bytes) !== master.pngSha256 || digest(native.bytes) !== native.pngSha256
    || !hash(native.decodedPixelSha256) || !hash(native.nativeFrameSha256)
    || !hash(receipt.sha256) || h3StillDigest(receipt.body) !== receipt.sha256
    || receipt.body.version !== 1 || receipt.body.contractSha256 !== contract!.sha256 || !equal(receipt.body.geometry, contract!.body)
    || receipt.body.implementation.version !== "sharp-lanczos3-bgr-v1"
    || receipt.body.nativePngSha256 !== native.pngSha256 || receipt.body.nativeByteCount !== native.byteCount
    || receipt.body.decodedPixelSha256 !== native.decodedPixelSha256 || receipt.body.nativeFrameSha256 !== native.nativeFrameSha256) throw new Error("Still result bytes differ from their deterministic preparation receipt.");
}

/** Only exact readback can reconcile an uncertain PUT. No second PUT is issued. */
async function putOnce(objects: H3StillByteStore, key: string, value: Uint8Array, type: string, maxBytes: number) {
  const expected = digest(value);
  const matches = (existing: Uint8Array) => existing.byteLength === value.byteLength && digest(existing) === expected;
  const existing = await objects.read(key, maxBytes);
  if (existing) { if (!matches(existing)) throw new StudioProjectConflictError("A different immutable still object already occupies this owned key."); return; }
  try { await objects.put(key, value, type); }
  catch (error) {
    const restored = await objects.read(key, maxBytes);
    if (restored && matches(restored)) return;
    if (restored) throw new StudioProjectConflictError("A different immutable still object won this write.");
    throw error;
  }
}

/** Internal worker seam: prepared pixels were decoded by prepareH3StillImage.
 * This receipt records generated-still provenance; it is not video extraction,
 * an identity pass, creative approval, or a timeline selection.
 */
export async function persistH3StillResult(job: H3StillJob, template: H3GenerationJob, prepared: Prepared, dependencies: Dependencies = {}): Promise<H3StillResult> {
  validate(job, template, prepared);
  // Detach bytes and metadata before awaiting storage so caller mutation cannot change the persistence intent.
  const master = Buffer.from(prepared.master.bytes), native = Buffer.from(prepared.native.bytes), snapshot = JSON.parse(JSON.stringify({ job, template, preparation: prepared.preparation })) as { job: H3StillJob; template: H3GenerationJob; preparation: Prepared["preparation"] };
  const defaultStorage = dependencies.bytes ? undefined : storage(), objects = dependencies.bytes ?? defaultStorage!.bytes;
  try {
    if (!objects.bucket || objects.bucket !== job.descriptor.body.references[0].bucket || job.descriptor.body.references.some(ref => ref.bucket !== objects.bucket)) throw new Error("Still storage bucket differs from the pinned canonical references.");
    const prefix = `media-uploads/projects/${snapshot.job.ownerId}/still-results/${snapshot.job.projectId}/${snapshot.job.id}/`;
    const body = { version: 1, purpose: "generated-h3-still" as const, ownerId: snapshot.job.ownerId, projectId: snapshot.job.projectId,
      jobId: snapshot.job.id, descriptorSha256: snapshot.job.descriptor.sha256, shotRequestSha256: h3StillDigest(snapshot.job.shotRequest),
      promptId: snapshot.job.promptId, workflowSha256: snapshot.job.workflowSha256,
      ...(snapshot.job.providerSchemaSha256 ? { providerSchemaSha256: snapshot.job.providerSchemaSha256 } : {}),
      master: { sha256: digest(master), byteLength: master.byteLength, width: 2048, height: 1152 },
      native: { sha256: digest(native), byteLength: native.byteLength, width: 1344, height: 768 }, preparation: snapshot.preparation };
    const receipt = Buffer.from(JSON.stringify({ body, sha256: h3StillDigest(body) }));
    if (receipt.byteLength > MAX_RECEIPT) throw new Error("Still provenance receipt exceeds its bound.");
    await putOnce(objects, `${prefix}master.png`, master, "image/png", MAX_IMAGE);
    await putOnce(objects, `${prefix}native.png`, native, "image/png", MAX_IMAGE);
    await putOnce(objects, `${prefix}preparation.json`, receipt, "application/json", MAX_RECEIPT);
    const artifact = await (dependencies.register ?? registerH3FirstFrame)(snapshot.template, { bucket: objects.bucket, objectKey: `${prefix}native.png` }, body.native.sha256);
    if (!normalizeH3FirstFrameArtifact(artifact) || artifact.body.ownerId !== snapshot.job.ownerId || artifact.body.projectId !== snapshot.job.projectId || artifact.body.planSignature !== snapshot.job.shotRequest.planSignature
      || !equal(artifact.body.target, snapshot.job.descriptor.body.target) || !equal(artifact.body.references, snapshot.template.references)
      || artifact.body.pngSha256 !== body.native.sha256 || artifact.body.byteCount !== native.byteLength
      || !hash(artifact.sha256) || artifact.id !== `h3-frame-${artifact.sha256}` || h3StillDigest(artifact.body) !== artifact.sha256) throw new Error("Registered still artifact differs from the persisted native pixels and target.");
    return { master: { ...body.master, bucket: objects.bucket, objectKey: `${prefix}master.png` },
      native: { ...body.native, bucket: objects.bucket, objectKey: `${prefix}native.png` }, artifactId: artifact.id, artifactSha256: artifact.sha256 };
  } finally { defaultStorage?.destroy(); }
}
