"use client";

import { LFM_SCENE_CAPTION_PROMPT } from "@/review/lib/analysis/scene-caption-format";
import { waitForTriggerRunOutput } from "@/lib/clientTriggerRuns";
import { captionFrame as captionFrameWithLfm } from "@/review/lib/analysis/caption-client";
import { createAnalysisVideo, grabBitmap } from "@/review/lib/video/frame-grab";
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
   * Recaption scenes whose existing caption was not produced by the requested
   * mode (e.g. captions imported from the scene-detect worker). The previous
   * caption is kept when the new pass fails, so a rerun never loses data.
   */
  force?: boolean;
};

let serverCaptionAvailablePromise: Promise<boolean> | null = null;

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

export async function captionDetectedScenes(
  source: UploadedVideoSource,
  scenes: DetectedSceneSegment[],
  settings: SceneCaptionSettings = { mode: "fast" },
  onProgress?: (progress: SceneCaptionProgress, scenes: DetectedSceneSegment[]) => void,
  options: SceneCaptionOptions = {},
): Promise<DetectedSceneSegment[]> {
  if (!scenes.length) return scenes;

  let video: HTMLVideoElement | null = null;
  const captioned = [...scenes];

  try {
    video = await createAnalysisVideo(source.videoUrl);

    for (let index = 0; index < captioned.length; index += 1) {
      const scene = captioned[index]!;
      const skipExisting = options.force ? sceneCaptionMatchesMode(scene, settings.mode) : Boolean(scene.caption);
      if (skipExisting) {
        onProgress?.({ completed: index + 1, total: captioned.length, sceneId: scene.id }, [...captioned]);
        continue;
      }

      const sampleTime = Math.max(
        0,
        Math.min(scene.start + 0.4, (scene.start + scene.end) / 2, Math.max(0, source.duration - 0.05)),
      );

      try {
        const result = await captionSceneFrame(video, source, scene, sampleTime, settings);
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
  video: HTMLVideoElement,
  source: UploadedVideoSource,
  scene: DetectedSceneSegment,
  sampleTime: number,
  settings: SceneCaptionSettings,
) {
  if (settings.mode === "fast") {
    const bitmap = await grabBitmap(video, sampleTime);
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

  return await captionSceneFrameViaServer(video, source, scene, sampleTime, settings);
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
  video: HTMLVideoElement,
  source: UploadedVideoSource,
  scene: DetectedSceneSegment,
  sampleTime: number,
  settings: SceneCaptionSettings,
) {
  const bitmap = await grabBitmap(video, sampleTime);
  try {
    const image = await bitmapToJpegBlob(bitmap);
    const form = new FormData();
    form.set("image", image, `${source.id}-${scene.id}.jpg`);
    form.set("prompt", buildCaptionPrompt(settings));
    form.set("mode", settings.mode);
    form.set("sourceName", source.name);
    form.set("sceneId", String(scene.id));
    form.set("sampleTime", sampleTime.toFixed(3));
    form.set("sceneStart", scene.start.toFixed(3));
    form.set("sceneEnd", scene.end.toFixed(3));
    form.set("sceneDuration", scene.duration.toFixed(3));
    const context = buildCaptionContextPayload(source, scene, settings);
    if (context) form.set("captionContext", context);

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
      ? await waitForTriggerRunOutput(runId, { timeoutMs: 145_000, pollIntervalMs: 1_500 })
      : initialPayload;
    return normalizeServerCaptionPayload(payload);
  } finally {
    bitmap.close();
  }
}

function buildCaptionPrompt(settings: SceneCaptionSettings) {
  if (settings.mode === "fast") return LFM_SCENE_CAPTION_PROMPT;
  return `${LFM_SCENE_CAPTION_PROMPT}

Additional smart-caption rules:
- Prefer concrete, searchable words that can later match music-video lyrics, themes, actions, and moods.
- Do not force the caption to match the song; describe the visible video truth first.
- Include action verbs, subject nouns, mood words, and setting details when visible.
- Use the supplied project context only as disambiguating context, never as a substitute for what is visible.`;
}

function buildCaptionContextPayload(source: UploadedVideoSource, scene: DetectedSceneSegment, settings: SceneCaptionSettings) {
  const payload = {
    sourceName: source.name,
    sourceDuration: source.duration,
    sceneId: scene.id,
    sceneLabel: scene.label,
    sceneStart: scene.start,
    sceneEnd: scene.end,
    sceneDuration: scene.duration,
    projectContext: settings.context ?? {},
  };
  return JSON.stringify(payload);
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
