/**
 * Main-thread orchestrator for histogram scene detection.
 *
 * Workers can't touch <video>, so the main thread seeks the video, draws each
 * sampled frame to a small OffscreenCanvas, and ships the RGBA buffer to the
 * worker. The worker returns chi-squared distances; we threshold + deduplicate
 * here (ported thresholds from FreeCut: 0.3 distance, 2.0s min gap).
 */

import type { SceneCut } from "./types";

const HIST_WIDTH = 160;
const HIST_HEIGHT = 90;
const CHI_SQUARED_THRESHOLD = 0.3;
const MIN_CUT_GAP_SEC = 2.0;
const SAMPLE_INTERVAL_SEC = 0.25;

function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      clearTimeout(t);
      resolve();
    };
    const t = setTimeout(() => {
      video.removeEventListener("seeked", onSeeked);
      resolve();
    }, 1000);
    video.addEventListener("seeked", onSeeked);
    video.currentTime = time;
  });
}

function deduplicate(cuts: SceneCut[], minGap: number): SceneCut[] {
  if (cuts.length <= 1) return cuts;
  const out: SceneCut[] = [];
  let best = cuts[0];
  for (let i = 1; i < cuts.length; i++) {
    const cut = cuts[i];
    if (cut.time - best.time < minGap) {
      if (cut.confidence > best.confidence) best = cut;
    } else {
      out.push(best);
      best = cut;
    }
  }
  out.push(best);
  return out;
}

export interface DetectOptions {
  onProgress?: (percent: number, cutCount: number) => void;
  signal?: AbortSignal;
}

/**
 * Detect hard cuts in a video element. Returns sorted, deduplicated cut times.
 * Requires the video to already have a valid src + known duration.
 */
export async function detectScenes(
  video: HTMLVideoElement,
  opts: DetectOptions = {}
): Promise<SceneCut[]> {
  const duration = video.duration;
  if (!Number.isFinite(duration) || duration <= 0) return [];

  const canvas = new OffscreenCanvas(HIST_WIDTH, HIST_HEIGHT);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];

  const worker = new Worker(
    new URL("./scene-detection.worker.ts", import.meta.url),
    { type: "module" }
  );

  const distanceFor = (time: number): Promise<number> =>
    new Promise((resolve) => {
      const onMsg = (e: MessageEvent) => {
        if (e.data?.type === "distance") {
          worker.removeEventListener("message", onMsg);
          resolve(e.data.distance as number);
        }
      };
      worker.addEventListener("message", onMsg);
    });

  const rawCuts: SceneCut[] = [];
  try {
    worker.postMessage({ type: "reset" });
    for (let time = 0; time < duration; time += SAMPLE_INTERVAL_SEC) {
      if (opts.signal?.aborted) break;
      await seekVideo(video, time);
      ctx.drawImage(video, 0, 0, HIST_WIDTH, HIST_HEIGHT);
      const img = ctx.getImageData(0, 0, HIST_WIDTH, HIST_HEIGHT);
      const buffer = img.data.buffer;
      const done = distanceFor(time);
      worker.postMessage(
        { type: "frame", time, width: HIST_WIDTH, height: HIST_HEIGHT, pixels: buffer },
        [buffer]
      );
      const distance = await done;
      if (distance > CHI_SQUARED_THRESHOLD && time > MIN_CUT_GAP_SEC * 0.5) {
        rawCuts.push({ time, confidence: distance });
      }
      opts.onProgress?.(Math.min(time / duration, 1), rawCuts.length);
    }
  } finally {
    worker.terminate();
  }

  opts.onProgress?.(1, rawCuts.length);
  return deduplicate(rawCuts, MIN_CUT_GAP_SEC);
}

/**
 * Convert cut times into scene segments [{start,end}]. Always includes an
 * opening scene from 0 and a closing scene to the end.
 */
export function cutsToScenes(
  cuts: SceneCut[],
  duration: number
): Array<{ startTime: number; endTime: number }> {
  const boundaries = [0, ...cuts.map((c) => c.time), duration];
  const scenes: Array<{ startTime: number; endTime: number }> = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const startTime = boundaries[i];
    const endTime = boundaries[i + 1];
    if (endTime - startTime > 0.1) scenes.push({ startTime, endTime });
  }
  return scenes;
}
