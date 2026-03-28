"use client";

import { LOG } from "./constants";
import type { ShuffleMode, Tab } from "./types";

type StudioRightPanelProps = {
  readout: [string, string | number][];
  tab: Tab;
  shuffleMode: ShuffleMode;
};

export function StudioRightPanel({ readout, tab, shuffleMode }: StudioRightPanelProps) {
  return (
    <aside className="w-52 shrink-0 border-l border-[#181818] bg-[#0c0c0c] flex flex-col overflow-y-auto">
      <div className="border-b border-[#181818] p-3">
        <div className="mb-2 text-[9px] uppercase tracking-[0.22em] text-[#343434]">Live Readout</div>
        <div className="space-y-[5px]">
          {readout.map(([k, v]) => (
            <div key={String(k)} className="flex justify-between items-center">
              <span className="text-[10px] text-[#434343]">{k}</span>
              <span className="font-mono text-[11px] text-[#e05c00]">{v}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="border-b border-[#181818] p-3">
        <div className="mb-2 text-[9px] uppercase tracking-[0.22em] text-[#343434]">Output Pipeline</div>
        <div className="border border-[#181818] bg-[#080808] rounded-[2px] px-2 py-[5px] font-mono text-[10px] text-[#484848] mb-2">
          /output/processed_v1/
        </div>
        <div className="grid grid-cols-2 gap-2">
          {[
            ["QUEUE", "00:00"],
            ["CORES", "16384"],
          ].map(([k, v]) => (
            <div key={k} className="border border-[#181818] bg-[#090909] rounded-[2px] p-2">
              <div className="text-[9px] text-[#303030] mb-[2px]">{k}</div>
              <div className={`font-mono text-[12px] ${k === "CORES" ? "text-[#e05c00]" : "text-[#777]"}`}>{v}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="border-b border-[#181818] p-3 flex-1">
        <div className="mb-2 text-[9px] uppercase tracking-[0.22em] text-[#343434]">Terminal</div>
        <div className="space-y-[4px]">
          {LOG.map((l, i) => (
            <div key={i} className="font-mono text-[9px] leading-tight">
              <span className="text-[#e05c0099]">[{l.tag}]</span> <span style={{ color: l.col }}>{l.msg}</span>
            </div>
          ))}
          <div className="font-mono text-[9px] text-[#2e2e2e] mt-1 animate-pulse">&gt; WAITING_FOR_OPERATOR_INPUT_</div>
        </div>
      </div>

      <div className="p-3">
        <div className="mb-1 text-[9px] uppercase tracking-[0.22em] text-[#343434]">Tip</div>
        <p className="text-[10px] leading-relaxed text-[#383838]">
          {tab === "shuffle" && shuffleMode === "motion" ? (
            <>
              <span className="text-[#e05c00]">Lookahead 4–5</span> yields best motion continuity. Use Precise analysis for final render.
            </>
          ) : tab === "shuffle" && shuffleMode === "color" ? (
            <>
              <span className="text-[#e05c00]">Sunset</span> gradient works best on warm-toned footage. Match end/start palette for seamless cuts.
            </>
          ) : tab === "ramp" ? (
            <>
              Use <span className="text-[#e05c00]">Dynamic</span> with drop slowdown &lt;0.5 for cinematic music video pacing.
            </>
          ) : tab === "beatjoin" ? (
            <>
              Set <span className="text-[#e05c00]">Onset Boost</span> above 0.6 for punchy drum-reactive cuts on EDM.
            </>
          ) : (
            <>
              Enable <span className="text-[#e05c00]">CUDA SM_120</span> for 4× faster encode than CPU on RTX 5090.
            </>
          )}
        </p>
      </div>
    </aside>
  );
}
