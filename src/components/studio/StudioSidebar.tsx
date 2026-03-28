"use client";

import { NAV } from "./constants";
import type { Tab } from "./types";

type StudioSidebarProps = {
  tab: Tab;
  gpu: number;
  cpu: number;
  vram: number;
  onSelectTab: (t: Tab) => void;
};

export function StudioSidebar({ tab, gpu, cpu, vram, onSelectTab }: StudioSidebarProps) {
  return (
    <aside className="flex w-52 shrink-0 flex-col border-r border-[#181818] bg-[#0c0c0c]">
      <div className="flex items-center gap-2 border-b border-[#181818] px-3 py-[10px]">
        <div className="grid grid-cols-2 gap-[2px] shrink-0">
          <div className="h-[7px] w-[7px] bg-[#e05c00]" />
          <div className="h-[7px] w-[7px] bg-[#2a2a2a]" />
          <div className="h-[7px] w-[7px] bg-[#2a2a2a]" />
          <div className="h-[7px] w-[7px] bg-[#e05c00]" />
        </div>
        <div>
          <div className="text-[13px] font-semibold tracking-wide text-[#e0e0e0]">SVS Studio</div>
          <div className="text-[9px] uppercase tracking-[0.22em] text-[#3a3a3a]">Video Process Engine</div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        <div className="mb-1 px-3 pt-1 text-[9px] uppercase tracking-[0.22em] text-[#343434]">Module Selection</div>
        {NAV.map((item) => (
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
            <div className="py-[7px]">
              <div className="text-[12px] font-medium leading-tight">{item.label}</div>
              <div className="text-[10px] text-[#3a3a3a]">{item.sub}</div>
            </div>
          </button>
        ))}
      </div>

      <div className="border-t border-[#181818] p-3 space-y-[6px]">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[9px] uppercase tracking-[0.2em] text-[#353535]">Engine</span>
          <span className="flex items-center gap-1 text-[9px] text-[#3a8a3a]">
            <span className="h-[5px] w-[5px] rounded-full bg-[#3a8a3a] animate-pulse" />
            LIVE
          </span>
        </div>
        {[
          { label: "RTX 5090", val: gpu, unit: "%", max: 100, color: "#e05c00" },
          { label: "CPU", val: cpu, unit: "%", max: 100, color: "#454545" },
          { label: "VRAM", val: vram, unit: " GB", max: 24, color: "#6a5000" },
        ].map((m) => (
          <div key={m.label}>
            <div className="flex justify-between text-[10px] mb-[3px]">
              <span className="text-[#3a3a3a]">{m.label}</span>
              <span className="font-mono" style={{ color: m.color }}>
                {m.val.toFixed(m.unit === " GB" ? 1 : 0)}
                {m.unit}
              </span>
            </div>
            <div className="h-[2px] bg-[#181818] rounded-full">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${(m.val / m.max) * 100}%`, background: m.color }}
              />
            </div>
          </div>
        ))}
        <div className="pt-1 text-[9px] font-mono text-[#2a2a2a]">FFmpeg 7.1 · CUDA 12.8</div>
      </div>
    </aside>
  );
}
