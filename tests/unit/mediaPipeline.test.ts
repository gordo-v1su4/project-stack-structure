import { describe, expect, test } from "bun:test";

import {
  CAPTION_BATCH_SIZE,
  buildCaptionBatchPayload,
  chunk,
  mergeCaptionBatchResults,
  unwrapMediaWorkerManifest,
} from "@/trigger/media";

describe("media pipeline v3 contracts", () => {
  test("caps Qwen batches at six scenes and preserves every scene", () => {
    const scenes = Array.from({ length: 16 }, (_, index) => ({ index: index + 1 }));
    const batches = chunk(scenes, CAPTION_BATCH_SIZE);
    expect(batches.map((batch) => batch.length)).toEqual([6, 6, 4]);
    expect(batches.flat()).toEqual(scenes);
  });

  test("builds a caption batch from durable storyboard object paths", () => {
    const payload = buildCaptionBatchPayload({
      batch: [{
        index: 7,
        start_seconds: 2,
        end_seconds: 5,
        duration_seconds: 3,
        storyboard_path: "media-uploads/source.mp4.analysis/v2/run/artifacts/scene-007-storyboard.jpg",
        sample_times: { first: 2, middle: 3.5, last: 5 },
      }],
      batchIndex: 1,
      bucket: "stack-structure",
      sourceContentHash: "abc123",
      sourceName: "source.mp4",
      prompt: "describe",
      model: "qwen-test",
      captionContext: JSON.stringify({
        projectContext: {
          captionStyle: "detailed-cinematic",
          characters: [{ name: "Diego", role: "primary" }],
        },
      }),
      captionReferences: [{
        name: "Diego",
        role: "primary",
        bucket: "stack-structure",
        objectKey: "reference-assets/character-1/diego.png",
      }],
    });
    expect(payload.scenes).toHaveLength(1);
    expect(payload.scenes[0]?.sceneIndex).toBe(7);
    expect(payload.scenes[0]?.objectKey).toContain("analysis/v2");
    expect(payload.scenes[0]?.captionReferences?.[0]?.name).toBe("Diego");
    expect(JSON.parse(payload.scenes[0]?.captionContext ?? "{}")).toMatchObject({
      projectContext: {
        captionStyle: "detailed-cinematic",
        characters: [{ name: "Diego", role: "primary" }],
      },
      sampleTimes: { first: 2, middle: 3.5, last: 5 },
    });
  });

  test("merges successful captions and leaves missing scenes reusable", () => {
    const manifest = { segments: [{ index: 1, caption: null }, { index: 2, caption: null }] };
    const merged = mergeCaptionBatchResults(manifest, [{
      captions: [{ sceneIndex: 2, result: { text: JSON.stringify({ caption: "Second scene" }), model: "qwen-test" } }],
    }]);
    expect(merged.captionedSceneCount).toBe(1);
    expect(merged.segments[0]?.caption).toBeNull();
    expect(merged.segments[1]?.caption).toBe("Second scene");
  });

  test("unwraps the production media gateway result before counting scenes", () => {
    const manifest = { segments: [{ index: 1, storyboard_path: "scene-001.jpg" }] };
    expect(unwrapMediaWorkerManifest({ manifest, manifestObjectKey: "analysis/manifest.json" })).toEqual(manifest);
    expect(unwrapMediaWorkerManifest({ result: { manifest } })).toEqual(manifest);
    expect(unwrapMediaWorkerManifest(manifest)).toEqual(manifest);
  });
});
