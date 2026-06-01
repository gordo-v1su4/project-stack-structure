/// <reference lib="webworker" />
/**
 * Histogram-based scene detection worker. Receives RGBA frame buffers from the
 * main thread, computes a 32-bin-per-channel RGB histogram, and returns the
 * chi-squared distance vs the previous frame. Pure math, ported from FreeCut's
 * histogram-scene-detection.ts (computeHistogram + chiSquaredDistance).
 */

import type { HistogramRequest } from "./types";

const BINS_PER_CHANNEL = 32;
const TOTAL_BINS = BINS_PER_CHANNEL * 3;

function computeHistogram(pixels: Uint8ClampedArray): Float32Array {
  const hist = new Float32Array(TOTAL_BINS);
  const binScale = BINS_PER_CHANNEL / 256;
  const pixelCount = pixels.length / 4;

  for (let i = 0; i < pixels.length; i += 4) {
    const rBin = Math.min((pixels[i] * binScale) | 0, BINS_PER_CHANNEL - 1);
    const gBin = Math.min((pixels[i + 1] * binScale) | 0, BINS_PER_CHANNEL - 1);
    const bBin = Math.min((pixels[i + 2] * binScale) | 0, BINS_PER_CHANNEL - 1);
    hist[rBin]++;
    hist[BINS_PER_CHANNEL + gBin]++;
    hist[BINS_PER_CHANNEL * 2 + bBin]++;
  }

  for (let c = 0; c < 3; c++) {
    const offset = c * BINS_PER_CHANNEL;
    for (let b = 0; b < BINS_PER_CHANNEL; b++) {
      hist[offset + b] /= pixelCount;
    }
  }
  return hist;
}

function chiSquaredDistance(a: Float32Array, b: Float32Array): number {
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    const sum = a[i] + b[i];
    if (sum > 0) {
      const diff = a[i] - b[i];
      distance += (diff * diff) / sum;
    }
  }
  return distance;
}

let prev: Float32Array | null = null;

self.onmessage = (e: MessageEvent<HistogramRequest | { type: "reset" }>) => {
  const msg = e.data;
  if (msg.type === "reset") {
    prev = null;
    return;
  }
  if (msg.type === "frame") {
    const pixels = new Uint8ClampedArray(msg.pixels);
    const hist = computeHistogram(pixels);
    const distance = prev ? chiSquaredDistance(prev, hist) : 0;
    prev = hist;
    (self as DedicatedWorkerGlobalScope).postMessage({
      type: "distance",
      time: msg.time,
      distance,
    });
  }
};
