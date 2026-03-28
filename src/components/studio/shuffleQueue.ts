import { sv } from "./math";
import { getClipPalette, getMotionDir } from "./palette";
import type { ColorGradient, ShuffleMode } from "./types";

const GRADIENT_WEIGHTS: Record<ColorGradient, [number, number, number]> = {
  Rainbow: [0.5, 0.3, 0.2],
  Sunset: [0.62, 0.24, 0.14],
  Ocean: [0.18, 0.32, 0.5],
};

export function buildShuffleQueue(params: {
  clipCount: number;
  shuffleMode: ShuffleMode;
  activeClip: number;
  minScore: number;
  lookahead: number;
  keepPct: number;
  colorGradient: ColorGradient;
}) {
  const { clipCount, shuffleMode, activeClip, minScore, lookahead, keepPct, colorGradient } = params;
  const clipIds = Array.from({ length: clipCount }, (_, index) => index);

  if (shuffleMode === "simple") {
    return [...clipIds].sort((left, right) => randomScore(left, activeClip) - randomScore(right, activeClip));
  }

  if (shuffleMode === "size") {
    const keepCount = Math.max(1, Math.round((clipCount * keepPct) / 100));
    const sorted = [...clipIds].sort((left, right) => clipSizeScore(right) - clipSizeScore(left));
    return [...sorted.slice(0, keepCount), ...sorted.slice(keepCount).reverse()];
  }

  if (shuffleMode === "color") {
    return [...clipIds].sort((left, right) => clipColorScore(left, colorGradient) - clipColorScore(right, colorGradient));
  }

  return buildMotionQueue({
    clipIds,
    startId: Math.min(activeClip, Math.max(0, clipCount - 1)),
    minScore,
    lookahead,
  });
}

function buildMotionQueue(params: {
  clipIds: number[];
  startId: number;
  minScore: number;
  lookahead: number;
}) {
  const { clipIds, startId, minScore, lookahead } = params;
  if (!clipIds.length) return [];

  const remaining = new Set(clipIds);
  const queue = [startId];
  remaining.delete(startId);

  while (remaining.size) {
    const current = queue[queue.length - 1] ?? startId;
    const candidates = [...remaining]
      .map((id) => ({
        id,
        score: motionTransitionScore(current, id),
      }))
      .sort((left, right) => right.score - left.score);

    const preferred = candidates.slice(0, Math.max(1, lookahead)).find((candidate) => candidate.score >= minScore);
    const next = preferred ?? candidates[0];
    if (!next) break;

    queue.push(next.id);
    remaining.delete(next.id);
  }

  return queue;
}

function randomScore(index: number, activeClip: number) {
  return sv(index * 11.7 + activeClip * 1.31);
}

function clipSizeScore(index: number) {
  return sv(index * 31) * 0.75 + (1 - (index % 3) * 0.08);
}

function clipColorScore(index: number, gradient: ColorGradient) {
  const palette = getClipPalette(index);
  const weights = GRADIENT_WEIGHTS[gradient];
  const [r, g, b] = palette
    .slice(0, 3)
    .map((hex) => parseInt(hex.replace("#", ""), 16))
    .map((value) => [(value >> 16) & 255, (value >> 8) & 255, value & 255])
    .reduce(
      (acc, [r, g, b]) => [acc[0] + r / 255, acc[1] + g / 255, acc[2] + b / 255],
      [0, 0, 0]
    );

  return r * weights[0] + g * weights[1] + b * weights[2];
}

function motionTransitionScore(from: number, to: number) {
  const fromMotion = getMotionDir(from);
  const toMotion = getMotionDir(to);
  if (fromMotion.angle < 0 || toMotion.angle < 0) {
    return 0.55 + sv((from + 1) * (to + 3));
  }

  const angleDelta = Math.abs(fromMotion.angle - toMotion.angle);
  const wrappedDelta = Math.min(angleDelta, 360 - angleDelta);
  return Math.max(0, 1 - wrappedDelta / 180);
}
