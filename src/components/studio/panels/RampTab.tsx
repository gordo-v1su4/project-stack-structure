"use client";

import { ParamSlider } from "../ParamSlider";
import { SolidWaveform } from "../SolidWaveform";
import { SpeedCurve } from "../SpeedCurve";
import { WAVE_MAIN } from "../waveData";
import type { RampPreset } from "../types";

type RampTabProps = {
  playhead: number;
  bpm: number;
  rampPreset: RampPreset;
  minSpeed: number;
  maxSpeed: number;
  rampDur: number;
  energyThresh: number;
  buildBoost: number;
  dropSlowdown: number;
  onRampPreset: (p: RampPreset) => void;
  onMinSpeed: (v: number) => void;
  onMaxSpeed: (v: number) => void;
  onRampDur: (v: number) => void;
  onEnergyThresh: (v: number) => void;
  onBuildBoost: (v: number) => void;
  onDropSlowdown: (v: number) => void;
};

const RAMP_META: Record<RampPreset, [string, string]> = {
  subtle: ["0.8–1.2×", "Professional, minor"],
  dynamic: ["0.5–2.0×", "Music video style"],
  extreme: ["0.25–4×", "Action / maximum"],
  cinematic: ["0.5–1.5×", "Smooth, emotional"],
};

export function RampTab({
  playhead,
  bpm,
  rampPreset,
  minSpeed,
  maxSpeed,
  rampDur,
  energyThresh,
  buildBoost,
  dropSlowdown,
  onRampPreset,
  onMinSpeed,
  onMaxSpeed,
  onRampDur,
  onEnergyThresh,
  onBuildBoost,
  onDropSlowdown,
}: RampTabProps) {
  return (
    <>
      <SolidWaveform
        points={WAVE_MAIN}
        playhead={playhead}
        bpm={bpm}
        totalBars={8}
        beatsPerBar={4}
        label="SOURCE VIDEO · CLIP_001.MP4"
        height={100}
      />

      <div className="border border-[#1a1a1a] rounded-[2px] bg-[#0c0c0c]">
        <div className="flex items-center justify-between px-3 py-2 border-b border-[#181818]">
          <span className="text-[10px] uppercase tracking-[0.2em] text-[#404040]">Speed Envelope — drag nodes</span>
          <span className="text-[10px] font-mono text-[#e05c00] uppercase">{rampPreset}</span>
        </div>
        <div className="p-2">
          <SpeedCurve key={rampPreset} minSpeed={minSpeed} maxSpeed={maxSpeed} preset={rampPreset} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="border border-[#1a1a1a] rounded-[2px] bg-[#0c0c0c] p-3">
          <div className="mb-1 text-[10px] uppercase tracking-[0.2em] text-[#404040]">Parameters</div>
          <ParamSlider label="Min Speed" value={minSpeed} min={0.1} max={1} step={0.05} unit="×" onChange={onMinSpeed} />
          <ParamSlider label="Max Speed" value={maxSpeed} min={1} max={8} step={0.1} unit="×" onChange={onMaxSpeed} />
          <ParamSlider label="Ramp Duration" value={rampDur} min={0.1} max={2} step={0.05} unit="s" onChange={onRampDur} />
          <ParamSlider label="Energy Thresh" value={energyThresh} min={0} max={1} step={0.01} onChange={onEnergyThresh} />
          <ParamSlider label="Buildup Boost" value={buildBoost} min={1} max={3} step={0.05} unit="×" onChange={onBuildBoost} />
          <ParamSlider label="Drop Slowdown" value={dropSlowdown} min={0.1} max={1} step={0.05} unit="×" onChange={onDropSlowdown} />
        </div>
        <div className="border border-[#1a1a1a] rounded-[2px] bg-[#0c0c0c] p-3">
          <div className="mb-1 text-[10px] uppercase tracking-[0.2em] text-[#404040]">Preset</div>
          {(["subtle", "dynamic", "extreme", "cinematic"] as RampPreset[]).map((p) => {
            const meta = RAMP_META[p];
            return (
              <button
                key={p}
                type="button"
                onClick={() => onRampPreset(p)}
                className={`flex w-full items-center justify-between px-2 py-[7px] mb-1 border rounded-[2px] text-left transition-colors ${
                  rampPreset === p
                    ? "border-[#e05c00] bg-[#e05c0012]"
                    : "border-[#1a1a1a] bg-[#090909] hover:border-[#272727]"
                }`}
              >
                <div>
                  <div className={`text-[12px] capitalize font-medium ${rampPreset === p ? "text-[#e05c00]" : "text-[#777]"}`}>
                    {p}
                  </div>
                  <div className="text-[10px] text-[#404040]">{meta[1]}</div>
                </div>
                <span className="font-mono text-[10px] text-[#484848]">{meta[0]}</span>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
