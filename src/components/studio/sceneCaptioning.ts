"use client";

import { captionFrame } from "@/review/lib/analysis/caption-client";
import { createAnalysisVideo, grabBitmap } from "@/review/lib/video/frame-grab";
import type { DetectedSceneSegment, UploadedVideoSource } from "./types";

export type SceneCaptionProgress = {
  completed: number;
  total: number;
  sceneId: number;
};

export async function captionDetectedScenes(
  source: UploadedVideoSource,
  scenes: DetectedSceneSegment[],
  onProgress?: (progress: SceneCaptionProgress, scenes: DetectedSceneSegment[]) => void,
): Promise<DetectedSceneSegment[]> {
  if (!scenes.length) return scenes;

  let video: HTMLVideoElement | null = null;
  const captioned = [...scenes];

  try {
    video = await createAnalysisVideo(source.videoUrl);

    for (let index = 0; index < captioned.length; index += 1) {
      const scene = captioned[index]!;
      if (scene.caption) {
        onProgress?.({ completed: index + 1, total: captioned.length, sceneId: scene.id }, [...captioned]);
        continue;
      }

      const sampleTime = Math.max(
        0,
        Math.min(scene.start + 0.4, (scene.start + scene.end) / 2, Math.max(0, source.duration - 0.05)),
      );

      try {
        const bitmap = await grabBitmap(video, sampleTime);
        const result = await captionFrame(bitmap);
        captioned[index] = {
          ...scene,
          caption: result.text,
          captionMeta: result.meta,
          captionSource: "lfm-webgpu",
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
