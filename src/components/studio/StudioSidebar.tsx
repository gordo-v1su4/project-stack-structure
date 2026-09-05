"use client";

import { NAV } from "./constants";
import type { PipelineStage } from "./studioPipeline";
import type { Tab } from "./types";

type StudioSidebarProps = {
  tab: Tab;
  stages: PipelineStage[];
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onSelectTab: (t: Tab) => void;
};

type StageGlyph = "done" | "current" | "next" | "open" | "locked";

function glyphFor(stage: PipelineStage | undefined, active: boolean): StageGlyph {
  if (active) return "current";
  if (!stage) return "locked";
  if (stage.complete) return "done";
  if (stage.isNext) return "next";
  if (stage.available) return "open";
  return "locked";
}

/**
 * The single stage-status surface. One row per stage: number, label, the
 * pipeline's one-line status, and a glyph. Locked stages stay clickable
 * (soft gate) — the stage header explains what is missing.
 */
export function StudioSidebar({ tab, stages, collapsed, onToggleCollapsed, onSelectTab }: StudioSidebarProps) {
  const stagesByKey = new Map(stages.map((stage) => [stage.key, stage]));
  const completeCount = stages.filter((stage) => stage.complete).length;

  return (
    <aside
      className={`flex shrink-0 flex-col border-r border-line bg-ink-1 transition-[width] duration-200 ${collapsed ? "w-14" : "w-60"}`}
      aria-label="Workflow stages"
    >
      <div className={`flex items-center border-b border-line ${collapsed ? "justify-center px-0 py-3" : "gap-3 px-4 py-3"}`}>
        <Brand />
        {!collapsed ? (
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold tracking-tight text-fg-0">Stack Structure</div>
            <div className="text-[10.5px] text-fg-3">{completeCount}/{stages.length} stages complete</div>
          </div>
        ) : null}
        <button
          type="button"
          onClick={onToggleCollapsed}
          title={collapsed ? "Expand stages" : "Collapse stages"}
          aria-label={collapsed ? "Expand stages" : "Collapse stages"}
          className={`rounded-md border border-transparent text-fg-3 hover:border-line-2 hover:text-fg-0 ${collapsed ? "absolute left-2 top-14 h-7 w-10" : "h-7 w-7"}`}
        >
          {collapsed ? "»" : "«"}
        </button>
      </div>

      <nav className={`flex-1 overflow-y-auto ${collapsed ? "px-2 pt-10" : "px-2"} py-2`}>
        <ol className="space-y-[2px]">
          {NAV.map((item, index) => {
            const stage = stagesByKey.get(item.key);
            const active = tab === item.key;
            const glyph = glyphFor(stage, active);
            const status = stage?.status ?? item.sub;
            return (
              <li key={item.key}>
                <button
                  type="button"
                  onClick={() => onSelectTab(item.key)}
                  aria-current={active ? "step" : undefined}
                  title={collapsed ? `${index + 1}. ${item.label} — ${status}` : status}
                  className={`group flex w-full items-center rounded-md text-left transition-colors ${collapsed ? "justify-center px-0 py-2" : "gap-3 px-2.5 py-2"} ${
                    active ? "bg-ink-3" : "hover:bg-ink-2"
                  }`}
                >
                  <Glyph glyph={glyph} step={index + 1} />
                  {!collapsed ? (
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className={`text-[12.5px] font-medium ${glyph === "locked" ? "text-fg-3" : "text-fg-0"}`}>{item.label}</span>
                        {glyph === "next" ? (
                          <span className="rounded-sm border border-accent-lo px-1 text-[9px] font-medium uppercase tracking-[0.12em] text-accent">next</span>
                        ) : null}
                      </span>
                      <span className={`block truncate text-[11px] leading-4 ${glyph === "locked" ? "text-fg-4" : glyph === "done" ? "text-fg-3" : "text-fg-2"}`}>
                        {status}
                      </span>
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
    </aside>
  );
}

function Glyph({ glyph, step }: { glyph: StageGlyph; step: number }) {
  const base = "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-mono text-[10.5px]";
  switch (glyph) {
    case "done":
      return (
        <span className={`${base} border-ok-lo bg-ok-tint text-ok`} aria-label="complete">
          ✓
        </span>
      );
    case "current":
      return <span className={`${base} studio-pulse border-accent bg-accent text-white`}>{step}</span>;
    case "next":
      return <span className={`${base} border-accent-lo bg-accent-tint text-accent`}>{step}</span>;
    case "open":
      return <span className={`${base} border-line-2 bg-ink-2 text-fg-2`}>{step}</span>;
    case "locked":
    default:
      return <span className={`${base} border-line bg-ink-1 text-fg-4`}>{step}</span>;
  }
}

function Brand() {
  return (
    <div className="grid shrink-0 grid-cols-2 gap-[3px]" aria-hidden>
      <div className="h-[7px] w-[7px] rounded-[1px] bg-accent" />
      <div className="h-[7px] w-[7px] rounded-[1px] bg-ink-4" />
      <div className="h-[7px] w-[7px] rounded-[1px] bg-ink-4" />
      <div className="h-[7px] w-[7px] rounded-[1px] bg-accent" />
    </div>
  );
}
