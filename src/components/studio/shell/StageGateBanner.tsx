"use client";

import type { MonitorGate } from "./ProgramMonitor";
import { Button, Kicker } from "../ui";

type StageGateBannerProps = {
  gate: MonitorGate;
};

/** Prerequisite callout when an act is blocked — compact, not a full-screen title card. */
export function StageGateBanner({ gate }: StageGateBannerProps) {
  return (
    <section
      aria-label="Stage prerequisite"
      className="flex shrink-0 items-center justify-between gap-4 rounded-md border border-line bg-ink-2 px-4 py-3"
    >
      <div className="min-w-0">
        <Kicker tone="waiting">{gate.kicker}</Kicker>
        <p className="mt-1 font-mono text-[13px] text-fg-1">{gate.headline}</p>
        {gate.detail ? <p className="mt-1 text-[12px] leading-5 text-fg-3">{gate.detail}</p> : null}
      </div>
      <Button variant="primary" size="md" onClick={gate.onAction} className="shrink-0">
        {gate.actionLabel}
      </Button>
    </section>
  );
}
