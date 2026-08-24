"use client";

import { NAV } from "./constants";
import type { PipelineStage } from "./studioPipeline";
import type { Tab } from "./types";

export type SidebarSessionStats = {
  audioLabel: string | null;
  videoCount: number;
  sceneCount: number;
  captionReadyCount: number;
  captionTotalCount: number;
};

type StudioSidebarProps = {
  tab: Tab;
  stages: PipelineStage[];
  sessionStats: SidebarSessionStats;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onSelectTab: (t: Tab) => void;
};

export function StudioSidebar({ tab, stages, sessionStats, collapsed, onToggleCollapsed, onSelectTab }: StudioSidebarProps) {
  const stagesByKey = new Map(stages.map((stage) => [stage.key, stage]));

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onToggleCollapsed}
        title="Expand workflow panel"
        className="group fixed left-0 top-1/2 z-40 flex -translate-y-1/2 items-stretch overflow-hidden rounded-r-[2px] bg-[#0c0c0c]/95 text-left backdrop-blur-sm transition-colors hover:bg-[#151515]"
      >
        <span className="w-[2px] shrink-0 bg-[#e05c00] transition-colors group-hover:bg-[#ff8a3d]" />
        <span
          className="px-[5px] py-5 text-[9px] font-medium uppercase tracking-[0.3em] text-[#8a8a8a] transition-colors group-hover:text-[#e8e8e8]"
          style={{ writingMode: "vertical-rl" }}
        >
          Menu
        </span>
      </button>
    );
  }

  return (
    <aside className="flex w-52 shrink-0 flex-col border-r border-[#181818] bg-[#0c0c0c]">
      <div className="flex items-center gap-2 border-b border-[#181818] px-3 py-[10px]">
        <div className="grid grid-cols-2 gap-[2px] shrink-0">
          <div className="h-[7px] w-[7px] bg-[#e05c00]" />
          <div className="h-[7px] w-[7px] bg-[#2a2a2a]" />
          <div className="h-[7px] w-[7px] bg-[#2a2a2a]" />
          <div className="h-[7px] w-[7px] bg-[#e05c00]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold tracking-wide text-[#e0e0e0]">SVS Studio</div>
          <div className="text-[9px] uppercase tracking-[0.22em] text-[#3a3a3a]">Video Process Engine</div>
        </div>
        <button
          type="button"
          onClick={onToggleCollapsed}
          title="Collapse workflow panel"
          className="shrink-0 rounded-[2px] border border-transparent px-1.5 py-1 text-[12px] text-[#555] hover:border-[#333] hover:text-[#e05c00]"
        >
          «
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        <div className="mb-1 px-3 pt-1 text-[9px] uppercase tracking-[0.22em] text-[#343434]">Workflow</div>
        {NAV.map((item) => {
          const stage = stagesByKey.get(item.key);
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onSelectTab(item.key)}
              className={`flex w-full items-center gap-0 px-0 py-0 text-left transition-colors ${
                tab === item.key ? "bg-[#131313] text-[#e0e0e0]" : "text-[#585858] hover:bg-[#0f0f0f] hover:text-[#999]"
              }`}
            >
              <div
                className="w-[2px] self-stretch shrink-0 mr-3"
                style={{ background: tab === item.key ? "#e05c00" : "transparent", minHeight: 32 }}
              />
              <div className="flex-1 py-[7px]">
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-medium leading-tight">{item.label}</span>
                  {stage?.isNext ? (
                    <span className="rounded-[2px] border border-[#e05c00] px-1 text-[8px] uppercase tracking-[0.14em] text-[#e05c00]">Next</span>
                  ) : null}
                </div>
                <div className="text-[10px] text-[#3a3a3a]">{item.sub}</div>
              </div>
              <span
                className={`mr-3 h-1.5 w-1.5 shrink-0 rounded-full ${stage?.ready ? "bg-[#3a8a3a]" : "bg-[#2a2a2a]"}`}
                title={stage ? `${stage.label}: ${stage.status}` : undefined}
              />
            </button>
          );
        })}
      </div>

      <div className="border-t border-[#181818] p-3 space-y-[6px]">
        <div className="mb-1 text-[9px] uppercase tracking-[0.2em] text-[#353535]">Session</div>
        {[
          { label: "Master audio", value: sessionStats.audioLabel ?? "none" },
          { label: "Clips", value: String(sessionStats.videoCount) },
          { label: "Scenes", value: String(sessionStats.sceneCount) },
          {
            label: "Captions",
            value: sessionStats.captionTotalCount > 0
              ? `${sessionStats.captionReadyCount}/${sessionStats.captionTotalCount}`
              : "—",
          },
        ].map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-2 text-[10px]">
            <span className="text-[#3a3a3a]">{row.label}</span>
            <span className="max-w-[110px] truncate font-mono text-[#8a8a8a]" title={row.value}>
              {row.value}
            </span>
          </div>
        ))}
      </div>
    </aside>
  );
}
