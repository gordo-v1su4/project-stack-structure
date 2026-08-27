import { describe, expect, test } from "bun:test";

import { uploadGeneratedClipToRustFs } from "@/components/studio/generatedClipUpload";
import { LARGE_UPLOAD_SINGLE_SHOT_MAX } from "@/lib/chunkedMediaUpload";

const originalFetch = globalThis.fetch;

describe("uploadGeneratedClipToRustFs", () => {
  test("uploads large generated clips as Vercel-safe parts and assembles one playable RustFS object", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    let partIndex = 0;
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url === "/api/storage/upload") {
        const form = init?.body as FormData;
        const folder = String(form.get("folder"));
        const index = partIndex++;
        return Response.json({
          bucket: "stack-structure",
          objectKey: `${folder}/1787524663-${String(index).padStart(5, "0")}.part`,
        });
      }
      expect(url).toBe("/api/storage/assemble");
      return Response.json({
        bucket: "stack-structure",
        objectKey: "media-uploads/user/generated/cut-90/seedance-2.5.mp4",
        publicUrl: "https://media.example/files/seedance-2.5.mp4",
        mime: "video/mp4",
      });
    }) as typeof fetch;

    try {
      const file = new File(
        [new Uint8Array(LARGE_UPLOAD_SINGLE_SHOT_MAX + 1)],
        "seedance-2.5.mp4",
        { type: "video/mp4" },
      );
      const progress: string[] = [];
      const result = await uploadGeneratedClipToRustFs({
        file,
        folder: "media-uploads/generated/cut-90",
        onPartUploaded: (uploaded, total) => progress.push(`${uploaded}/${total}`),
      });

      expect(calls.map((call) => call.url)).toEqual([
        "/api/storage/upload",
        "/api/storage/upload",
        "/api/storage/assemble",
      ]);
      expect(progress).toEqual(["1/2", "2/2"]);
      const assembly = JSON.parse(String(calls[2]?.init?.body));
      expect(assembly.fileName).toBe("seedance-2.5.mp4");
      expect(assembly.chunks).toHaveLength(2);
      expect(result.publicUrl).toBe("https://media.example/files/seedance-2.5.mp4");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("keeps small generated clips on the single-request path", async () => {
    globalThis.fetch = (async (input) => {
      expect(String(input)).toBe("/api/storage/upload");
      return Response.json({
        bucket: "stack-structure",
        objectKey: "media-uploads/user/generated/small.mp4",
        publicUrl: "https://media.example/files/small.mp4",
        mime: "video/mp4",
      });
    }) as typeof fetch;

    try {
      const result = await uploadGeneratedClipToRustFs({
        file: new File(["small"], "small.mp4", { type: "video/mp4" }),
        folder: "media-uploads/generated/cut-90",
      });

      expect(result.objectKey).toContain("small.mp4");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
