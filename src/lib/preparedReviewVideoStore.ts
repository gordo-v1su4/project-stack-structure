import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { REVIEW_VIDEO_RECIPE, type ReviewVideoMetadata } from "@/components/studio/reviewVideo";
import { studioMediaStorage } from "./studioProjectObjectStore";
import { normalizeStudioOwnerSegment } from "./studioStoragePaths";
import { isSafeStudioObjectKey } from "./studioMetadataPrivacy";

export type ReviewVideoSource = { ownerId: string; bucket: string; objectKey: string; etag: string; bytes: number };
export type PreparedReviewVideo = { version: 1; identity: string; recipe: typeof REVIEW_VIDEO_RECIPE;
  source: ReviewVideoSource; metadata: ReviewVideoMetadata; artifacts: { proxy: string; poster: string; sprite: string } };
type Storage = typeof studioMediaStorage;
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const status = (error: unknown) => (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
const extensions = { proxy: "mp4", poster: "webp", sprite: "jpg" } as const;
export const REVIEW_VIDEO_MAX_SOURCE_BYTES = 512 * 1024 * 1024;

export function assertReviewVideoSource(source: ReviewVideoSource) {
  if (typeof source.ownerId !== "string" || !/^[\w@.:-]{1,160}$/.test(source.ownerId)
    || typeof source.bucket !== "string" || !source.bucket || source.bucket.length > 128
    || typeof source.objectKey !== "string" || source.objectKey.length > 2048 || !source.objectKey.startsWith("media-uploads/")
    || !isSafeStudioObjectKey(source.objectKey) || !/\.(mp4|mov|m4v|mkv|webm|avi|mpeg|mpg|ts)$/i.test(source.objectKey)
    || typeof source.etag !== "string" || !/^"[^"\r\n]{1,200}"$/.test(source.etag)
    || !Number.isSafeInteger(source.bytes) || source.bytes < 1 || source.bytes > REVIEW_VIDEO_MAX_SOURCE_BYTES) {
    throw new Error("Invalid review-video source binding.");
  }
}
export function reviewVideoIdentity(source: ReviewVideoSource) {
  assertReviewVideoSource(source);
  return hash(JSON.stringify([source.ownerId, source.bucket, source.objectKey, source.etag, source.bytes, REVIEW_VIDEO_RECIPE]));
}
export function reviewVideoFolder(source: ReviewVideoSource) {
  return `media-uploads/projects/${normalizeStudioOwnerSegment(source.ownerId)}/review-video/${reviewVideoIdentity(source)}`;
}
function connection(source: ReviewVideoSource, storage: Storage) {
  assertReviewVideoSource(source);
  const value = storage();
  if (value.bucket !== source.bucket) throw new Error("Review-video bucket differs from configured storage.");
  return value;
}

/** Call only after authorization. HEAD pins a particular source version, never a caller's URL. */
export async function pinReviewVideoSource(ownerId: string, bucket: string, objectKey: string, storage: Storage = studioMediaStorage): Promise<ReviewVideoSource> {
  const provisional = { ownerId, bucket, objectKey, etag: '"unresolved"', bytes: 1 };
  const { client } = connection(provisional, storage);
  const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }), { abortSignal: AbortSignal.timeout(10_000) });
  const source = { ownerId, bucket, objectKey, etag: head.ETag ?? "", bytes: head.ContentLength ?? 0 };
  assertReviewVideoSource(source);
  if (head.ContentType && !/^(video\/|application\/octet-stream)/i.test(head.ContentType)) throw new Error("Review source is not stored video.");
  return source;
}

