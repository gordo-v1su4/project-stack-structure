"use client";

import { waitForTriggerRunOutput } from "@/lib/clientTriggerRuns";
import { captionFrame as captionFrameWithLfm } from "@/review/lib/analysis/caption-client";
import { createAnalysisVideo, grabBitmap } from "@/review/lib/video/frame-grab";
import { buildSceneCaptionPrompt, serializeSceneCaptionContext, serializeSceneCaptionReferences } from "./sceneCaptionPrompt";
import { normalizeServerCaptionAvailability, normalizeServerCaptionPayload } from "./sceneCaptioningServer";
import type { DetectedSceneSegment, SceneCaptionSettings, UploadedVideoSource } from "./types";

const LFM_WEBGPU_MODEL_ID = "LiquidAI/LFM2.5-VL-450M-ONNX";

export type SceneCaptionProgress = {
  completed: number;
  total: number;
  sceneId: number;
};

export type SceneCaptionOptions = {
  /**
   * Replace every existing caption with a fresh result from the requested
   * lane. The previous caption is kept when the new pass fails, so a rerun
   * never loses data.
   */
  force?: boolean;
};

let serverCaptionAvailablePromise: Promise<boolean> | null = null;

export function resetServerCaptionAvailabilityCache() {
  serverCaptionAvailablePromise = null;
}

/**
 * True when a scene's existing caption already satisfies the requested
 * caption mode. The caption source is authoritative: Qwen captions satisfy
 * smart whether the studio requested them or the scene-detect worker embedded
 * them (SCENE_CAPTION_MODE=smart); other imported captions (e.g. a worker
 * BLIP pass) match neither lane. Manual captions always match.
 */
export function sceneCaptionMatchesMode(scene: DetectedSceneSegment, mode: SceneCaptionSettings["mode"]): boolean {
  if (!scene.caption) return false;
  if (scene.captionSource === "manual") return true;
  if (mode === "smart") return scene.captionSource === "qwen3-vl-server";
  return scene.captionSource === "lfm-webgpu" || scene.captionSource === "lfm-server";
}

/**
 * Clears stale captionError values left by a failed refresh when the scene
 * still has a caption that satisfies the requested lane.
 */
export function finalizeCaptionedScenes(
  scenes: DetectedSceneSegment[],
  mode: SceneCaptionSettings["mode"],
): DetectedSceneSegment[] {
  return scenes.map((scene) => {
    if (!scene.captionError || !scene.caption || !sceneCaptionMatchesMode(scene, mode)) return scene;
    return { ...scene, captionError: null };
  });
}

export function deriveSourceCaptionStatus(
  scenes: DetectedSceneSegment[],
  mode: SceneCaptionSettings["mode"],
  options: { activeStatus?: UploadedVideoSource["captionStatus"] } = {},
): Pick<UploadedVideoSource, "captionStatus" | "captionError"> {
  if (options.activeStatus === "captioning") {
    return { captionStatus: "captioning", captionError: null };
  }

  if (options.activeStatus === "waiting") {
    return { captionStatus: "waiting", captionError: null };
  }

  const finalized = finalizeCaptionedScenes(scenes, mode);
  if (!finalized.length) {
    return { captionStatus: "ready", captionError: null };
  }

  const missingCaptions = finalized.filter((scene) => !scene.caption).length;
  const hardFailures = finalized.filter((scene) => Boolean(scene.captionError) && !scene.caption).length;
  const mismatchedCaptions = finalized.filter((scene) => scene.caption && !sceneCaptionMatchesMode(scene, mode)).length;

  if (!missingCaptions && !hardFailures && !mismatchedCaptions) {
    return { captionStatus: "ready", captionError: null };
  }

  const parts: string[] = [];
  if (missingCaptions) parts.push(`${missingCaptions} scene${missingCaptions === 1 ? "" : "s"} missing captions`);
  if (hardFailures) parts.push(`${hardFailures} scene caption${hardFailures === 1 ? "" : "s"} failed`);
  if (mismatchedCaptions) {
    parts.push(`${mismatchedCaptions} scene caption${mismatchedCaptions === 1 ? "" : "s"} need the selected lane`);
  }

  return { captionStatus: "failed", captionError: parts.join("; ") };
}

export function isSourceCaptionFailed(source: UploadedVideoSource, mode: SceneCaptionSettings["mode"]): boolean {
  return deriveSourceCaptionStatus(source.scenes ?? [], mode, { activeStatus: source.captionStatus }).captionStatus === "failed";
}

export async function captionDetectedScenes(
  source: UploadedVideoSource,
  scenes: DetectedSceneSegment[],
  settings: SceneCaptionSettings = { mode: "smart" },
  onProgress?: (progress: SceneCaptionProgress, scenes: DetectedSceneSegment[]) => void,
  options: SceneCaptionOptions = {},
): Promise<DetectedSceneSegment[]> {
  if (!scenes.length) return scenes;

  resetServerCaptionAvailabilityCache();
  let video: HTMLVideoElement | null = null;
  const captioned = [...scenes];

  try {
    video = await createAnalysisVideo(source.videoUrl);

    for (let index = 0; index < captioned.length; index += 1) {
      const scene = captioned[index]!;
      const skipExisting = !options.force && Boolean(scene.caption);
      if (skipExisting) {
        onProgress?.({ completed: index + 1, total: captioned.length, sceneId: scene.id }, [...captioned]);
        continue;
      }

      const sampleTime = Math.max(
        0,
        Math.min(scene.start + 0.4, (scene.start + scene.end) / 2, Math.max(0, source.duration - 0.05)),
      );

      try {
        const result = await captionSceneFrame(source, scene, sampleTime, settings, video);
        captioned[index] = {
          ...scene,
          caption: result.text,
          captionMeta: result.meta,
          captionSource: result.captionSource,
          captionMode: settings.mode,
          captionModel: result.model,
          captionError: null,
        };
      } catch (error) {
        captioned[index] = {
          ...scene,
          captionError: error instanceof Error ? error.message : "Scene captioning failed",
        };
      }

      onProgress?.({ completed: index + 1, total: captioned.length, sceneId: scene.id }, [...captioned]);
    }

    return captioned;
  } finally {
    if (video) {
      video.src = "";
      video.remove();
    }
  }
}

