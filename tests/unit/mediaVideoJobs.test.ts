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
            visual_analysis: {
              content_hash: "abc123",
              keyframe_timestamps: [0, 1.2, 3.4],
              color: {
                palette: [
                  { hex: "#112233", weight: 0.6 },
                  { l: 42, a: 10, b: -20, weight: 0.4 },
                ],
                first_palette: [{ hex: "#101010", weight: 1 }],
                last_palette: [{ hex: "#f0a020", weight: 1 }],
              },
              motion: {
                id: "motion-scene-1",
                target_kind: "segment",
                file_path: "media-uploads/clip.mp4",
                segment_id: 1,
                start: 0,
                end: 3.5,
                dominant_angle_deg: 12,
                dominant_magnitude: 0.7,
                motion_coherence: 0.82,
                camera_motion_type: "pan",
                camera_motion_strength: 0.7,
                residual_motion_strength: 0.2,
                motion_entropy: 0.3,
                acceleration: 0.1,
                confidence: { overall: 0.91, camera: 0.88, residual: 0.72 },
                provenance: { kind: "optical-flow", tool: "opencv-farneback", generated_at: "2026-06-19T00:00:00.000Z" },
              },
            },
            split_kind: "micro-shot",
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
    expect(scenes[0].splitKind).toBe("micro-shot");
    expect(scenes[0].contentHash).toBe("abc123");
    expect(scenes[0].keyframeTimestamps).toEqual([0, 1.2, 3.4]);
    expect(scenes[0].visualAnalysis?.color?.palette[0]?.hex).toBe("#112233");
    expect(scenes[0].visualAnalysis?.color?.palette[0]?.weight).toBe(0.6);
    expect(scenes[0].visualAnalysis?.color?.firstPalette?.[0]?.hex).toBe("#101010");
    expect(scenes[0].visualAnalysis?.color?.lastPalette?.[0]?.hex).toBe("#f0a020");
    expect(scenes[0].motionDescriptor).toMatchObject({
      id: "motion-scene-1",
      cameraMotionType: "pan",
      dominantAngleDeg: 12,
      dominantMagnitude: 0.7,
      provenance: { kind: "optical-flow", tool: "opencv-farneback" },
    });
    expect(scenes[1].thumbnailUrl).toBe("https://media.v1su4.dev/api/jobs/video_123/assets/media-uploads/clip.analysis/thumb-002.jpg");
  });
});
