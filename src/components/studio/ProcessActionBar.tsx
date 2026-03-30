"use client";

import type { Tab } from "./types";

type ProcessActionBarProps = {
  tab: Tab;
  done: boolean;
  isRunning: boolean;
  progress: number;
  disabled?: boolean;
  disabledReason?: string;
  onRun: () => void;
  onResetDone: () => void;
};

function actionLabel(tab: Tab): string {
  switch (tab) {
    case "split":
      return "Initialize Segments";
    case "beatsplit":
      return "Detect & Split Beats";
    case "shuffle":
      return "Execute Shuffle";
    case "join":
      return "Concatenate Clips";
    case "beatjoin":
      return "Render Beat Join";
    default:
      return "Render Speed Ramp";
  }
}

export function ProcessActionBar({
  tab,
  done,
  isRunning,
  progress,
  disabled = false,
  disabledReason = "Unavailable",
  onRun,
  onResetDone,
}: ProcessActionBarProps) {
  return (
    <div className="border border-[#1a1a1a] rounded-[2px] bg-[#0c0c0c] p-3">
      {done ? (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#3a8a3a]" />
            <span className="text-[12px] text-[#3a8a3a]">Complete — /output/processed/</span>
          </div>
          <button type="button" onClick={onResetDone} className="text-[10px] text-[#404040] hover:text-[#888]">
            RESET
          </button>
        </div>
      ) : isRunning ? (
        <div>
          <div className="flex justify-between text-[11px] mb-2">
            <span className="text-[#484848] uppercase tracking-[0.14em]">Processing…</span>
            <span className="font-mono text-[#e05c00]">{Math.floor(progress)}%</span>
          </div>
          <div className="h-[3px] bg-[#1a1a1a] rounded-full">
            <div className="h-full bg-[#e05c00] rounded-full transition-all duration-200" style={{ width: `${progress}%` }} />
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={onRun}
          disabled={disabled}
          title={disabled ? disabledReason : undefined}
          className={`w-full py-[10px] text-[12px] font-semibold uppercase tracking-[0.22em] rounded-[2px] transition-colors ${
            disabled
              ? "bg-[#2a2a2a] text-[#6a6a6a] cursor-not-allowed"
              : "bg-[#e05c00] text-[#fff] hover:bg-[#c95200] active:bg-[#b34800]"
          }`}
        >
          {disabled ? disabledReason : actionLabel(tab)}
        </button>
      )}
    </div>
  );
}
