"use client";

import { useEffect, useRef, useCallback } from "react";
import {
  BrowserPreviewPlayer,
  type PreviewPlayerState,
  type PreviewSegment,
} from "./previewPlayer";

type PreviewPlayerProps = {
  player: BrowserPreviewPlayer;
  segments: PreviewSegment[];
  state: PreviewPlayerState;
  segmentLabels?: string[];
};

export function PreviewPlayer({
  player,
  segments,
  state,
  segmentLabels,
}: PreviewPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) {
      player.attach(videoRef.current);
    }
    return () => {
      player.detach();
    };
  }, [player]);

  useEffect(() => {
    player.load(segments);
  }, [player, segments]);

  const handlePlay = useCallback(() => {
    if (state.status === "paused") {
      player.resume();
    } else {
      player.play();
    }
  }, [player, state.status]);

  const handlePause = useCallback(() => {
    player.pause();
  }, [player]);

  const handleStop = useCallback(() => {
    player.stop();
  }, [player]);

  const handleSegmentClick = useCallback(
    (index: number) => {
      player.seekToSegment(index);
    },
    [player]
  );

  const progressPct =
    state.totalDuration > 0
      ? Math.min(100, (state.currentTime / state.totalDuration) * 100)
      : 0;

  const currentSegment = segments[state.currentIndex];

  return (
    <div className="space-y-2">
      <div className="relative">
        <video
          ref={videoRef}
          preload="metadata"
          muted={false}
          playsInline
          className="aspect-video w-full rounded-[2px] border border-[#181818] bg-[#050505]"
        />
        {state.status === "loading" && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#00000088] rounded-[2px]">
            <span className="text-[10px] font-mono text-[#e05c00] animate-pulse">
              LOADING SEGMENT...
            </span>
          </div>
        )}
        {state.status === "ended" && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#00000066] rounded-[2px]">
            <span className="text-[10px] font-mono text-[#3a8a3a]">
              PREVIEW COMPLETE
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        {state.status === "playing" ? (
          <button
            type="button"
            onClick={handlePause}
            className="text-[9px] uppercase tracking-[0.14em] px-2 py-1 border border-[#e05c00] text-[#e05c00] rounded-[2px] hover:bg-[#e05c0012]"
          >
            Pause
          </button>
        ) : (
          <button
            type="button"
            onClick={handlePlay}
            disabled={segments.length === 0}
            className={`text-[9px] uppercase tracking-[0.14em] px-2 py-1 border rounded-[2px] ${
              segments.length === 0
                ? "border-[#2a2a2a] text-[#4a4a4a] cursor-not-allowed"
                : "border-[#e05c00] text-[#e05c00] hover:bg-[#e05c0012]"
            }`}
          >
            {state.status === "paused" ? "Resume" : "Play"}
          </button>
        )}
        <button
          type="button"
          onClick={handleStop}
          className="text-[9px] uppercase tracking-[0.14em] px-2 py-1 border border-[#2a2a2a] text-[#555] rounded-[2px] hover:border-[#444] hover:text-[#888]"
        >
          Stop
        </button>
        <span className="flex-1" />
        <span className="font-mono text-[9px] text-[#4d4d4d]">
          {state.segmentCount > 0
            ? `${state.currentIndex + 1}/${state.segmentCount}`
            : "—"}
        </span>
      </div>

      <div className="h-[3px] bg-[#141414] rounded-full overflow-hidden">
        <div
          className="h-full bg-[#e05c00] rounded-full transition-all duration-150"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {currentSegment && (
        <div className="flex justify-between text-[9px]">
          <span className="font-mono text-[#666]">{currentSegment.label}</span>
          <span className="font-mono text-[#444]">
            {formatTime(state.currentTime)} / {formatTime(state.totalDuration)}
          </span>
        </div>
      )}

      {segments.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {segments.map((segment, index) => {
            const isActive = index === state.currentIndex;
            const isPast = index < state.currentIndex;
            return (
              <button
                key={`seg-${index}-${segment.label}`}
                type="button"
                onClick={() => handleSegmentClick(index)}
                className={`text-[8px] font-mono px-[4px] py-[2px] rounded-[1px] border transition-colors ${
                  isActive
                    ? "border-[#e05c00] bg-[#e05c0018] text-[#e05c00]"
                    : isPast
                      ? "border-[#1a1a1a] bg-[#0d0d0d] text-[#3a3a3a]"
                      : "border-[#1a1a1a] bg-[#090909] text-[#555] hover:border-[#2a2a2a]"
                }`}
                title={segmentLabels?.[index] ?? segment.label}
              >
                {index + 1}
              </button>
            );
          })}
        </div>
      )}

      {state.errorMessage && (
        <div className="text-[9px] text-[#b96c43]">{state.errorMessage}</div>
      )}
    </div>
  );
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${mins}:${String(secs).padStart(2, "0")}.${ms}`;
}
