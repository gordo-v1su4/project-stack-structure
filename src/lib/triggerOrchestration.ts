import { runs, tasks } from "@trigger.dev/sdk/v3";

import type { SmartSceneCaptionPayload, smartSceneCaptionTask } from "@/trigger/caption";
import type { EssentiaStoredAudioPayload, essentiaStoredAudioTask } from "@/trigger/essentia";
import type { MediaSceneDetectionPayload, mediaSceneDetectionTask } from "@/trigger/media";
import { createTriggerIdempotencyKey } from "@/lib/triggerIdempotency";

export const STACK_STRUCTURE_TRIGGER_TASKS = {
  mediaSceneDetection: "media-video-scene-detect",
  essentiaAnalysis: "essentia-analyze-stored-audio",
  smartSceneCaption: "qwen-smart-scene-caption",
} as const;

export async function triggerMediaSceneDetection(payload: MediaSceneDetectionPayload) {
  assertTriggerConfigured();
  return tasks.trigger<typeof mediaSceneDetectionTask>(STACK_STRUCTURE_TRIGGER_TASKS.mediaSceneDetection, payload, {
    idempotencyKey: createTriggerIdempotencyKey("media-scene-detect", [
      payload.bucket,
      payload.objectKey,
      payload.mode ?? "scene-detect",
      payload.profile ?? "pyscenedetect-adaptive",
    ]),
    idempotencyKeyTTL: "24h",
    maxAttempts: 1,
    tags: ["stack-structure", "media", "vm100-heavy"],
  });
}

export async function triggerEssentiaAnalysis(payload: EssentiaStoredAudioPayload) {
  assertTriggerConfigured();
  return tasks.trigger<typeof essentiaStoredAudioTask>(STACK_STRUCTURE_TRIGGER_TASKS.essentiaAnalysis, payload, {
    idempotencyKey: createTriggerIdempotencyKey("essentia", [
      payload.bucket,
      payload.objectKey,
      payload.mode ?? "fast",
    ]),
    idempotencyKeyTTL: "24h",
    maxAttempts: 2,
    tags: ["stack-structure", "essentia", "vm100-heavy"],
  });
}

export async function triggerSmartSceneCaption(payload: SmartSceneCaptionPayload, imageDigest: string) {
  assertTriggerConfigured();
  return tasks.trigger<typeof smartSceneCaptionTask>(STACK_STRUCTURE_TRIGGER_TASKS.smartSceneCaption, payload, {
    idempotencyKey: createTriggerIdempotencyKey("smart-caption", [
      payload.sourceName ?? "unknown-source",
      payload.sceneId ?? "unknown-scene",
      payload.sampleTime ?? "unknown-time",
      payload.model,
      imageDigest,
    ]),
    idempotencyKeyTTL: "24h",
    maxAttempts: 2,
    tags: ["stack-structure", "caption", "qwen", "vm100-heavy"],
  });
}

export async function retrieveTriggerRun(runId: string) {
  assertTriggerConfigured();
  return runs.retrieve(runId);
}

export function assertTriggerConfigured(
  env?: { TRIGGER_API_URL?: string; TRIGGER_SECRET_KEY?: string },
) {
  const source = env ?? process.env as Record<string, string | undefined>;
  if (!source.TRIGGER_API_URL?.trim() || !source.TRIGGER_SECRET_KEY?.trim()) {
    throw new Error("Trigger.dev is not configured. Set TRIGGER_API_URL and TRIGGER_SECRET_KEY.");
  }
}
