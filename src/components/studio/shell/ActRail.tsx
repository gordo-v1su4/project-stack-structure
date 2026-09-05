"use client";

import { NAV } from "../constants";
import type { PipelineStage } from "../studioPipeline";
import type { Tab } from "../types";
import { ACT_ICONS, CheckIcon, LockIcon } from "./icons";

type ActRailProps = {
  tab: Tab;
  stages: PipelineStage[];
  onSelectTab: (tab: Tab) => void;
};

type ActState = "done" | "current" | "next" | "open" | "locked";

function stateFor(stage: PipelineStage | undefined, active: boolean): ActState {
  if (active) return "current";
  if (!stage) return "locked";
  if (stage.complete) return "done";
  if (stage.isNext) return "next";
  if (stage.available) return "open";
  return "locked";
}

/**
 * 56px act rail: the single stage-status surface. Icon + number per act, a
 * progress ring at the foot. Locked acts stay clickable (soft gate) — the
 * inspector explains what is missing.
 */
export function ActRail({ tab, stages, onSelectTab }: ActRailProps) {
  const stagesByKey = new Map(stages.map((stage) => [stage.key, stage]));
  const completeCount = stages.filter((stage) => stage.complete).length;
  const ratio = stages.length ? completeCount / stages.length : 0;

  return (
    <nav aria-label="Acts" className="flex w-14 shrink-0 flex-col items-center border-r border-line bg-ink-0 py-3">
      <Brand />
      <ol className="mt-4 flex flex-1 flex-col items-center gap-1">
        {NAV.map((item, index) => {
          const stage = stagesByKey.get(item.key);
          const state = stateFor(stage, tab === item.key);
          const Icon = ACT_ICONS[item.key];
          const status = stage?.status ?? item.sub;
          return (
            <li key={item.key} className="relative">
              <button
                type="button"
                onClick={() => onSelectTab(item.key)}
                aria-current={state === "current" ? "step" : undefined}
                aria-label={`${index + 1}. ${item.label} — ${status}`}
                title={`${item.label} · ${status}  (${index + 1})`}
                className={`group relative flex h-11 w-11 flex-col items-center justify-center rounded-lg transition-[background-color,color,transform] duration-[var(--duration-fast)] ease-[var(--ease-out-soft)] active:scale-95 ${
                  state === "current"
                    ? "bg-ink-3 text-fg-0"
                    : state === "locked"
                      ? "text-fg-4 hover:bg-ink-2 hover:text-fg-3"
                      : "text-fg-2 hover:bg-ink-2 hover:text-fg-0"
                }`}
              >
                {state === "current" ? (
                  <span aria-hidden className="absolute -left-[7px] top-2 bottom-2 w-[2px] rounded-full bg-accent" />
                ) : null}
                <Icon size={17} className={state === "current" ? "text-accent" : undefined} />
                <span className={`mt-[3px] font-mono text-[9px] leading-none ${state === "current" ? "text-fg-1" : "text-fg-4"}`}>
                  {String(index + 1).padStart(2, "0")}
                </span>
                <StateBadge state={state} />
              </button>
            </li>
          );
        })}
      </ol>
      <ProgressRing ratio={ratio} label={`${completeCount}/${stages.length}`} />
    </nav>
  );
}

function StateBadge({ state }: { state: ActState }) {
  if (state === "done") {
    return (
      <span aria-hidden className="absolute right-[5px] top-[5px] flex h-3 w-3 items-center justify-center rounded-full bg-ok text-ink-0">
        <CheckIcon size={9} strokeWidth={2.2} />
      </span>
    );
  }
  if (state === "next") {
    return <span aria-hidden className="studio-pulse absolute right-[6px] top-[6px] h-[6px] w-[6px] rounded-full bg-accent" />;
  }
  if (state === "locked") {
    return (
      <span aria-hidden className="absolute right-[5px] top-[5px] text-fg-4">
        <LockIcon size={9} />
      </span>
    );
  }
  return null;
}

function ProgressRing({ ratio, label }: { ratio: number; label: string }) {
  const r = 12;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative mt-2 flex h-9 w-9 items-center justify-center" title={`${label} acts complete`} aria-label={`${label} acts complete`}>
      <svg width="36" height="36" viewBox="0 0 36 36" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx="18" cy="18" r={r} fill="none" stroke="oklch(1 0 0 / 0.08)" strokeWidth="2" />
        <circle
          cx="18"
          cy="18"
          r={r}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - ratio)}
          style={{ transition: "stroke-dashoffset var(--duration-slow) var(--ease-spring)" }}
        />
      </svg>
      <span className="relative font-mono text-[9px] text-fg-2">{label}</span>
    </div>
  );
}

function Brand() {
  return (
    <div className="grid shrink-0 grid-cols-2 gap-[3px]" aria-label="Stack Structure" title="Stack Structure">
      <div className="h-[6px] w-[6px] rounded-[1px] bg-accent" />
      <div className="h-[6px] w-[6px] rounded-[1px] bg-ink-4" />
      <div className="h-[6px] w-[6px] rounded-[1px] bg-ink-4" />
      <div className="h-[6px] w-[6px] rounded-[1px] bg-accent" />
    </div>
  );
}
