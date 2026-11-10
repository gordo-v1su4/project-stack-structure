"use client";

import type { BrowserPreviewPlayer, PreviewSegment } from "../previewPlayer";
import { usePreviewPlayerState } from "../usePreviewPlayerState";
import { animaticShotAtTime, type StillAnimaticPlan } from "../stillAnimatic";
import { AnimaticShotOverlay } from "../AnimaticShotIdentity";

/** Selections may start mid-song; the local player clock is not master time. */
export function animaticFootageSongTime(segments: PreviewSegment[], index: number, elapsed: number): number | null {
  const segment = segments[index];
  if (!segment || !Number.isFinite(segment.musicStart)) return null;
  const before = segments.slice(0, index).reduce((sum, s) => sum + s.endTime - s.startTime, 0);
  return segment.musicStart! + Math.min(segment.endTime - segment.startTime, Math.max(0, elapsed - before));
}

/** Only this leaf subscribes to the full-rate clock. Labels never alter media. */
export function AnimaticFootageLabels({ player, segments, plan }: { player: BrowserPreviewPlayer; segments: PreviewSegment[]; plan: StillAnimaticPlan }) {
  const state = usePreviewPlayerState(player);
  const time = animaticFootageSongTime(segments, state.currentIndex, state.currentTime);
  if (time === null || time < 0 || time > plan.masterDuration + 1 / plan.fps) return null;
  return <AnimaticShotOverlay shot={animaticShotAtTime(plan, time)} fps={plan.fps} aboveControls />;
}
