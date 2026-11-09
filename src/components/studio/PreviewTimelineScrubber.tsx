"use client";

import { memo, useEffect, useRef } from "react";
import { bindPreviewScrubControl, formatPreviewScrubTime, type ScrubPlayer } from "./previewScrubControl";
import type { PreviewSegment } from "./previewPlayer";

/** Native range keyboard/touch controls; playback ticks update its DOM directly. */
export const PreviewTimelineScrubber = memo(function PreviewTimelineScrubber({ player, segments }: { player: ScrubPlayer; segments: readonly PreviewSegment[] }) {
  const input = useRef<HTMLInputElement>(null);
  const clock = useRef<HTMLSpanElement>(null);
  const initial = player.getState();
  useEffect(() => {
    if (!input.current || !clock.current) return;
    return bindPreviewScrubControl(player, input.current, clock.current);
  }, [player, segments]);

  return (
    <div className="min-w-0 px-1 py-1" data-preview-scrubber="true">
      <div className="flex items-center justify-between gap-2 text-[10px] text-fg-3">
        <span className="truncate">Preview position</span>
        <span ref={clock} className="shrink-0 font-mono tabular-nums" aria-live="off">
          {formatPreviewScrubTime(initial.currentTime)} / {formatPreviewScrubTime(initial.totalDuration)}
        </span>
      </div>
      <input
        ref={input}
        type="range"
        min="0"
        max={initial.totalDuration || 1}
        step="0.01"
        defaultValue={initial.currentTime}
        disabled={initial.totalDuration <= 0 || initial.segmentCount === 0}
        aria-label="Preview position"
        aria-valuetext={`${formatPreviewScrubTime(initial.currentTime)} of ${formatPreviewScrubTime(initial.totalDuration)}`}
        title="Seek within this preview. Use arrow keys, Home or End when focused."
        className="block h-8 w-full min-w-0 cursor-pointer accent-accent outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40"
      />
    </div>
  );
});
