"use client";

import { StatusDot, type StatusTone } from "./ui";

type StudioStatusBarProps = {
  /** Short preview/pipeline state label, e.g. "Ready" or "Preparing preview". */
  statusLabel: string;
  statusTone: StatusTone;
  /** Latest human-readable activity line (upload/analysis/export progress). */
  activity: string | null;
  activityTone: StatusTone;
};

/** One-line footer: what the studio is doing right now. */
export function StudioStatusBar({ statusLabel, statusTone, activity, activityTone }: StudioStatusBarProps) {
  return (
    <footer className="flex h-7 shrink-0 items-center gap-3 border-t border-line bg-ink-1 px-4 text-[11px]">
      <span className="flex shrink-0 items-center gap-2 text-fg-2">
        <StatusDot tone={statusTone} pulse />
        {statusLabel}
      </span>
      {activity ? (
        <>
          <span className="text-fg-4">·</span>
          <span className={`min-w-0 truncate ${activityTone === "failed" ? "text-danger" : "text-fg-3"}`} title={activity}>
            {activity}
          </span>
        </>
      ) : null}
    </footer>
  );
}
