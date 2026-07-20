import { describe, expect, test } from "bun:test";

import { countMismatchedSceneCaptions, rerunSourceSceneAnalysis, selectSceneRetrySources, type VideoSceneUpdate } from "@/components/studio/mediaUpload";
import { sceneCaptionMatchesMode } from "@/components/studio/sceneCaptioning";
import type { DetectedSceneSegment, UploadedVideoSource } from "@/components/studio/types";

const originalFetch = globalThis.fetch;

function makeScene(overrides: Partial<DetectedSceneSegment> = {}): DetectedSceneSegment {
  return {
    id: 0,
    sourceClipId: 0,
    label: "Scene 01",
    start: 0,
    end: 2,
    duration: 2,
    detector: "pyscenedetect-adaptive",
    confidence: null,
    ...overrides,
  };
}

function makeSource(overrides: Partial<UploadedVideoSource> = {}): UploadedVideoSource {
  return {
    id: 0,
    name: "clip.mp4",
    duration: 10,
    size: 100,
    thumbnailUrl: "thumb",
    videoUrl: "blob:clip",
    ...overrides,
  };
}

describe("sceneCaptionMatchesMode", () => {
  test("captions imported from the scene-detect worker match neither lane", () => {
    const blipScene = makeScene({
      caption: "a person on a log",
      captionMode: "fast",
      captionSource: "self-hosted-blip-cpu" as DetectedSceneSegment["captionSource"],
    });

    expect(sceneCaptionMatchesMode(blipScene, "fast")).toBe(false);
    expect(sceneCaptionMatchesMode(blipScene, "smart")).toBe(false);
  });

  test("worker-embedded Qwen captions satisfy smart mode without a recaption pass", () => {
    // The video worker now runs SCENE_CAPTION_MODE=smart and embeds Qwen
    // captions in the scene-detect manifest; the source decides the lane.
    const workerQwenScene = makeScene({ caption: "a person in a storm", captionSource: "qwen3-vl-server" });

    expect(sceneCaptionMatchesMode(workerQwenScene, "smart")).toBe(true);
    expect(sceneCaptionMatchesMode(workerQwenScene, "fast")).toBe(false);
  });

  test("studio-produced captions match only their own lane; manual always matches", () => {
    const fastScene = makeScene({ caption: "x", captionMode: "fast", captionSource: "lfm-webgpu" });
    const smartScene = makeScene({ caption: "x", captionMode: "smart", captionSource: "qwen3-vl-server" });
    const manualScene = makeScene({ caption: "x", captionSource: "manual" });
    const uncaptioned = makeScene();

    expect(sceneCaptionMatchesMode(fastScene, "fast")).toBe(true);
    expect(sceneCaptionMatchesMode(fastScene, "smart")).toBe(false);
    expect(sceneCaptionMatchesMode(smartScene, "smart")).toBe(true);
    expect(sceneCaptionMatchesMode(smartScene, "fast")).toBe(false);
    expect(sceneCaptionMatchesMode(manualScene, "fast")).toBe(true);
    expect(sceneCaptionMatchesMode(manualScene, "smart")).toBe(true);
    expect(sceneCaptionMatchesMode(uncaptioned, "smart")).toBe(false);
  });

  test("countMismatchedSceneCaptions counts wrong-lane captions across sources", () => {
    const sources = [
      makeSource({
        scenes: [
          makeScene({ id: 0, caption: "x", captionMode: "fast", captionSource: "self-hosted-blip-cpu" as DetectedSceneSegment["captionSource"] }),
          makeScene({ id: 1, caption: "x", captionMode: "smart", captionSource: "qwen3-vl-server" }),
          makeScene({ id: 2 }),
        ],
      }),
    ];

    expect(countMismatchedSceneCaptions(sources, "smart")).toBe(1);
    expect(countMismatchedSceneCaptions(sources, "fast")).toBe(2);
  });
});

describe("selectSceneRetrySources", () => {
  test("picks clips with failed detection or missed captions, skips completed and un-stored clips", () => {
    const stored = { storageBucket: "b", storagePath: "p" };
    const sources = [
      // fully Qwen-captioned: done
      makeSource({ id: 0, ...stored, sceneStatus: "ready", scenes: [makeScene({ caption: "x", captionSource: "qwen3-vl-server" })] }),
      // missed caption (kept BLIP + captionError): retry
      makeSource({ id: 1, ...stored, sceneStatus: "ready", scenes: [makeScene({ caption: "x", captionSource: "self-hosted-blip-cpu" as DetectedSceneSegment["captionSource"], captionError: "proxy timeout" })] }),
      // detection failed: retry
      makeSource({ id: 2, ...stored, sceneStatus: "failed", scenes: [] }),
      // not in RustFS: cannot retry
      makeSource({ id: 3, sceneStatus: "failed", scenes: [] }),
    ];

    expect(selectSceneRetrySources(sources, "smart").map((source) => source.id)).toEqual([1, 2]);
  });

  test("keeps stored clips with active scene detection out of the retry queue", () => {
    const stored = { storageBucket: "b", storagePath: "p" };
    const sources = [
      makeSource({ id: 0, ...stored, sceneStatus: "detecting", scenes: [] }),
      makeSource({ id: 1, ...stored, sceneStatus: "failed", scenes: [] }),
    ];

    expect(selectSceneRetrySources(sources, "smart").map((source) => source.id)).toEqual([1]);
  });
});

describe("rerunSourceSceneAnalysis", () => {
  test("fails fast with a clear message when the clip is not in RustFS", async () => {
    const updates: VideoSceneUpdate[] = [];
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return Response.json({});
    }) as typeof fetch;

    try {
      await rerunSourceSceneAnalysis(makeSource(), { mode: "smart" }, (update) => updates.push(update));

      expect(fetchCalled).toBe(false);
      expect(updates).toHaveLength(1);
      expect(updates[0]?.source.sceneStatus).toBe("failed");
      expect(updates[0]?.source.sceneError).toContain("re-upload");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("records the gateway error when scene detection fails again", async () => {
    const updates: VideoSceneUpdate[] = [];
    globalThis.fetch = (async () =>
      Response.json({ job: { job_id: "job-1", status: "failed", stage: "frames", error: "ffmpeg exited 187" } })) as typeof fetch;

    try {
      await rerunSourceSceneAnalysis(
        makeSource({ storageBucket: "stack-structure", storagePath: "media-uploads/clip.mp4", sceneStatus: "failed", sceneError: "old error" }),
        { mode: "smart" },
        (update) => updates.push(update),
      );

      expect(updates.map((update) => update.source.sceneStatus)).toEqual(["detecting", "failed"]);
      expect(updates[0]?.source.sceneError).toBeNull();
      expect(updates[1]?.source.sceneError).toContain("ffmpeg exited 187");
      expect(updates[1]?.source.captionStatus).toBe("failed");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
