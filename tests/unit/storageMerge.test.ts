import { describe, expect, test } from "bun:test";

import { mergeUploadedVideoSourceUpdate } from "@/components/studio/mediaUpload";
import type { UploadedVideoSource } from "@/components/studio/types";

const base: UploadedVideoSource = {
  id: 0,
  name: "clip.mp4",
  duration: 10,
  size: 100,
  thumbnailUrl: "thumb",
  videoUrl: "blob:clip",
  storageProvider: "rustfs",
  storageBucket: "stack-structure",
  storagePath: "media-uploads/2026/clip.mp4",
  storageUrl: "https://s3.v1su4.dev/stack-structure/media-uploads/2026/clip.mp4",
  storageStatus: "uploaded",
  storageError: null,
};

describe("storage metadata merge", () => {
  test("scene updates do not downgrade successful RustFS upload metadata", () => {
    const merged = mergeUploadedVideoSourceUpdate(base, {
      ...base,
      storageProvider: "local",
      storageStatus: "uploading",
      storageBucket: undefined,
      storagePath: undefined,
      storageUrl: undefined,
      scenes: [{
        id: 0,
        sourceClipId: 0,
        label: "Scene 01",
        start: 0,
        end: 5,
        duration: 5,
        detector: "pyscenedetect-adaptive",
      }],
      sceneStatus: "ready",
    });

    expect(merged.storageProvider).toBe("rustfs");
    expect(merged.storageStatus).toBe("uploaded");
    expect(merged.storageUrl).toBe(base.storageUrl);
    expect(merged.sceneStatus).toBe("ready");
    expect(merged.scenes).toHaveLength(1);
  });

  test("failed scene updates clear stale scenes and keep the real media job error", () => {
    const merged = mergeUploadedVideoSourceUpdate({
      ...base,
      scenes: [{
        id: 0,
        sourceClipId: 0,
        label: "Scene 01",
        start: 0,
        end: 5,
        duration: 5,
        detector: "pyscenedetect-adaptive",
      }],
      sceneStatus: "ready",
    }, {
      ...base,
      scenes: [],
      sceneStatus: "failed",
      sceneError: "Media video job failed during scene-detect.",
      captionStatus: "failed",
      captionError: "Captioning requires successful PySceneDetect scene output.",
    });

    expect(merged.sceneStatus).toBe("failed");
    expect(merged.sceneError).toBe("Media video job failed during scene-detect.");
    expect(merged.scenes).toEqual([]);
    expect(merged.captionStatus).toBe("failed");
  });

  test("caption sidecar updates preserve uploaded storage and attach manifest location", () => {
    const merged = mergeUploadedVideoSourceUpdate(base, {
      ...base,
      captionStatus: "ready",
      captionManifestPath: "media-uploads/2026/clip.mp4.analysis/client-captions/captions.json",
      captionManifestUrl: "https://s3.v1su4.dev/stack-structure/media-uploads/2026/clip.mp4.analysis/client-captions/captions.json",
      scenes: [{
        id: 0,
        sourceClipId: 0,
        label: "Scene 01",
        start: 0,
        end: 5,
        duration: 5,
        detector: "pyscenedetect-adaptive",
        caption: "Close-up of a singer under blue light.",
        captionSource: "lfm-webgpu",
      }],
    });

    expect(merged.storageProvider).toBe("rustfs");
    expect(merged.captionStatus).toBe("ready");
    expect(merged.captionManifestPath).toContain("client-captions/captions.json");
    expect(merged.scenes?.[0]?.caption).toBe("Close-up of a singer under blue light.");
  });
});
