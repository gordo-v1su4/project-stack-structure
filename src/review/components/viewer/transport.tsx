"use client";

import { useViewerStore } from "@/review/lib/store/viewer-store";
import { timeToTimecode, timeToFrame } from "@/review/lib/video/frame-utils";
import {
  PlayIcon,
  PauseIcon,
  FrameBackIcon,
  FrameFwdIcon,
  LoopIcon,
} from "@/review/components/shared/icons";

const RATES = [0.5, 1, 2];

function IconButton({
  children,
  onClick,
  active,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  title?: string;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-[2px] transition-colors"
      style={{ color: active ? "var(--accent)" : "var(--text-mut)" }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.color = "var(--text-hi)";
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.color = "var(--text-mut)";
      }}
    >
      {children}
    </button>
  );
}

export function Transport() {
  const isPlaying = useViewerStore((s) => s.isPlaying);
  const togglePlay = useViewerStore((s) => s.togglePlay);
  const currentTime = useViewerStore((s) => s.currentTime);
  const fps = useViewerStore((s) => s.fps);
  const loop = useViewerStore((s) => s.loop);
  const toggleLoop = useViewerStore((s) => s.toggleLoop);
  const playbackRate = useViewerStore((s) => s.playbackRate);
  const setPlaybackRate = useViewerStore((s) => s.setPlaybackRate);
  const requestStep = useViewerStore((s) => s.requestStep);
  const mode = useViewerStore((s) => s.mode);

  if (mode !== "video") return null;

  const frame = timeToFrame(currentTime, fps || 30);

  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center gap-1">
        <IconButton title="Frame back (←)" onClick={() => requestStep(-1)}>
          <FrameBackIcon />
        </IconButton>
        <IconButton title="Play / Pause (Space)" onClick={togglePlay}>
          {isPlaying ? <PauseIcon /> : <PlayIcon />}
        </IconButton>
        <IconButton title="Frame forward (→)" onClick={() => requestStep(1)}>
          <FrameFwdIcon />
        </IconButton>
        <IconButton title="Loop (L)" onClick={toggleLoop} active={loop}>
          <LoopIcon />
        </IconButton>

        <div className="ml-2 flex items-baseline gap-2 font-mono text-[11px] tabular-nums">
          <span className="text-[var(--text-hi)]">
            {timeToTimecode(currentTime, fps || 30)}
          </span>
          <span className="text-[var(--text-faint)]">·</span>
          <span className="text-[var(--text-mut)]">F{frame}</span>
        </div>
      </div>

      <div className="flex items-center gap-0.5 rounded-[2px] border border-[var(--border)] p-0.5">
        {RATES.map((r) => (
          <button
            key={r}
            onClick={() => setPlaybackRate(r)}
            className="rounded-[1px] px-1.5 py-0.5 font-mono text-[10px] tabular-nums transition-colors"
            style={{
              color: playbackRate === r ? "var(--text-hi)" : "var(--text-mut)",
              background: playbackRate === r ? "var(--bg-inset)" : "transparent",
            }}
          >
            {r}×
          </button>
        ))}
      </div>
    </div>
  );
}
