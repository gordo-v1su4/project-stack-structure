import { createHash } from "node:crypto";
import sharp from "sharp";

const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_CACHE_BYTES = 32 * 1024 * 1024;
const MAX_PENDING = 64;
type Thumbnail = { bytes: Uint8Array; etag: string; expires: number; durable: boolean };
export type ThumbnailPersistence = { sourceSha256: string; read(): Promise<Uint8Array | null>; write(bytes: Uint8Array): Promise<void> };
const cache = new Map<string, Thumbnail>();
const pending = new Map<string, Promise<Thumbnail>>();
let cacheBytes = 0;
let active = 0;
const waiters: Array<() => void> = [];

export class ThumbnailError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function readImage(response: Response) {
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new ThumbnailError("Thumbnail source is unavailable.", response.status >= 400 ? response.status : 502);
  }
  if (!/^image\/(png|jpeg|webp|avif)(?:;|$)/i.test(response.headers.get("content-type") ?? "")) {
    await response.body.cancel();
    throw new ThumbnailError("This media cannot be used as an image thumbnail.", 415);
  }
  if (Number(response.headers.get("content-length")) > MAX_SOURCE_BYTES) {
    await response.body.cancel();
    throw new ThumbnailError("Thumbnail source exceeds the image limit.", 413);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_SOURCE_BYTES) {
        await reader.cancel();
        throw new ThumbnailError("Thumbnail source exceeds the image limit.", 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, size);
}

/** Call only after authorizing the source on every request, including cache hits. */
export async function getMediaThumbnail(key: string, width: 320 | 640, load: () => Promise<Response>, persistence?: ThumbnailPersistence): Promise<Thumbnail> {
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    if (cached.expires > Date.now()) { cache.set(key, cached); return cached; }
    cacheBytes -= cached.bytes.byteLength;
  }
  const existing = pending.get(key);
  if (existing) return existing;
  if (pending.size >= MAX_PENDING) throw new ThumbnailError("Thumbnail preparation is busy. Try again shortly.", 503);
  const work = (async () => {
    if (active >= 2) await new Promise<void>(resolve => waiters.push(resolve));
    else active++;
    try {
      let bytes: Uint8Array | null = null;
      let durable = false;
      let canPersist = Boolean(persistence);
      try { bytes = await persistence?.read() ?? null; durable = bytes !== null; } catch { canPersist = false; }
      if (bytes === null) {
        const source = await readImage(await load());
        if (persistence && createHash("sha256").update(source).digest("hex") !== persistence.sourceSha256) {
          throw new ThumbnailError("The image changed. Refresh its current preview version.", 409);
        }
        bytes = await sharp(source, { limitInputPixels: 40_000_000, animated: false })
          .timeout({ seconds: 5 })
          .rotate().resize({ width, height: width * 9 / 16, fit: "inside", withoutEnlargement: true })
          .webp({ quality: 75, effort: 3 }).toBuffer();
        try { if (persistence && canPersist) { await persistence.write(bytes); durable = true; } } catch { /* The prepared image remains usable without claiming persistence. */ }
      }
      const result = { bytes, durable, etag: `"thumb-${createHash("sha256").update(bytes).digest("hex")}"`, expires: Date.now() + 10 * 60_000 };
      cache.set(key, result); cacheBytes += bytes.byteLength;
      while (cacheBytes > MAX_CACHE_BYTES || cache.size > 256) {
        const oldest = cache.keys().next().value!;
        cacheBytes -= cache.get(oldest)!.bytes.byteLength; cache.delete(oldest);
      }
      return result;
    } finally {
      const next = waiters.shift();
      if (next) next(); else active--;
    }
  })();
  pending.set(key, work);
  try { return await work; } finally { pending.delete(key); }
}