export function countSceneCaptions(scenes: DetectedSceneSegment[] | undefined) {
  return scenes?.filter((scene) => Boolean(scene.caption)).length ?? 0;
}

async function captionSceneFrame(
  source: UploadedVideoSource,
  scene: DetectedSceneSegment,
  sampleTime: number,
  settings: SceneCaptionSettings,
  video: HTMLVideoElement,
) {
  if (settings.mode === "fast") {
    const bitmap = await loadSceneCaptionBitmap(video, scene, sampleTime);
    const result = await captionFrameWithLfm(bitmap);
    return {
      text: result.text,
      meta: result.meta,
      captionSource: "lfm-webgpu" as const,
      model: LFM_WEBGPU_MODEL_ID,
    };
  }

  const serverAvailable = await isServerCaptioningAvailable();
  if (!serverAvailable) {
    throw new Error("Smart Qwen3-VL scene caption gateway is not configured or reachable.");
  }

  return await captionSceneFrameViaServer(source, scene, sampleTime, settings, video);
}

async function loadSceneCaptionBitmap(
  video: HTMLVideoElement,
  scene: DetectedSceneSegment,
  sampleTime: number,
) {
  if (scene.storyboardUrl) {
    try {
      const response = await fetch(scene.storyboardUrl, { cache: "no-store" });
      if (response.ok) {
        const blob = await response.blob();
        return await createImageBitmap(blob);
      }
    } catch {
      // Fall back to decoding the source video when storyboard fetch fails.
    }
  }

  return grabBitmap(video, sampleTime);
}

async function isServerCaptioningAvailable() {
  serverCaptionAvailablePromise ??= fetch("/api/caption/scene", { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) return false;
      const payload = normalizeServerCaptionAvailability(await response.json());
      return payload.configured && payload.reachable;
    })
    .catch((error) => {
      throw new Error(error instanceof Error ? error.message : "Could not check scene caption gateway availability.");
    });
  return serverCaptionAvailablePromise;
}

async function captionSceneFrameViaServer(
  source: UploadedVideoSource,
  scene: DetectedSceneSegment,
  sampleTime: number,
  settings: SceneCaptionSettings,
  video: HTMLVideoElement,
) {
  const bitmap = await loadSceneCaptionBitmap(video, scene, sampleTime);
  try {
    const image = await bitmapToJpegBlob(bitmap);
    const form = new FormData();
    form.set("image", image, `${source.id}-${scene.id}.jpg`);
    form.set("prompt", buildSceneCaptionPrompt(settings));
    form.set("mode", settings.mode);
    form.set("sourceName", source.name);
    form.set("sceneId", String(scene.id));
    form.set("sampleTime", sampleTime.toFixed(3));
    form.set("sceneStart", scene.start.toFixed(3));
    form.set("sceneEnd", scene.end.toFixed(3));
    form.set("sceneDuration", scene.duration.toFixed(3));
    const context = buildCaptionContextPayload(source, scene, settings);
    if (context) form.set("captionContext", context);
    if (settings.referenceImages?.length) {
      form.set("captionReferences", serializeSceneCaptionReferences(settings));
    }

    const response = await fetch("/api/caption/scene", {
      method: "POST",
      body: form,
      // A hung gateway request must fail instead of stalling the whole
      // recaption pass; failed scenes are retried in a later round.
      signal: AbortSignal.timeout(150_000),
    });
    const initialPayload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(readServerCaptionError(initialPayload) || `${response.status} ${response.statusText}`);
    }
    const runId = readServerCaptionRunId(initialPayload);
    const payload = response.status === 202 && runId
      ? await waitForTriggerRunOutput(runId, { timeoutMs: 420_000, pollIntervalMs: 2_000 })
      : initialPayload;
    return normalizeServerCaptionPayload(payload);
  } finally {
    bitmap.close();
  }
}

function buildCaptionContextPayload(source: UploadedVideoSource, scene: DetectedSceneSegment, settings: SceneCaptionSettings) {
  return serializeSceneCaptionContext(settings, {
    sourceName: source.name,
    sourceDuration: source.duration,
    sceneId: scene.id,
    sceneLabel: scene.label,
    sceneStart: scene.start,
    sceneEnd: scene.end,
    sceneDuration: scene.duration,
  });
}

async function bitmapToJpegBlob(bitmap: ImageBitmap) {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create caption frame canvas.");
  ctx.drawImage(bitmap, 0, 0);
  return canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
}

function readServerCaptionError(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const error = (payload as Record<string, unknown>).error;
  return typeof error === "string" && error.trim() ? error.trim() : undefined;
}

function readServerCaptionRunId(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const runId = (payload as Record<string, unknown>).runId;
  return typeof runId === "string" && runId.trim() ? runId.trim() : undefined;
}
