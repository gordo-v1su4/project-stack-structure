import { describe, expect, test } from "bun:test";
import { detectScenesFromStoredVideo, mergeSceneIntoPrevious, mergeShortSceneCuts, normalizeSplitterManifest } from "../../src/components/studio/sceneSplit";
import type { DetectedSceneSegment } from "../../src/components/studio/types";

function makeScene(id: number, start: number, end: number, overrides: Partial<DetectedSceneSegment> = {}): DetectedSceneSegment {
  return {
    id,
    sourceClipId: 0,
    label: `Scene ${id + 1}`,
    start,
    end,
    duration: Math.round((end - start) * 1000) / 1000,
    detector: "pyscenedetect-adaptive",
    confidence: null,
    ...overrides,
  };
}

describe("sceneSplit.mergeShortSceneCuts", () => {
  test("merges lightning-flash fragments into their neighbors (real over-split pattern)", () => {
    // Observed on a single-shot storm clip: 15s split into 5 scenes with
    // 0.83s and 0.75s fragments at exposure spikes.
    const merged = mergeShortSceneCuts([
      makeScene(0, 0, 0.83),
      makeScene(1, 0.83, 2.917),
      makeScene(2, 2.917, 3.667),
      makeScene(3, 3.667, 10.125),
      makeScene(4, 10.125, 15.042),
    ]);

    expect(merged.map((scene) => [scene.id, scene.start, scene.end])).toEqual([
      [0, 0, 3.667],
      [3, 3.667, 10.125],
      [4, 10.125, 15.042],
    ]);
    expect(merged[0]?.duration).toBeCloseTo(3.667, 3);
  });

  test("keeps clean cuts untouched and preserves the longer scene's caption", () => {
    const scenes = [
      makeScene(0, 0, 4, { caption: "wide shot" }),
      makeScene(1, 4, 4.5, { caption: "flash fragment" }),
      makeScene(2, 4.5, 9, { caption: "close-up" }),
    ];
    const merged = mergeShortSceneCuts(scenes);

    expect(merged.map((scene) => scene.caption)).toEqual(["wide shot", "close-up"]);
    expect(merged.map((scene) => [scene.start, scene.end])).toEqual([[0, 4.5], [4.5, 9]]);
  });

  test("leaves single-scene and all-long inputs unchanged", () => {
    const single = [makeScene(0, 0, 5)];
    expect(mergeShortSceneCuts(single)).toEqual(single);

    const long = [makeScene(0, 0, 5), makeScene(1, 5, 12)];
    expect(mergeShortSceneCuts(long)).toEqual(long);
  });
});

describe("sceneSplit.mergeSceneIntoPrevious", () => {
  test("merges the given cut into the one before it", () => {
    const scenes = [makeScene(0, 0, 4, { caption: "keep me" }), makeScene(1, 4, 9, { caption: "false cut" }), makeScene(2, 9, 12)];
    const merged = mergeSceneIntoPrevious(scenes, 1);

    expect(merged.map((scene) => [scene.id, scene.start, scene.end])).toEqual([
      [0, 0, 9],
      [2, 9, 12],
    ]);
    expect(merged[0]?.caption).toBe("keep me");
  });

  test("returns the input unchanged for the first cut or an unknown id", () => {
    const scenes = [makeScene(0, 0, 4), makeScene(1, 4, 9)];
    expect(mergeSceneIntoPrevious(scenes, 0)).toBe(scenes);
    expect(mergeSceneIntoPrevious(scenes, 99)).toBe(scenes);
  });
});

const mediaSceneManifest = {
  job_id: "job-123",
  source_video: "clip-1.mp4",
  duration_seconds: 15.093,
  frame_rate: 24,
  frame_count: 361,
  segment_count: 2,
  segments: [
    {
      index: 1,
      start_frame: 0,
      end_frame: 120,
      frame_count: 120,
      start_seconds: 0,
      end_seconds: 5,
      duration_seconds: 5,
      clip_path: "clips/segment-001.mp4",
      thumbnail_path: "thumbnails/segment-001.jpg",
      label: "00:00:00.000 - 00:00:05.000",
    },
    {
      index: 2,
      start_frame: 120,
      end_frame: 361,
      frame_count: 241,
      start_seconds: 5,
      end_seconds: 15.093,
      duration_seconds: 10.093,
      clip_path: "clips/segment-002.mp4",
      thumbnail_path: "thumbnails/segment-002.jpg",
      label: "00:00:05.000 - 00:00:15.093",
    },
  ],
};

describe("sceneSplit.normalizeSplitterManifest", () => {
  test("normalizes media gateway scene job manifests into scene records with asset URLs", () => {
    const scenes = normalizeSplitterManifest(mediaSceneManifest, 3, "https://media.v1su4.dev");

    expect(scenes).toHaveLength(2);
    expect(scenes[0]).toMatchObject({
      id: 0,
      sourceClipId: 3,
      label: "00:00:00.000 - 00:00:05.000",
      start: 0,
      end: 5,
      duration: 5,
      detector: "pyscenedetect-adaptive",
      assetPath: "clips/segment-001.mp4",
    });
    expect(scenes[0]?.clipUrl).toBe("https://media.v1su4.dev/api/jobs/job-123/assets/clips/segment-001.mp4");
    expect(scenes[0]?.thumbnailUrl).toBe("https://media.v1su4.dev/api/jobs/job-123/assets/thumbnails/segment-001.jpg");
  });

  test("accepts full result wrapper returned by media video job result routes", () => {
    const scenes = normalizeSplitterManifest({ manifest: mediaSceneManifest }, 1, "https://media.v1su4.dev");

    expect(scenes).toHaveLength(2);
    expect(scenes[1]?.start).toBe(5);
  });
});

describe("sceneSplit.detectScenesFromStoredVideo", () => {
  test("queues media gateway jobs from stored RustFS object references only", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      calls.push({ url: href, init });

      if (href === "/api/media/video/jobs") {
        return Response.json({
          job: {
            job_id: "video-job-123",
            status: "completed",
            stage: "completed",
          },
        });
      }

      if (href === "/api/media/video/jobs/video-job-123/result") {
        return Response.json({ manifest: mediaSceneManifest });
      }

      return Response.json({ error: `unexpected ${href}` }, { status: 500 });
    }) as typeof fetch;

    try {
      const scenes = await detectScenesFromStoredVideo({
        bucket: "stack-structure",
        objectKey: "media-uploads/2026/clip.mp4",
      }, 4, { pollIntervalMs: 0 });

      expect(scenes).toHaveLength(2);
      expect(calls.map((call) => call.url)).toEqual([
        "/api/media/video/jobs",
        "/api/media/video/jobs/video-job-123/result",
      ]);
      expect(calls.some((call) => call.url === "/api/splitter/scene")).toBe(false);
      expect(JSON.parse(String(calls[0].init?.body))).toEqual({
        bucket: "stack-structure",
        objectKey: "media-uploads/2026/clip.mp4",
        mode: "scene-detect",
        profile: "pyscenedetect-adaptive",
      });
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});
