import { describe, expect, test } from "bun:test";

import {
  buildUploadChunkRanges,
  LARGE_UPLOAD_CHUNK_BYTES,
  resolveChunkedMediaContentType,
  validateOrderedChunkManifest,
} from "@/lib/chunkedMediaUpload";

const BUCKET = "stack-structure-media";
const PREFIX = "media-uploads/video-source";

function makeManifest(size: number, opts: { uuid?: string; prefix?: string; bucket?: string } = {}) {
  const uuid = opts.uuid ?? "9a1b2c3d-4e5f-4a6b-8c7d-1e2f3a4b5c6d";
  const count = Math.ceil(size / LARGE_UPLOAD_CHUNK_BYTES);
  return {
    size,
    chunks: Array.from({ length: count }, (_, index) => ({
      bucket: opts.bucket ?? BUCKET,
      objectKey: `${opts.prefix ?? PREFIX}/${uuid}/${String(index).padStart(5, "0")}.part`,
    })),
  };
}

describe("validateOrderedChunkManifest", () => {
  test("accepts a contiguous manifest matching the declared size", () => {
    const manifest = makeManifest(LARGE_UPLOAD_CHUNK_BYTES * 3);
    const validated = validateOrderedChunkManifest({
      value: manifest.chunks,
      size: manifest.size,
      bucket: BUCKET,
      expectedPrefix: PREFIX,
    });
    expect(validated).not.toBeNull();
    expect(validated?.length).toBe(3);
    expect(validated?.[0]?.objectKey.endsWith("00000.part")).toBe(true);
  });

  test("rejects wrong chunk count for the declared size", () => {
    const manifest = makeManifest(LARGE_UPLOAD_CHUNK_BYTES * 2);
    const validated = validateOrderedChunkManifest({
      value: manifest.chunks.slice(0, 1),
      size: manifest.size,
      bucket: BUCKET,
      expectedPrefix: PREFIX,
    });
    expect(validated).toBeNull();
  });

  test("accepts gateway timestamp-prefixed part names", () => {
    const uuid = "9a1b2c3d-4e5f-4a6b-8c7d-1e2f3a4b5c6d";
    const chunks = [
      { bucket: BUCKET, objectKey: `${PREFIX}/${uuid}/1787524663125-00000.part` },
      { bucket: BUCKET, objectKey: `${PREFIX}/${uuid}/1787524663789-00001.part` },
    ];
    const validated = validateOrderedChunkManifest({
      value: chunks,
      size: LARGE_UPLOAD_CHUNK_BYTES * 2,
      bucket: BUCKET,
      expectedPrefix: PREFIX,
    });
    expect(validated).not.toBeNull();
    expect(validated?.length).toBe(2);
  });

  test("rejects out-of-order part indexes", () => {
    const manifest = makeManifest(LARGE_UPLOAD_CHUNK_BYTES * 2);
    const swapped = [manifest.chunks[1], manifest.chunks[0]];
    const validated = validateOrderedChunkManifest({
      value: swapped,
      size: manifest.size,
      bucket: BUCKET,
      expectedPrefix: PREFIX,
    });
    expect(validated).toBeNull();
  });

  test("rejects foreign buckets and unexpected prefixes", () => {
    const foreignBucket = makeManifest(LARGE_UPLOAD_CHUNK_BYTES, { bucket: "other-bucket" });
    expect(validateOrderedChunkManifest({
      value: foreignBucket.chunks,
      size: foreignBucket.size,
      bucket: BUCKET,
      expectedPrefix: PREFIX,
    })).toBeNull();

    const foreignPrefix = makeManifest(LARGE_UPLOAD_CHUNK_BYTES, { prefix: "media-uploads/elsewhere" });
    expect(validateOrderedChunkManifest({
      value: foreignPrefix.chunks,
      size: foreignPrefix.size,
      bucket: BUCKET,
      expectedPrefix: PREFIX,
    })).toBeNull();
  });

  test("rejects non-array and non-positive sizes", () => {
    expect(validateOrderedChunkManifest({ value: "nope", size: 100, bucket: BUCKET, expectedPrefix: PREFIX })).toBeNull();
    const manifest = makeManifest(LARGE_UPLOAD_CHUNK_BYTES);
    expect(validateOrderedChunkManifest({ value: manifest.chunks, size: 0, bucket: BUCKET, expectedPrefix: PREFIX })).toBeNull();
  });
});

describe("buildUploadChunkRanges", () => {
  test("covers the whole file with contiguous ranges", () => {
    const size = LARGE_UPLOAD_CHUNK_BYTES * 2 + 17;
    const ranges = buildUploadChunkRanges(size);
    expect(ranges.length).toBe(3);
    expect(ranges[0]?.start).toBe(0);
    expect(ranges.at(-1)?.end).toBe(size);
    for (const [index, range] of ranges.entries()) expect(range.index).toBe(index);
  });
});

describe("resolveChunkedMediaContentType", () => {
  test("preserves declared audio and video MIME types", () => {
    expect(resolveChunkedMediaContentType("audio/wav", "master.wav")).toBe("audio/wav");
    expect(resolveChunkedMediaContentType("video/mp4", "clip.mp4")).toBe("video/mp4");
  });

  test("infers media MIME types from known extensions when browsers omit them", () => {
    expect(resolveChunkedMediaContentType("", "master.WAV")).toBe("audio/wav");
    expect(resolveChunkedMediaContentType(undefined, "clip.webm")).toBe("video/webm");
  });

  test("rejects non-media payloads instead of coercing them to MP4", () => {
    expect(resolveChunkedMediaContentType("application/json", "payload.json")).toBeNull();
    expect(resolveChunkedMediaContentType("application/octet-stream", "payload.bin")).toBeNull();
  });
});
