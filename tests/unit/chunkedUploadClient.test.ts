import { describe, expect, test } from "bun:test";

import {
  MAX_CONCURRENT_CHUNK_UPLOADS,
  uploadFileInChunks,
} from "@/components/studio/chunkedUploadClient";
import { LARGE_UPLOAD_SINGLE_SHOT_MAX } from "@/lib/chunkedMediaUpload";

describe("uploadFileInChunks", () => {
  test("bounds chunk requests across a multi-file browser batch", async () => {
    const originalFetch = globalThis.fetch;
    let activeRequests = 0;
    let maxActiveRequests = 0;
    let uploadedParts = 0;

    globalThis.fetch = (async () => {
      activeRequests += 1;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeRequests -= 1;
      const part = uploadedParts++;
      return Response.json({
        bucket: "stack-structure",
        objectKey: `media-uploads/github-test-user/video-source/upload-${part}/${String(part).padStart(5, "0")}.part`,
      });
    }) as typeof fetch;

    const files = Array.from({ length: MAX_CONCURRENT_CHUNK_UPLOADS * 2 }, (_, index) => (
      new File(
        [new Uint8Array(LARGE_UPLOAD_SINGLE_SHOT_MAX + 1)],
        `clip-${index}.mp4`,
        { type: "video/mp4" },
      )
    ));

    try {
      const manifests = await Promise.all(
        files.map((file) => uploadFileInChunks(file, "media-uploads/video-source")),
      );

      expect(manifests.every((manifest) => manifest?.chunks.length === 2)).toBe(true);
      expect(maxActiveRequests).toBe(MAX_CONCURRENT_CHUNK_UPLOADS);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
