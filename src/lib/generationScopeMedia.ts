import { createHash } from "node:crypto";
import { GetObjectCommand, S3Client, type GetObjectCommandInput } from "@aws-sdk/client-s3";
import type { PersistedStudioProjectDraft } from "@/components/studio/projectPersistence";
import { generationScopeSha256, type ScopeSourceMediaVersion } from "@/components/studio/generationScope";
import bootstrap from "../../config/r31-source-media-bootstrap.json";
import { mediaUploadBelongsToOwner } from "./essentiaUpload";
import { getMediaGatewayConfig } from "./mediaGateway";

let cached: { fingerprint: string; client: S3Client } | undefined;
const MAX_MEDIA_OBJECTS = 128;
function storage() {
  const gateway = getMediaGatewayConfig(), endpoint = process.env.RUSTFS_S3_ENDPOINT;
  const accessKeyId = process.env.RUSTFS_ACCESS_KEY, secretAccessKey = process.env.RUSTFS_SECRET_KEY;
  if (!gateway || !endpoint || !accessKeyId || !secretAccessKey || new URL(endpoint).protocol !== "https:") throw new Error("Source media version storage is unavailable.");
  const fingerprint = generationScopeSha256([endpoint, accessKeyId, secretAccessKey, process.env.RUSTFS_REGION ?? ""]);
  if (cached?.fingerprint !== fingerprint) {
    cached?.client.destroy();
    cached = { fingerprint, client: new S3Client({ endpoint, region: process.env.RUSTFS_REGION || "us-east-1", forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey }, requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" }) };
  }
  return { client: cached.client, bucket: gateway.bucket };
}
type Descriptor = Pick<ScopeSourceMediaVersion, "id" | "bucket" | "objectKey">;
export function generationScopeMediaDescriptors(ownerId: string, draft: PersistedStudioProjectDraft): Descriptor[] {
  const bucket = getMediaGatewayConfig()?.bucket, output: Descriptor[] = [];
  if (draft.analysis) output.push({ id: "master", bucket: draft.analysis.storageBucket ?? "", objectKey: draft.analysis.storagePath ?? "" });
  for (const video of draft.videoSources) {
    if (video.uploadChunks?.chunks.length) video.uploadChunks.chunks.forEach((chunk, index) => output.push({ id: `video:${video.id}:chunk:${index}`, ...chunk }));
    else output.push({ id: `video:${video.id}`, bucket: video.storageBucket ?? "", objectKey: video.storagePath ?? "" });
  }
  if (output.length > MAX_MEDIA_OBJECTS || new Set(output.map(value => value.id)).size !== output.length
    || output.some(value => value.bucket !== bucket || !value.objectKey || !mediaUploadBelongsToOwner(value.objectKey, ownerId)
      || /[\\\x00-\x1f]/.test(value.objectKey) || value.objectKey.split("/").some(part => !part || part === "." || part === ".."))) throw new Error("The source media inventory requires bounded durable owned objects.");
  return output.sort((a, b) => a.id.localeCompare(b.id));
}

async function get(input: GetObjectCommandInput) {
  const { client } = storage();
  for (let attempt = 0; ; attempt++) {
    try { return await client.send(new GetObjectCommand(input), { abortSignal: AbortSignal.timeout(120_000) }); }
    catch (error) {
      if (attempt !== 0 || !(error instanceof Error) || error.name !== "SignatureDoesNotMatch"
        || (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 403) throw error;
      // Exactly the same command, including Range and IfMatch, is retried once. No unconditional fallback.
    }
  }
}
async function metadata(descriptor: Descriptor, expected?: ScopeSourceMediaVersion): Promise<ScopeSourceMediaVersion> {
  const result = await get({ Bucket: descriptor.bucket, Key: descriptor.objectKey, Range: "bytes=0-0", ...(expected ? { IfMatch: expected.etag } : {}) });
  const range = result.ContentRange?.match(/^bytes 0-0\/(\d+)$/), length = range ? Number(range[1]) : 0;
  if (!result.Body || result.$metadata.httpStatusCode !== 206 || result.ContentLength !== 1 || !result.ETag || !Number.isSafeInteger(length) || length < 1
    || (expected && (result.ETag !== expected.etag || length !== expected.byteLength))) {
    (result.Body as { destroy?: () => void } | undefined)?.destroy?.();
    throw new Error("The conditional source media version response differs.");
  }
  const byte = await result.Body.transformToByteArray();
  if (byte.length !== 1) throw new Error("The source media metadata response was incomplete.");
  return { ...descriptor, etag: result.ETag, byteLength: length, ...(expected?.sha256 ? { sha256: expected.sha256 } : {}) };
}
async function boundedMap<T, R>(values: T[], operation: (value: T) => Promise<R>): Promise<R[]> {
  const result: R[] = [];
  for (let offset = 0; offset < values.length; offset += 3) result.push(...await Promise.all(values.slice(offset, offset + 3).map(operation)));
  return result;
}
export async function pinGenerationScopeMedia(ownerId: string, draft: PersistedStudioProjectDraft): Promise<ScopeSourceMediaVersion[]> {
  return boundedMap(generationScopeMediaDescriptors(ownerId, draft), value => metadata(value));
}
export async function verifyGenerationScopeMedia(ownerId: string, draft: PersistedStudioProjectDraft, expected: ScopeSourceMediaVersion[]): Promise<ScopeSourceMediaVersion[]> {
  const descriptors = generationScopeMediaDescriptors(ownerId, draft);
  if (expected.length !== descriptors.length || new Set(expected.map(value => value.id)).size !== expected.length) throw new Error("The canonical source media version inventory differs.");
  return boundedMap(descriptors, descriptor => {
    const prior = expected.find(value => value.id === descriptor.id);
    if (!prior?.etag || prior.bucket !== descriptor.bucket || prior.objectKey !== descriptor.objectKey) throw new Error("The canonical source media binding differs.");
    return metadata(descriptor, prior);
  });
}

/** Exact private-history SHA certificate anchors the only supported legacy bootstrap. ETags are accepted only after a full conditional byte match. */
export async function bootstrapR31SourceMedia(ownerId: string, projectId: string, draft: PersistedStudioProjectDraft): Promise<ScopeSourceMediaVersion[]> {
  const descriptors = generationScopeMediaDescriptors(ownerId, draft);
  if (ownerId !== bootstrap.ownerId || projectId !== bootstrap.projectId || descriptors.length !== bootstrap.objects.length) throw new Error("The trusted legacy source-media certificate does not match this project.");
  const bindings = descriptors.map(descriptor => {
    const proof = bootstrap.objects.find(value => value.id === descriptor.id && value.keySha256 === generationScopeSha256([descriptor.bucket, descriptor.objectKey]));
    if (!proof) throw new Error("A source media path differs from its trusted historical certificate.");
    return { descriptor, proof };
  });
  return boundedMap(bindings, async ({ descriptor, proof }) => {
    const pinned = await metadata(descriptor);
    if (pinned.byteLength !== proof.byteLength) throw new Error("A source media size differs from its trusted historical bytes.");
    const result = await get({ Bucket: descriptor.bucket, Key: descriptor.objectKey, IfMatch: pinned.etag });
    if (!result.Body || result.ETag !== pinned.etag || result.ContentLength !== proof.byteLength) {
      (result.Body as { destroy?: () => void } | undefined)?.destroy?.();
      throw new Error("The trusted source media conditional read differs.");
    }
    const hash = createHash("sha256"); let bytes = 0;
    for await (const chunk of result.Body as AsyncIterable<Uint8Array>) {
      bytes += chunk.byteLength;
      if (bytes > proof.byteLength) { (result.Body as { destroy?: () => void }).destroy?.(); throw new Error("The source media exceeded its trusted size."); }
      hash.update(chunk);
    }
    if (bytes !== proof.byteLength || hash.digest("hex") !== proof.sha256) throw new Error("The source media differs from its trusted historical full-file hash.");
    return { ...pinned, sha256: proof.sha256 };
  });
}
