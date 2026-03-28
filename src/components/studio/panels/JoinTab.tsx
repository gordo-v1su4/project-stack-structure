"use client";

import type { Dispatch, SetStateAction } from "react";
import { fmt, sv } from "../math";
import { SolidWaveform } from "../SolidWaveform";
import { VideoClip } from "../VideoClip";
import { WAVE_MAIN } from "../waveData";
import type { JoinClip } from "../types";

type JoinTabProps = {
  playhead: number;
  bpm: number;
  joinClips: JoinClip[];
  activeClip: number;
  onJoinClips: Dispatch<SetStateAction<JoinClip[]>>;
  onActiveClip: (i: number) => void;
};

export function JoinTab({
  playhead,
  bpm,
  joinClips,
  activeClip,
  onJoinClips,
  onActiveClip,
}: JoinTabProps) {
  const active = joinClips.filter((c) => c.on);
  const totalDur = active.reduce((a, c) => a + sv(c.id + 1) * 8 + 1, 0);

  return (
    <>
      <SolidWaveform
        points={WAVE_MAIN}
        playhead={playhead}
        bpm={bpm}
        totalBars={8}
        beatsPerBar={4}
        label="OUTPUT TIMELINE — CONCATENATED"
        height={100}
      />

      <div className="border border-[#1a1a1a] rounded-[2px] bg-[#080808] overflow-hidden">
        <div className="flex items-center gap-3 px-3 py-2 border-b border-[#181818] text-[10px]">
          <span className="uppercase tracking-[0.18em] text-[#404040]">Clip Queue</span>
          <span className="font-mono text-[#555]">
            {active.length} clips · <span className="text-[#e05c00]">{fmt(totalDur)}</span>
          </span>
        </div>
        <div className="relative h-12 flex">
          {active.map((c, i) => {
            const w = sv(c.id + 1) * 8 + 1;
            const total = active.reduce((a, cc) => a + sv(cc.id + 1) * 8 + 1, 0);
            return (
              <div
                key={c.id}
                className={`relative border-r border-[#0a0a0a] cursor-pointer ${
                  c.id === activeClip ? "bg-[#e05c0020]" : i % 2 === 0 ? "bg-[#0e0e0e]" : "bg-[#0b0b0b]"
                }`}
                style={{ width: `${(w / total) * 100}%` }}
                onClick={() => onActiveClip(c.id)}
              >
                {c.id === activeClip && <div className="absolute top-0 left-0 right-0 h-[2px] bg-[#e05c00]" />}
                <span className="absolute left-[2px] top-[3px] text-[7px] font-mono text-[#444]">C{c.id + 1}</span>
              </div>
            );
          })}
          <div className="absolute inset-y-0 w-[1px] bg-[#e05c00]" style={{ left: `${playhead * 100}%` }} />
        </div>
      </div>

      <div>
        <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-[#404040]">Clip Queue — click to toggle on/off</div>
        <div className="grid grid-cols-6 gap-2">
          {joinClips.map((c) => (
            <div
              key={c.id}
              className="relative"
              onClick={() => {
                onJoinClips((prev) => prev.map((cc) => (cc.id === c.id ? { ...cc, on: !cc.on } : cc)));
                onActiveClip(c.id);
              }}
            >
              <VideoClip idx={c.id} active={c.id === activeClip} mode="simple" />
              {!c.on && (
                <div className="absolute inset-0 bg-[#00000099] flex items-center justify-center rounded-[2px]">
                  <span className="text-[9px] font-mono text-[#383838]">SKIP</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