function validMetadata(metadata: ReviewVideoMetadata) {
  if (!metadata || metadata.version !== 1 || metadata.recipe !== REVIEW_VIDEO_RECIPE || !metadata.source || !metadata.proxy || !metadata.poster || !metadata.sprite) return false;
  const source = metadata.source;
  if (!/^[a-f0-9]{64}$/.test(source.sha256) || !Number.isSafeInteger(source.bytes) || source.bytes < 1 || source.bytes > REVIEW_VIDEO_MAX_SOURCE_BYTES
    || !Number.isFinite(source.duration) || source.duration <= 0 || source.duration > 600 || !Number.isFinite(source.startTime)
    || !Number.isSafeInteger(source.width) || !Number.isSafeInteger(source.height) || source.width < 2 || source.height < 2
    || source.width > 8192 || source.height > 8192 || source.width * source.height > 40_000_000
    || !Number.isFinite(source.frameRate) || source.frameRate <= 0 || source.frameRate > 120 || ![0, 90, 180, 270].includes(source.rotation)
    || !Number.isSafeInteger(source.frameCount) || source.frameCount < 1 || source.frameCount > 72_000) return false;
  for (const [kind, artifact] of Object.entries({ proxy: metadata.proxy, poster: metadata.poster, sprite: metadata.sprite })) {
    const expected = { proxy: [640, 360, "video/mp4", 64 * 1024 * 1024], poster: [320, 180, "image/webp", 2 * 1024 * 1024], sprite: [1280, 360, "image/jpeg", 4 * 1024 * 1024] }[kind]!;
    if (!/^[a-f0-9]{64}$/.test(artifact.sha256) || artifact.width !== expected[0] || artifact.height !== expected[1] || artifact.mime !== expected[2]
      || !Number.isSafeInteger(artifact.bytes) || artifact.bytes < 1 || artifact.bytes > Number(expected[3])) return false;
  }
  return metadata.proxy.frameCount === source.frameCount && Number.isFinite(metadata.proxy.duration) && metadata.proxy.duration > 0
    && Math.abs(metadata.proxy.duration - source.duration) <= 2 / source.frameRate
    && Number.isFinite(metadata.proxy.sourceTimeOffset) && metadata.sprite.columns === 8 && metadata.sprite.rows === 4 && metadata.sprite.count === 32
    && Array.isArray(metadata.sprite.times) && metadata.sprite.times.length === 32 && metadata.sprite.times.every((time, index, times) =>
      Number.isFinite(time) && time >= source.startTime && time < source.startTime + source.duration + 0.1 && (!index || time > times[index - 1]));
}
function artifactKeys(source: ReviewVideoSource, metadata: ReviewVideoMetadata) {
  const folder = reviewVideoFolder(source);
  return { proxy: `${folder}/${metadata.proxy.sha256}.${extensions.proxy}`, poster: `${folder}/${metadata.poster.sha256}.${extensions.poster}`, sprite: `${folder}/${metadata.sprite.sha256}.${extensions.sprite}` };
}
export async function readPreparedReviewVideo(source: ReviewVideoSource, storage: Storage = studioMediaStorage): Promise<PreparedReviewVideo | null> {
  const { client, bucket } = connection(source, storage);
  try {
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: `${reviewVideoFolder(source)}/ready.json` }), { abortSignal: AbortSignal.timeout(10_000) });
    if (!response.Body) throw new Error("Review-video manifest has no body.");
    const stream = response.Body.transformToWebStream();
    if ((response.ContentLength ?? 0) > 32 * 1024) { await stream.cancel(); throw new Error("Review-video manifest exceeds its bound."); }
    const reader = stream.getReader(), chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength;
        if (size > 32 * 1024) { await reader.cancel(); throw new Error("Review-video manifest exceeds its bound."); } chunks.push(part.value); }
    } finally { reader.releaseLock(); }
    const record = JSON.parse(Buffer.concat(chunks).toString("utf8")) as PreparedReviewVideo;
    if (record.version !== 1 || record.recipe !== REVIEW_VIDEO_RECIPE || record.identity !== reviewVideoIdentity(source)
      || !record.source || (Object.keys(source) as Array<keyof ReviewVideoSource>).some(key => record.source[key] !== source[key])
      || !validMetadata(record.metadata) || record.metadata.source.bytes !== source.bytes || !record.artifacts) throw new Error("Invalid review-video manifest binding.");
    const expected = artifactKeys(source, record.metadata);
    if ((["proxy", "poster", "sprite"] as const).some(kind => record.artifacts[kind] !== expected[kind])) throw new Error("Invalid review-video manifest binding.");
    return record;
  } catch (error) { if (status(error) === 404) return null; throw error; }
}

/** Publish ready last. Content-addressed artifacts cannot be replaced by a racing encoder. */
export async function storePreparedReviewVideo(source: ReviewVideoSource, prepared: { metadata: ReviewVideoMetadata; bytes: { proxy: Uint8Array; poster: Uint8Array; sprite: Uint8Array } }, storage: Storage = studioMediaStorage): Promise<PreparedReviewVideo> {
  const { client, bucket } = connection(source, storage), { metadata, bytes } = prepared;
  if (!validMetadata(metadata) || metadata.source.bytes !== source.bytes) throw new Error("Invalid prepared review video.");
  const artifacts = artifactKeys(source, metadata);
  for (const kind of ["proxy", "poster", "sprite"] as const) {
    if (metadata[kind].bytes !== bytes[kind].byteLength || metadata[kind].sha256 !== hash(bytes[kind])) throw new Error("Review artifact bytes differ from their manifest.");
  }
  for (const kind of ["proxy", "poster", "sprite"] as const) {
    const result = await client.send(new PutObjectCommand({ Bucket: bucket, Key: artifacts[kind], Body: bytes[kind], ContentType: metadata[kind].mime,
      Metadata: { recipe: REVIEW_VIDEO_RECIPE, source: metadata.source.sha256, sha256: metadata[kind].sha256 }, IfNoneMatch: "*" }), { abortSignal: AbortSignal.timeout(60_000) })
      .catch(async error => {
        if (status(error) !== 412) throw error;
        const existing = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: artifacts[kind] }), { abortSignal: AbortSignal.timeout(10_000) });
        if (existing.ContentLength !== metadata[kind].bytes || existing.ContentType !== metadata[kind].mime
          || existing.Metadata?.sha256 !== metadata[kind].sha256 || existing.Metadata?.recipe !== REVIEW_VIDEO_RECIPE) throw new Error("Existing review artifact differs from its content binding.");
        return { ETag: existing.ETag };
      });
    if (!result.ETag) throw new Error("Review artifact storage acknowledgment is missing.");
  }
  const record: PreparedReviewVideo = { version: 1, identity: reviewVideoIdentity(source), recipe: REVIEW_VIDEO_RECIPE, source, metadata, artifacts };
  const result = await client.send(new PutObjectCommand({ Bucket: bucket, Key: `${reviewVideoFolder(source)}/ready.json`, Body: JSON.stringify(record), ContentType: "application/json", IfNoneMatch: "*" }), { abortSignal: AbortSignal.timeout(10_000) })
    .catch(async error => { if (status(error) !== 412) throw error; const existing = await readPreparedReviewVideo(source, storage); if (!existing) throw error; return { ETag: "existing-manifest", existing }; });
  if (!result.ETag) throw new Error("Review manifest storage acknowledgment is missing.");
  if ("existing" in result && result.existing) return result.existing;
  return record;
}
