"use client";

import { sv } from "../math";
import { ParamSlider } from "../ParamSlider";
import { SolidWaveform } from "../SolidWaveform";
import { WAVE_AUDIO } from "../waveData";

type BeatJoinTabProps = {
  playhead: number;
  bpm: number;
  minDur: number;
  maxDur: number;
  energyResp: number;
  chaos: number;
  onsetBoost: number;
  energyReactive: boolean;
  activeClip: number;
  onMinDur: (v: number) => void;
  onMaxDur: (v: number) => void;
  onEnergyResp: (v: number) => void;
  onChaos: (v: number) => void;
  onOnsetBoost: (v: number) => void;
  onEnergyReactive: (v: boolean) => void;
  onActiveClip: (i: number) => void;
};

export function BeatJoinTab({
  playhead,
  bpm,
  minDur,
  maxDur,
  energyResp,
  chaos,
  onsetBoost,
  energyReactive,
  activeClip,
  onMinDur,
  onMaxDur,
  onEnergyResp,
  onChaos,
  onOnsetBoost,
  onEnergyReactive,
  onActiveClip,
}: BeatJoinTabProps) {
  return (
    <>
      <SolidWaveform
        points={WAVE_AUDIO}
        playhead={playhead}
        bpm={bpm}
        totalBars={8}
        beatsPerBar={4}
        accent="#c8900a"
        label="AUDIO TRACK · TRACK_01.WAV — MASTER TIMELINE"
        height={110}
      />

      <div className="border border-[#1a1a1a] rounded-[2px] bg-[#080808] overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-[#181818]">
          <span className="text-[10px] uppercase tracking-[0.18em] text-[#404040]">Arrangement · Energy Reactive</span>
          <button
            type="button"
            onClick={() => onEnergyReactive(!energyReactive)}
            className={`text-[10px] uppercase tracking-[0.12em] px-2 py-[2px] border rounded-[2px] ${
              energyReactive
                ? "border-[#e05c00] text-[#e05c00] bg-[#e05c0012]"
                : "border-[#1e1e1e] text-[#484848]"
            }`}
          >
            {energyReactive ? "ON" : "OFF"}
          </button>
        </div>

        <div className="flex h-10 border-b border-[#161616] items-end gap-px px-1 pt-1 bg-[#060606]">
          {Array.from({ length: 32 }, (_, i) => {
            const waveIdx = Math.floor((i / 32) * WAVE_AUDIO.length);
            const e = WAVE_AUDIO[waveIdx] ?? sv(i * 3 + 1);
            const isHigh = e > 0.6;
            return (
              <div
                key={i}
                className="flex-1 rounded-t-[1px]"
                style={{
                  height: `${e * 100}%`,
                  background: isHigh ? "#e05c00" : energyReactive ? "#2e2e2e" : "#1e1e1e",
                }}
              />
            );
          })}
        </div>

        <div className="relative h-14 flex items-stretch px-1 gap-px py-1 bg-[#090909]">
          {Array.from({ length: 24 }, (_, i) => {
            const waveIdx = Math.floor((i / 24) * WAVE_AUDIO.length);
            const e = WAVE_AUDIO[waveIdx] ?? sv(i * 3 + 1);
            const dur = energyReactive ? minDur + (1 - e) * (maxDur - minDur) : (minDur + maxDur) / 2;
            const totalDur = 24 * ((minDur + maxDur) / 2);
            const widthPct = (dur / totalDur) * 100;
            const lightness = energyReactive ? 8 + e * 20 : 14;
            return (
              <div
                key={i}
                className={`relative border border-[#161616] cursor-pointer rounded-[1px] ${i === activeClip ? "border-[#e05c00]" : ""}`}
                style={{ width: `${widthPct}%`, background: `hsl(25 70% ${lightness}%)`, minWidth: 2 }}
                onClick={() => onActiveClip(i)}
              >
                <span className="absolute bottom-[1px] left-[1px] text-[6px] font-mono text-[#ffffff33]">
                  {dur.toFixed(2)}
                </span>
              </div>
            );
          })}
          <div className="absolute inset-y-0 w-[1px] bg-[#e05c00]" style={{ left: `${playhead * 100}%` }} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="border border-[#1a1a1a] rounded-[2px] bg-[#0c0c0c] p-3">
          <div className="mb-1 text-[10px] uppercase tracking-[0.2em] text-[#404040]">Duration Control</div>
          <ParamSlider label="Min Duration" value={minDur} min={0.05} max={1} step={0.01} unit="s" onChange={onMinDur} />
          <ParamSlider label="Max Duration" value={maxDur} min={0.1} max={3} step={0.05} unit="s" onChange={onMaxDur} />
          <ParamSlider label="Energy Response" value={energyResp} min={0.5} max={3} step={0.1} onChange={onEnergyResp} />
        </div>
        <div className="border border-[#1a1a1a] rounded-[2px] bg-[#0c0c0c] p-3">
          <div className="mb-1 text-[10px] uppercase tracking-[0.2em] text-[#404040]">Variation</div>
          <ParamSlider label="Chaos" value={chaos} min={0} max={1} step={0.01} onChange={onChaos} />
          <ParamSlider label="Onset Boost" value={onsetBoost} min={0} max={1} step={0.01} onChange={onOnsetBoost} />
        </div>
      </div>
    </>
  );
}
