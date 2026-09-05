"use client";

import { StatusDot, type StatusTone } from "../ui";
import { CommandIcon, PauseIcon, PlayIcon, SkipBackIcon, StopIcon } from "./icons";

export type TransportModel = {
  /** What Space controls right now. */
  source: "preview" | "song" | "none";
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  label: string;
  bpm: number | null;
};

type TransportBarProps = {
  transport: TransportModel;
  onToggle: () => void;
  onStop: () => void;
  onRewind: () => void;
  statusLabel: string;
  statusTone: StatusTone;
  activity: string | null;
  activityTone: StatusTone;
  onOpenCommands: () => void;
};

/** Bottom bar: transport on the left, studio status in the middle, ⌘K on the right. */
export function TransportBar({ transport, onToggle, onStop, onRewind, statusLabel, statusTone, activity, activityTone, onOpenCommands }: TransportBarProps) {
  const disabled = transport.source === "none";
  return (
    <footer className="flex h-11 shrink-0 items-center gap-4 border-t border-line bg-ink-0 px-3">
      <div className="flex items-center gap-1">
        <TransportButton label="Return to start (K)" onClick={onRewind} disabled={disabled}>
          <SkipBackIcon size={14} />
        </TransportButton>
        <TransportButton label={transport.isPlaying ? "Pause (Space)" : "Play (Space)"} onClick={onToggle} disabled={disabled} primary>
          {transport.isPlaying ? <PauseIcon size={14} /> : <PlayIcon size={14} />}
        </TransportButton>
        <TransportButton label="Stop" onClick={onStop} disabled={disabled}>
          <StopIcon size={12} />
        </TransportButton>
      </div>

      <div className="flex items-baseline gap-2 font-mono text-[12px] tabular-nums">
        <span className={disabled ? "text-fg-4" : "text-fg-0"}>{formatClock(transport.currentTime)}</span>
        <span className="text-fg-4">/</span>
        <span className="text-fg-3">{formatClock(transport.duration)}</span>
        {transport.bpm ? <span className="ml-2 text-[11px] text-fg-3">{transport.bpm} BPM</span> : null}
      </div>

      <span className="min-w-0 truncate text-[11px] text-fg-3" title={transport.label}>
        {transport.label}
      </span>

      <div className="ml-auto flex min-w-0 items-center gap-3 text-[11px]">
        <span className="flex shrink-0 items-center gap-2 text-fg-2">
          <StatusDot tone={statusTone} pulse />
          {statusLabel}
        </span>
        {activity ? (
          <span className={`hidden min-w-0 max-w-[38vw] truncate lg:inline ${activityTone === "failed" ? "text-danger" : "text-fg-3"}`} title={activity}>
            {activity}
          </span>
        ) : null}
        <button
          type="button"
          onClick={onOpenCommands}
          className="flex h-7 items-center gap-2 rounded-md border border-line px-2.5 text-[11px] text-fg-2 transition-colors hover:border-line-2 hover:text-fg-0"
          title="Command palette (⌘K)"
        >
          <CommandIcon size={13} />
          <span>Commands</span>
          <kbd className="studio-kbd">⌘K</kbd>
        </button>
      </div>
    </footer>
  );
}

function TransportButton({ label, onClick, disabled, primary = false, children }: { label: string; onClick: () => void; disabled: boolean; primary?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`flex h-8 items-center justify-center rounded-md transition-[background-color,color,transform] duration-[var(--duration-fast)] ease-[var(--ease-out-soft)] active:scale-95 disabled:cursor-not-allowed disabled:text-fg-4 ${
        primary ? "w-10 bg-ink-3 text-fg-0 hover:bg-ink-4 disabled:bg-ink-2" : "w-8 text-fg-2 hover:bg-ink-2 hover:text-fg-0"
      }`}
    >
      {children}
    </button>
  );
}

function formatClock(seconds: number) {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(safe / 60);
  const rest = safe - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${rest.toFixed(2).padStart(5, "0")}`;
}
