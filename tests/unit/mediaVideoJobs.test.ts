import { describe, expect, test } from "bun:test";

import { normalizeMediaGatewayVideoJob } from "@/lib/mediaGateway";
import { normalizeSplitterManifest } from "@/components/studio/sceneSplit";

describe("media video jobs", () => {
  test("normalizes RustFS media API queued job payloads", () => {
    expect(normalizeMediaGatewayVideoJob({
      job: {
        job_id: "video_123",
        status: "queued",
        stage: "queued",
        bucket: "stack-structure",
        objectKey: "media-uploads/2026/06_18/clip.mp4",
        source: {
          publicUrl: "https://s3.v1su4.dev/stack-structure/media-uploads/2026/06_18/clip.mp4",
        },
      },
    })).toMatchObject({
      job_id: "video_123",
      status: "queued",
      bucket: "stack-structure",
      objectKey: "media-uploads/2026/06_18/clip.mp4",
    });
  });

  test("maps object-key worker manifests into DetectedSceneSegment contracts", () => {
    const scenes = normalizeSplitterManifest({
      manifest: {
        job_id: "video_123",
        segments: [
          {
            index: 1,
            label: "Scene 01",
            start_seconds: 0,
            end_seconds: 3.5,
            duration_seconds: 3.5,
            thumbnail_url: "https://s3.v1su4.dev/stack-structure/media-uploads/clip.analysis/thumb-001.jpg",
            detector: "pyscenedetect-adaptive",
            caption: "Wide shot of a dancer moving through a neon room.",
            sceneData: {
              shotType: "wide shot",
              subjects: ["dancer"],
              action: "moving through the room",
              setting: "neon room",
            },
          },
          {
            index: 2,
            start_seconds: 3.5,
            end_seconds: 8,
            duration_seconds: 4.5,
            thumbnail_path: "media-uploads/clip.analysis/thumb-002.jpg",
          },
        ],
      },
    }, 7, "https://media.v1su4.dev");

    expect(scenes).toHaveLength(2);
    expect(scenes[0]).toMatchObject({
      id: 0,
      sourceClipId: 7,
      label: "Scene 01",
      start: 0,
      end: 3.5,
      thumbnailUrl: "https://s3.v1su4.dev/stack-structure/media-uploads/clip.analysis/thumb-001.jpg",
      detector: "pyscenedetect-adaptive",
      caption: "Wide shot of a dancer moving through a neon room.",
      captionSource: "imported",
    });
    expect(scenes[0].captionMeta?.subjects).toEqual(["dancer"]);
    expect(scenes[1].thumbnailUrl).toBe("https://media.v1su4.dev/api/jobs/video_123/assets/media-uploads/clip.analysis/thumb-002.jpg");
  });
});
