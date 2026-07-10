import { describe, expect, test } from "bun:test";

import { createTriggerIdempotencyKey } from "@/lib/triggerIdempotency";
import {
  STACK_STRUCTURE_TRIGGER_TASKS,
} from "@/lib/triggerOrchestration";

describe("Trigger orchestration", () => {
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
      mediaSceneDetection: "media-video-scene-detect",
      essentiaAnalysis: "essentia-analyze-stored-audio",
      smartSceneCaption: "qwen-smart-scene-caption",
    });
  });

});
