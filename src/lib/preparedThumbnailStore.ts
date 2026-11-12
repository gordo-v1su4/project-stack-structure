import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { studioMediaStorage } from "./studioProjectObjectStore";
import { normalizeStudioOwnerSegment } from "./studioStoragePaths";
import type { ThumbnailPersistence } from "./mediaThumbnail";

const RECIPE = "webp-16x9-v1-q75-e3";
const MAX_BYTES = 2 * 1024 * 1024;
type Source = { ownerId: string; bucket: string; objectKey: string; sha256: string; width: 320 | 640 };
type Storage = typeof studioMediaStorage;

export function preparedThumbnailObjectKey(source: Source) {
  const identity = createHash("sha256").update(JSON.stringify([
    source.ownerId, source.bucket, source.objectKey, source.sha256.toLowerCase(), source.width, RECIPE,
  ])).digest("hex");
  return `media-uploads/projects/${normalizeStudioOwnerSegment(source.ownerId)}/review-thumbnails/${identity}/${source.width}.webp`;
}

/** Call only for an already-authorized source. A claimed version must be its actual SHA-256. */
export function preparedThumbnailPersistence(source: Source, storage: Storage = studioMediaStorage): ThumbnailPersistence | undefined {
  if (!/^[a-f0-9]{64}$/i.test(source.sha256)) return undefined;
  const sha256 = source.sha256.toLowerCase();
  const key = preparedThumbnailObjectKey(source);
  const connection = () => {
    const value = storage();
    if (value.bucket !== source.bucket) throw new Error("Thumbnail bucket differs from configured storage.");
    return value;
  };
  return {
    sourceSha256: sha256,
    async read() {
      const { client, bucket } = connection();
      try {
        const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: AbortSignal.timeout(5000) });
        const body = result.Body;
        if (!body) return null;
        const stream = body.transformToWebStream();
        if (result.ContentType !== "image/webp" || (result.ContentLength ?? 0) > MAX_BYTES
          || result.Metadata?.recipe !== RECIPE || result.Metadata?.source !== sha256
          || result.Metadata?.width !== String(source.width)) { await stream.cancel(); return null; }
        const chunks: Uint8Array[] = [];
        let length = 0;
        const reader = stream.getReader();
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            length += value.byteLength;
            if (length > MAX_BYTES) { await reader.cancel(); return null; }
            chunks.push(value);
          }
        } finally { reader.releaseLock(); }
        const bytes = Buffer.concat(chunks, length);
        if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP"
          || createHash("sha256").update(bytes).digest("hex") !== result.Metadata?.sha256) return null;
        return bytes;
      } catch (error) {
        if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return null;
        throw error;
      }
    },
    async write(bytes) {
      if (bytes.byteLength > MAX_BYTES) throw new Error("Prepared thumbnail exceeds its storage bound.");
      const { client, bucket } = connection();
      const result = await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: "image/webp",
        Metadata: { recipe: RECIPE, source: sha256, width: String(source.width), sha256: createHash("sha256").update(bytes).digest("hex") },
      }), { abortSignal: AbortSignal.timeout(5000) });
      if (!result.ETag) throw new Error("Prepared thumbnail storage acknowledgment is missing.");
    },
  };
}
