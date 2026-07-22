import { describe, expect, test } from "bun:test";

import { createTriggerIdempotencyKey } from "@/lib/triggerIdempotency";
import {
  STACK_STRUCTURE_TRIGGER_TASKS,
} from "@/lib/triggerOrchestration";
import { MEDIA_ASSEMBLY_MACHINE } from "@/trigger/queues";
import { resolvePreviewSegments } from "@/trigger/ffmpeg";
import { resolveExportSegments } from "@/trigger/export";
import { copyAudioChunk } from "@/trigger/essentia";

describe("Trigger orchestration", () => {
  test("allocates the no-credit self-hosted large machine for media assembly", () => {
    expect(MEDIA_ASSEMBLY_MACHINE).toBe("large-1x");
  });

  test("builds stable scoped idempotency keys without exposing source paths", () => {
    const first = createTriggerIdempotencyKey("media-scene-detect", [
      "stack-structure",
      "media-uploads/private/client-video.mp4",
      "scene-detect",
    ]);
    const second = createTriggerIdempotencyKey("media-scene-detect", [
      "stack-structure",
      "media-uploads/private/client-video.mp4",
      "scene-detect",
    ]);

    expect(first).toBe(second);
    expect(first).toMatch(/^media-scene-detect:[a-f0-9]{64}$/);
    expect(first).not.toContain("client-video.mp4");
  });

  test("changes the key when operation inputs change", () => {
    expect(createTriggerIdempotencyKey("caption", ["scene-1", "frame-a"]))
      .not.toBe(createTriggerIdempotencyKey("caption", ["scene-1", "frame-b"]));
  });

  test("uses the deployed production task identifiers", () => {
    expect(STACK_STRUCTURE_TRIGGER_TASKS).toEqual({
      mediaVideoPipeline: "media-video-pipeline",
      mediaSceneDetection: "media-video-scene-detect",
      mediaSceneCaptionBatch: "qwen-scene-caption-batch",
      mediaFinalization: "media-video-finalize",
      essentiaAnalysis: "essentia-analyze-stored-audio",
      smartSceneCaption: "qwen-smart-scene-caption",
      localGeneration: "local-ai-generation",
      higgsfieldGeneration: "higgsfield-nano-banana-pro-grid",
      deepgramTranscription: "deepgram-transcribe-stored-audio",
      ffmpegPreview: "ffmpeg-preview-or-concat",
      finalExport: "ffmpeg-final-music-video-export",
      shaderCaptureExport: "ffmpeg-shader-capture-export",
      ffglitch: "ffglitch-transform",
      imageSplitter: "image-split-grid",
    });
  });

  test("maps concat segments to their materialized source instead of one gateway upload", () => {
    expect(resolvePreviewSegments([
      { startTime: 1, endTime: 2, sourceIndex: 1 },
      { startTime: 3, endTime: 4, sourceIndex: 0 },
    ], ["/tmp/source-0.mp4", "/tmp/source-1.mp4"])).toEqual([
      { startTime: 1, endTime: 2, inputPath: "/tmp/source-1.mp4" },
      { startTime: 3, endTime: 4, inputPath: "/tmp/source-0.mp4" },
    ]);
  });

  test("rejects out-of-range preview and export source indexes", () => {
    let previewError: unknown;
    try {
      resolvePreviewSegments([{ startTime: 1, endTime: 2, sourceIndex: 2 }], ["/tmp/source-0.mp4"]);
    } catch (caught) {
      previewError = caught;
    }

    let exportError: unknown;
    try {
      resolveExportSegments([{ startTime: 1, endTime: 2, sourceIndex: -1 }], ["/tmp/source-0.mp4"]);
    } catch (caught) {
      exportError = caught;
    }

    expect(previewError instanceof Error ? previewError.message : "").toContain("invalid sourceIndex 2");
    expect(exportError instanceof Error ? exportError.message : "").toContain("invalid sourceIndex -1");
  });

  test("copies uploaded audio chunks into a bounded target buffer", () => {
    const target = new Uint8Array(5);
    let offset = copyAudioChunk(target, new Uint8Array([1, 2]).buffer, 0);
    offset = copyAudioChunk(target, new Uint8Array([3]).buffer, offset);
    offset = copyAudioChunk(target, new Uint8Array([4, 5]).buffer, offset);

    expect(offset).toBe(5);
    expect(Array.from(target)).toEqual([1, 2, 3, 4, 5]);
    let copyError: unknown;
    try {
      copyAudioChunk(target, new Uint8Array([6]).buffer, offset);
    } catch (error) {
      copyError = error;
    }
    expect(copyError instanceof Error ? copyError.message : "").toContain("exceeds declared audio size");
  });

});
