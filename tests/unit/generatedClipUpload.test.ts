import { describe, expect, test } from "bun:test";
import { uploadGeneratedClipToRustFs } from "@/components/studio/generatedClipUpload";
import { uploadReferenceAssetToRustFs } from "@/components/studio/referenceAssets";
import { uploadFileDirectlyToRustFs } from "@/components/studio/directUploadClient";

const originalFetch = globalThis.fetch;

describe("direct browser media uploads", () => {
  test("sends only metadata to the app and exact ordered file bytes to storage", async () => {
    const actions: string[] = [];
    const sentBytes: number[] = [];
    globalThis.fetch = (async (input, init) => {
      if (String(input) === "/api/storage/direct") {
        expect(typeof init?.body).toBe("string");
        const payload = JSON.parse(String(init?.body));
        actions.push(payload.action);
        if (payload.action === "start") {
          expect(payload.fileName).toBe("clip.mp4");
          expect(payload.size).toBe(7);
          return Response.json({ token: "signed-receipt", partSize: 4, parts: [{ number: 1, url: "https://storage.test/part1" }, { number: 2, url: "https://storage.test/part2" }] });
        }
        expect(payload.token).toBe("signed-receipt");
        return Response.json({ bucket: "stack-structure", objectKey: "media-uploads/user/clip.mp4", publicUrl: "https://media.test/clip.mp4", mime: "video/mp4", uploadToken: payload.token });
      }
      expect(String(input).startsWith("https://storage.test/part")).toBe(true);
      expect(init?.method).toBe("PUT");
      expect(init?.credentials).toBe("omit");
      sentBytes.push(...new Uint8Array(await (init?.body as Blob).arrayBuffer()));
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    try {
      const progress: string[] = [];
      const result = await uploadGeneratedClipToRustFs({ file: new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7])], "clip.mp4", { type: "video/mp4" }), folder: "media-uploads/generated", onPartUploaded: (done, total) => progress.push(`${done}/${total}`) });
      expect(actions).toEqual(["start", "complete"]);
      expect(sentBytes).toEqual([1, 2, 3, 4, 5, 6, 7]);
      expect(progress).toEqual(["1/2", "2/2"]);
      expect(result.publicUrl).toBe("https://media.test/clip.mp4");
    } finally { globalThis.fetch = originalFetch; }
  });

  test("uploads reference sheets larger than the Vercel cap directly", async () => {
    let bytes = 0;
    globalThis.fetch = (async (input, init) => {
      if (String(input).startsWith("https://storage.test")) {
        bytes += (init?.body as Blob).size;
        return new Response(null, { status: 200 });
      }
      const payload = JSON.parse(String(init?.body));
      if (payload.action === "start") return Response.json({ token: "receipt", partSize: 32 * 1024 ** 2, parts: [{ number: 1, url: "https://storage.test/sheet" }] });
      return Response.json({ bucket: "stack-structure", objectKey: "media-uploads/user/sheet.png", publicUrl: "https://media.test/sheet.png", mime: "image/png", uploadToken: "receipt" });
    }) as typeof fetch;
    try {
      const file = new File([new Uint8Array(5 * 1024 ** 2)], "sheet.png", { type: "image/png" });
      const result = await uploadReferenceAssetToRustFs(file, "character-1");
      expect(bytes).toBe(file.size);
      expect(result.storageStatus).toBe("uploaded");
      expect(result.storageBucket).toBe("stack-structure");
    } finally { globalThis.fetch = originalFetch; }
  });

  test("aborts failed uploads instead of marking an incomplete file ready", async () => {
    const actions: string[] = [];
    let puts = 0;
    globalThis.fetch = (async (input, init) => {
      if (String(input).startsWith("https://storage.test")) { puts++; return new Response(null, { status: 503 }); }
      const payload = JSON.parse(String(init?.body));
      actions.push(payload.action);
      if (payload.action === "start") return Response.json({ token: "receipt", partSize: 32, parts: [{ number: 1, url: "https://storage.test/fail" }] });
      return Response.json({ aborted: true });
    }) as typeof fetch;
    try {
      await expect(uploadFileDirectlyToRustFs(new File(["bytes"], "clip.mp4"), "media-uploads/video-source")).rejects.toThrow("503");
      expect(actions).toEqual(["start", "abort"]);
      expect(puts).toBe(3);
    } finally { globalThis.fetch = originalFetch; }
  });
});
