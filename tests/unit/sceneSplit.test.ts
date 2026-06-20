import { describe, expect, test } from "bun:test";
import { normalizeSplitterManifest } from "../../src/components/studio/sceneSplit";

const splitterManifest = {
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
  test("normalizes Splitter Pro 2 manifest segments into scene records with asset URLs", () => {
    const scenes = normalizeSplitterManifest(splitterManifest, 3, "https://splitter.serving.cloud");

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
    expect(scenes[0]?.clipUrl).toBe("https://splitter.serving.cloud/api/jobs/job-123/assets/clips/segment-001.mp4");
    expect(scenes[0]?.thumbnailUrl).toBe("https://splitter.serving.cloud/api/jobs/job-123/assets/thumbnails/segment-001.jpg");
  });

  test("accepts full result wrapper returned by /api/jobs/{job_id}/result", () => {
    const scenes = normalizeSplitterManifest({ manifest: splitterManifest }, 1, "https://splitter.serving.cloud");

    expect(scenes).toHaveLength(2);
    expect(scenes[1]?.start).toBe(5);
  });
});
