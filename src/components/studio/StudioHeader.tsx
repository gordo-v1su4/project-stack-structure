"use client";

import { fmt } from "./math";

type StudioHeaderProps = {
  tabLabel: string;
  tabSub: string;
  playhead: number;
  bpm: number;
};

export function StudioHeader({ tabLabel, tabSub, playhead, bpm }: StudioHeaderProps) {
  return (
    <header className="flex items-center justify-between border-b border-[#181818] bg-[#0c0c0c] px-5 py-[8px] shrink-0">
      <div className="flex items-center gap-3">
        <span className="text-[10px] uppercase tracking-[0.22em] text-[#363636]">SVS</span>
        <span className="text-[#222]">/</span>
        <span className="text-[12px] font-semibold uppercase tracking-[0.18em] text-[#d0d0d0]">{tabLabel}</span>
        <span className="text-[10px] text-[#3a3a3a] border-l border-[#222] pl-3 ml-1">{tabSub}</span>
      </div>
      <div className="flex items-center gap-4">
        <span className="flex items-center gap-2 text-[10px] text-[#3a8a3a] uppercase tracking-[0.18em]">
          <span className="h-[5px] w-[5px] rounded-full bg-[#3a8a3a] animate-pulse" />
          Engine Ready
        </span>
        <span className="font-mono text-[11px] text-[#383838]">{fmt(playhead * (8 * 4 * (60 / bpm)))}</span>
      </div>
    </header>
  );
}
