import { describe, expect, test } from "bun:test";
import { detectScenesFromStoredVideo, normalizeSplitterManifest } from "../../src/components/studio/sceneSplit";

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
