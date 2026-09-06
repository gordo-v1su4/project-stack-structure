import { describe, expect, test } from "bun:test";
import { captionDetectedScenes } from "@/components/studio/sceneCaptioning";
import type { DetectedSceneSegment, UploadedVideoSource } from "@/components/studio/types";

const source: UploadedVideoSource = {
  id: 0, name: "restored.mp4", duration: 3, size: 100,
  thumbnailUrl: "", videoUrl: "https://storage.example/restored.mp4",
};
const scene: DetectedSceneSegment = {
  id: 0, sourceClipId: 0, label: "Scene 1", start: 0, end: 3,
  duration: 3, detector: "pyscenedetect-adaptive", confidence: null,
  caption: "Diego dances in the club.", captionSource: "qwen3-vl-server",
  storyboardUrl: "https://storage.example/storyboard.jpg",
};

describe("caption recovery", () => {
  test("keeps completed worker captions without decoding video or making requests", async () => {
    // No browser DOM exists in this test: creating a video would fail.
    const progress: number[] = [];
    const result = await captionDetectedScenes(source, [scene], { mode: "smart" }, (value) => progress.push(value.completed));
    expect(result).toEqual([scene]);
    expect(progress).toEqual([1]);
  });

  test("uses prepared storyboard images for forced recaptioning and mismatched lanes without a video decoder", async () => {
    const originalFetch = globalThis.fetch;
    const originalBitmap = globalThis.createImageBitmap;
    const originalCanvas = globalThis.OffscreenCanvas;
    const calls: string[] = [];
    let closed = 0;
    try {
      globalThis.createImageBitmap = (async () => ({ width: 32, height: 32, close: () => { closed += 1; } })) as unknown as typeof createImageBitmap;
      globalThis.OffscreenCanvas = class {
        getContext() { return { drawImage() {} }; }
        async convertToBlob() { return new Blob(["frame"], { type: "image/jpeg" }); }
      } as unknown as typeof OffscreenCanvas;
      globalThis.fetch = (async (url, init) => {
        calls.push(`${init?.method ?? "GET"} ${url}`);
        if (url === scene.storyboardUrl) return new Response(new Blob(["storyboard"]));
        if (init?.method === "POST") return Response.json({ text: "Valentina joins Diego.", captionSource: "qwen3-vl-server" });
        return Response.json({ configured: true, reachable: true });
      }) as typeof fetch;

      const forced = await captionDetectedScenes(source, [scene], { mode: "smart" }, undefined, { force: true });
      const upgraded = await captionDetectedScenes(source, [{ ...scene, captionSource: "imported" }], { mode: "smart" });
      expect(forced[0].caption).toBe("Valentina joins Diego.");
      expect(upgraded[0].captionSource).toBe("qwen3-vl-server");
      expect(calls.filter((call) => call === "POST /api/caption/scene")).toHaveLength(2);
      expect(calls.filter((call) => call === `GET ${scene.storyboardUrl}`)).toHaveLength(2);
      expect(closed).toBe(2);
    } finally {
      globalThis.fetch = originalFetch;
      globalThis.createImageBitmap = originalBitmap;
      globalThis.OffscreenCanvas = originalCanvas;
    }
  });
});
