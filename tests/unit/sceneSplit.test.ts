import { describe, expect, test } from "bun:test";
import { detectScenesFromStoredVideo, mergeSceneIntoPrevious, mergeShortSceneCuts, nextScenePollInterval, normalizeSplitterManifest } from "../../src/components/studio/sceneSplit";
import type { DetectedSceneSegment, MotionDescriptor } from "../../src/components/studio/types";
import { createPlaceholderMotionDescriptor } from "../../src/components/studio/motionDescriptors";
import { scoreMotionContinuity } from "../../src/components/studio/motionRanking";
import { sceneMotionLabel } from "../../src/components/studio/panels/matchVisualEvidence";
import type { VideoMoment } from "../../src/components/studio/musicVideoProject";

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

describe("sceneSplit motion evidence normalization", () => {
  const normalize = (motion: unknown, nested = false) => normalizeSplitterManifest({ segments: [{ start: 0, end: 3,
    ...(nested ? { visual_analysis: { motion } } : { motion_descriptor: motion }) }] }, 0)[0];
  const measured = (): MotionDescriptor => ({
    id: "measured-scene", targetKind: "segment", filePath: "scene.mp4", segmentId: 0, start: 0, end: 3,
    dominantAngleDeg: 10, dominantMagnitude: 0.4, motionCoherence: 0.8, cameraMotionType: "pan",
    cameraMotionStrength: 0.4, residualMotionStrength: 0.08, motionEntropy: 0.2, acceleration: 0.03,
    angleHistogram: [0.8, 0.2, 0, 0, 0, 0, 0, 0], magnitudeP50: 0.2, magnitudeP90: 0.4,
    confidence: { overall: 0.9, camera: 0.8, residual: 0.7 },
    provenance: { kind: "optical-flow", tool: "opencv-farneback", version: "4.10.0",
      generatedAt: "2026-11-09T00:00:00Z", notes: "Computed from sampled frames." },
  });
  for (const nested of [false, true]) {
    test(`empty motion is absent, not measured (${nested ? "visual analysis" : "manifest"})`, () => {
      const scene = normalize({}, nested);
      expect(scene.motionDescriptor).toBe(null);
      if (nested) expect(scene.visualAnalysis?.motion).toBe(null);
      expect(sceneMotionLabel(scene as unknown as VideoMoment)).toBe("Motion unavailable");
      expect(scoreMotionContinuity({ from: scene.motionDescriptor ?? null, to: measured() })).toBe(0);
    });
    test(`explicit placeholder retains its source and null values without usable confidence (${nested ? "visual analysis" : "manifest"})`, () => {
      const placeholder = createPlaceholderMotionDescriptor({ targetKind: "segment", filePath: "scene.mp4", segmentId: 0,
        start: 0, end: 3, generatedAt: "2026-11-09T00:00:00Z", notes: "Not computed yet." });
      const descriptor = normalize(placeholder, nested).motionDescriptor!;
      expect(descriptor).toEqual({ ...placeholder, confidence: { overall: 0, camera: 0, residual: 0 } });
      expect(sceneMotionLabel({ motionDescriptor: descriptor } as VideoMoment)).toBe("Motion unavailable");
      expect(scoreMotionContinuity({ from: descriptor, to: measured() })).toBe(0);
    });
    test(`valid worker data, including provenance/confidence, survives normalization (${nested ? "visual analysis" : "manifest"})`, () => {
      const input = measured();
      const scene = normalize(input, nested);
      expect(scene.motionDescriptor).toEqual(input);
      if (nested) expect(scene.visualAnalysis?.motion).toEqual(input);
      expect(sceneMotionLabel(scene as unknown as VideoMoment)).toBe("Rightward flow");
      expect(scoreMotionContinuity({ from: scene.motionDescriptor!, to: scene.motionDescriptor! })).toBeGreaterThan(0);
    });
  }
  test("missing or invalid provenance never invents optical flow or authorizes supplied metrics", () => {
    for (const provenance of [undefined, {}, { kind: "made-up", tool: "legacy-tool", notes: "Imported metadata" }]) {
      const scene = normalize({ ...measured(), provenance });
      const descriptor = scene.motionDescriptor!;
      expect(descriptor.provenance.kind).toBe("placeholder");
      expect(descriptor.dominantMagnitude).toBe(0.4);
      expect(descriptor.provenance.tool).toBe(provenance && "tool" in provenance ? provenance.tool : "unknown");
      expect(descriptor.confidence).toEqual({ overall: 0, camera: 0, residual: 0 });
      expect(sceneMotionLabel(scene as unknown as VideoMoment)).toBe("Motion unavailable");
      expect(scoreMotionContinuity({ from: descriptor, to: descriptor })).toBe(0);
    }
  });
  test("recognized provenance alone does not turn null measurements into confidence", () => {
    const blank = createPlaceholderMotionDescriptor({ targetKind: "file", filePath: "scene.mp4" });
    const descriptor = normalize({ ...blank, provenance: { ...blank.provenance, kind: "optical-flow" },
      confidence: { overall: 1, camera: 1, residual: 1 } }).motionDescriptor!;
    expect(descriptor.provenance.kind).toBe("optical-flow");
    expect(descriptor.dominantMagnitude).toBe(null);
    expect(descriptor.confidence).toEqual({ overall: 0, camera: 0, residual: 0 });
  });
  test("genuinely static zero values and null angle retain their measured authority", () => {
    const input = { ...measured(), dominantAngleDeg: null, dominantMagnitude: 0, cameraMotionType: "static",
      cameraMotionStrength: 0, residualMotionStrength: 0, acceleration: 0, magnitudeP50: 0, magnitudeP90: 0,
      angleHistogram: [0, 0, 0, 0, 0, 0, 0, 0] };
    const scene = normalize(input);
    expect(scene.motionDescriptor).toEqual(input);
    expect(sceneMotionLabel(scene as unknown as VideoMoment)).toBe("Little image motion");
  });
  test("legacy snake-case metrics and explicit manual/vector provenance are preserved", () => {
    for (const kind of ["manual", "ffmpeg-motion-vectors"]) {
      const descriptor = normalize({ dominant_magnitude: 0, dominant_angle_deg: null, camera_motion_type: "static",
        confidence: { overall: 0.7 }, provenance: { kind, tool: "declared-tool", generated_at: "2026-11-09T00:00:00Z" } }).motionDescriptor!;
      expect(descriptor.dominantMagnitude).toBe(0);
      expect(descriptor.dominantAngleDeg).toBe(null);
      expect(descriptor.provenance).toMatchObject({ kind, tool: "declared-tool", generatedAt: "2026-11-09T00:00:00Z" });
      expect(descriptor.confidence).toEqual({ overall: 0.7, camera: 0, residual: 0 });
    }
  });
  test("missing or non-finite confidence is zero, never an inferred .75", () => {
    for (const confidence of [undefined, {}, { overall: Infinity, camera: NaN, residual: "0.9" }]) {
      expect(normalize({ ...measured(), confidence }).motionDescriptor?.confidence).toEqual({ overall: 0, camera: 0, residual: 0 });
    }
    expect(normalize({ ...measured(), confidence: { overall: 2, camera: -1, residual: 0.3 } }).motionDescriptor?.confidence)
      .toEqual({ overall: 1, camera: 0, residual: 0.3 });
  });
});

