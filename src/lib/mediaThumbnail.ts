import { createHash } from "node:crypto";
import sharp from "sharp";

const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_CACHE_BYTES = 32 * 1024 * 1024;
const MAX_PENDING = 64;
type Thumbnail = { bytes: Uint8Array; etag: string; expires: number };
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
export async function getMediaThumbnail(key: string, width: 320 | 640, load: () => Promise<Response>): Promise<Thumbnail> {
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
      const source = await readImage(await load());
      const bytes = await sharp(source, { limitInputPixels: 40_000_000, animated: false })
        .timeout({ seconds: 5 })
        .rotate().resize({ width, height: width * 9 / 16, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 75, effort: 3 }).toBuffer();
      const result = { bytes, etag: `"thumb-${createHash("sha256").update(bytes).digest("hex")}"`, expires: Date.now() + 10 * 60_000 };
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