describe("sceneSplit.normalizeSplitterManifest caption lanes", () => {
  test("labels worker-embedded qwen captions as smart, including snake_case caption_source", () => {
    const scenes = normalizeSplitterManifest({
      job_id: "job-9",
      segments: [
        { index: 1, start_seconds: 0, end_seconds: 4, duration_seconds: 4, caption: "storm jungle", caption_source: "qwen3-vl-server" },
        { index: 2, start_seconds: 4, end_seconds: 8, duration_seconds: 4, caption: "blip text", captionSource: "self-hosted-blip-cpu" },
      ],
    }, 0);

    expect(scenes[0]).toMatchObject({ captionSource: "qwen3-vl-server", captionMode: "smart" });
    expect(scenes[1]).toMatchObject({ captionSource: "self-hosted-blip-cpu", captionMode: "fast" });
  });
});

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
  test("backs off status polling to a bounded interval", () => {
    expect(nextScenePollInterval(2_500)).toBe(3_750);
    expect(nextScenePollInterval(10_000)).toBe(15_000);
    expect(nextScenePollInterval(15_000)).toBe(15_000);
    expect(nextScenePollInterval(0)).toBe(0);
  });

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
        return Response.json({
          manifest: mediaSceneManifest,
          sourceStorage: { bucket: "stack-structure", objectKey: "media-uploads/video-source/assembled/assembled.mp4" },
        });
      }

      return Response.json({ error: `unexpected ${href}` }, { status: 500 });
    }) as typeof fetch;

    try {
      const { scenes, sourceStorage } = await detectScenesFromStoredVideo({
        bucket: "stack-structure",
        objectKey: "media-uploads/2026/clip.mp4",
      }, 4, { pollIntervalMs: 0 });

      expect(scenes).toHaveLength(2);
      expect(sourceStorage).toEqual({
        bucket: "stack-structure",
        objectKey: "media-uploads/video-source/assembled/assembled.mp4",
      });
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

  test("forwards detailed Qwen instructions and durable character references to the initial media pipeline", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      calls.push({ url: href, init });
      if (href === "/api/media/video/jobs") {
        return Response.json({ job: { job_id: "video-job-context", status: "completed" } });
      }
      if (href === "/api/media/video/jobs/video-job-context/result") {
        return Response.json({ manifest: mediaSceneManifest });
      }
      return Response.json({ error: `unexpected ${href}` }, { status: 500 });
    }) as typeof fetch;

    try {
      await detectScenesFromStoredVideo({
        bucket: "stack-structure",
        objectKey: "media-uploads/2026/clip.mp4",
      }, 4, {
        pollIntervalMs: 0,
        captionSettings: {
          mode: "smart",
          context: {
            captionStyle: "detailed-cinematic",
            characters: [{ name: "Diego", role: "primary" }],
          },
          referenceImages: [{
            name: "Diego",
            role: "primary",
            bucket: "stack-structure",
            objectKey: "reference-assets/character-1/diego.png",
          }],
        },
      });

      const body = JSON.parse(String(calls[0]?.init?.body));
      expect(body.captionPrompt).toContain("30-60 word sentence");
      expect(body.captionPrompt).toContain("exact character name");
      expect(JSON.parse(body.captionContext)).toMatchObject({
        projectContext: { characters: [{ name: "Diego", role: "primary" }] },
      });
      expect(body.captionReferences).toEqual([{
        name: "Diego",
        role: "primary",
        bucket: "stack-structure",
        objectKey: "reference-assets/character-1/diego.png",
      }]);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test("keeps polling long-running processing jobs without dispatching a duplicate", async () => {
    const calls: string[] = [];
    const previousFetch = globalThis.fetch;
    let processingReads = 0;
    globalThis.fetch = (async (url: string | URL | Request) => {
      const href = String(url);
      calls.push(href);

      if (href === "/api/media/video/jobs") {
        return Response.json({
          job: {
            job_id: "video-job-long-running",
            status: "queued",
            stage: "trigger-queued",
          },
        });
      }

      if (href === "/api/media/video/jobs/video-job-long-running") {
        processingReads += 1;
        return Response.json({
          job_id: "video-job-long-running",
          status: processingReads > 30 ? "completed" : "processing",
          stage: processingReads > 30 ? "pipeline-completed" : "trigger-executing",
        });
      }

      if (href === "/api/media/video/jobs/video-job-long-running/result") {
        return Response.json({ manifest: mediaSceneManifest });
      }

      return Response.json({ error: `unexpected ${href}` }, { status: 500 });
    }) as typeof fetch;

    try {
      const { scenes } = await detectScenesFromStoredVideo({
        bucket: "stack-structure",
        objectKey: "media-uploads/2026/long-running.mp4",
      }, 5, { timeoutMs: 1_000, pollIntervalMs: 0 });

      expect(scenes).toHaveLength(2);
      expect(calls.filter((href) => href === "/api/media/video/jobs")).toHaveLength(1);
      expect(calls.filter((href) => href === "/api/media/video/jobs/video-job-long-running")).toHaveLength(31);
      expect(calls.at(-1)).toBe("/api/media/video/jobs/video-job-long-running/result");
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});
