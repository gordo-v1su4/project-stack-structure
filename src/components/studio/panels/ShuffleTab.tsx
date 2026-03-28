"use client";

import { sv } from "../math";
import { getClipPalette } from "../palette";
import { ParamSlider } from "../ParamSlider";
import { SolidWaveform } from "../SolidWaveform";
import { VideoClip } from "../VideoClip";
import { WAVE_MAIN } from "../waveData";
import type { ColorGradient, ShuffleMode } from "../types";

const GRADIENT_COLORS: Record<ColorGradient, string[]> = {
  Rainbow: ["#e03030", "#e07030", "#d0d030", "#30c030", "#3080e0", "#8030c0"],
  Sunset: ["#e04020", "#e06030", "#d08040", "#c07060", "#a05080", "#603090"],
  Ocean: ["#20a0d0", "#2080c0", "#1860a0", "#104080", "#082060", "#041030"],
};

type ShuffleTabProps = {
  playhead: number;
  bpm: number;
  shuffleMode: ShuffleMode;
  minScore: number;
  lookahead: number;
  keepPct: number;
  colorGradient: ColorGradient;
  activeClip: number;
  onShuffleMode: (m: ShuffleMode) => void;
  onMinScore: (v: number) => void;
  onLookahead: (v: number) => void;
  onKeepPct: (v: number) => void;
  onColorGradient: (g: ColorGradient) => void;
  onActiveClip: (i: number) => void;
};

export function ShuffleTab({
  playhead,
  bpm,
  shuffleMode,
  minScore,
  lookahead,
  keepPct,
  colorGradient,
  activeClip,
  onShuffleMode,
  onMinScore,
  onLookahead,
  onKeepPct,
  onColorGradient,
  onActiveClip,
}: ShuffleTabProps) {
  return (
    <>
      <SolidWaveform
        points={WAVE_MAIN}
        playhead={playhead}
        bpm={bpm}
        totalBars={8}
        beatsPerBar={4}
        label="SOURCE · 12 CLIPS LOADED"
        height={90}
      />

      <div className="grid grid-cols-4 gap-2">
        {(["simple", "size", "color", "motion"] as ShuffleMode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => onShuffleMode(m)}
            className={`border rounded-[2px] py-[6px] text-[11px] uppercase tracking-[0.14em] font-medium transition-colors ${
              shuffleMode === m
                ? "border-[#e05c00] bg-[#e05c0012] text-[#e05c00]"
                : "border-[#1a1a1a] bg-[#0c0c0c] text-[#484848] hover:border-[#272727] hover:text-[#777]"
            }`}
          >
            {m === "simple" ? "Simple" : m === "size" ? "Size Reward" : m === "color" ? "Color Sort" : "Motion Eye"}
          </button>
        ))}
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] uppercase tracking-[0.18em] text-[#404040]">
            Input Clips — 12 segments
            {shuffleMode === "color" && <span className="ml-2 text-[#e05c0088]">· color palette tags</span>}
            {shuffleMode === "motion" && <span className="ml-2 text-[#e05c0088]">· motion direction tagged</span>}
          </span>
          {shuffleMode === "color" && (
            <div className="flex gap-1">
              {(["Rainbow", "Sunset", "Ocean"] as const).map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => onColorGradient(g)}
                  className={`text-[9px] px-2 py-[2px] border rounded-[2px] transition-colors ${
                    colorGradient === g
                      ? "border-[#e05c00] text-[#e05c00]"
                      : "border-[#1e1e1e] text-[#444] hover:border-[#2a2a2a]"
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>
          )}
        </div>

        {shuffleMode === "color" && (
          <div className="mb-2 border border-[#1a1a1a] rounded-[2px] bg-[#080808] overflow-hidden">
            <div className="px-2 py-[4px] text-[9px] uppercase tracking-[0.18em] text-[#383838] border-b border-[#161616]">
              Gradient Sort Order — {colorGradient}
            </div>
            <div className="flex h-8">
              {GRADIENT_COLORS[colorGradient].map((c, i) => (
                <div key={i} className="flex-1 flex items-center justify-center" style={{ background: c }}>
                  <span className="text-[7px] font-mono text-[#ffffff66]">{i + 1}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-6 gap-2">
          {Array.from({ length: 12 }, (_, i) => (
            <VideoClip
              key={i}
              idx={i}
              active={i === activeClip}
              mode={shuffleMode}
              showColorBars={shuffleMode === "color"}
              matchScore={0.4 + sv(i * 3 + activeClip * 0.7) * 0.55}
              onClick={() => onActiveClip(i)}
            />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="border border-[#1a1a1a] rounded-[2px] bg-[#0c0c0c] p-3">
          <div className="mb-1 text-[10px] uppercase tracking-[0.2em] text-[#404040]">
            {shuffleMode === "motion"
              ? "Motion Analysis"
              : shuffleMode === "size"
                ? "Size Reward"
                : shuffleMode === "color"
                  ? "Color Matching"
                  : "Shuffle Options"}
          </div>
          {shuffleMode === "motion" && (
            <>
              <ParamSlider label="Min Score" value={minScore} min={0} max={1} step={0.01} onChange={onMinScore} />
              <ParamSlider label="Lookahead" value={lookahead} min={1} max={5} step={1} onChange={onLookahead} />
            </>
          )}
          {shuffleMode === "size" && (
            <ParamSlider label="Keep %" value={keepPct} min={10} max={100} step={5} unit="%" onChange={onKeepPct} />
          )}
          {shuffleMode === "color" && (
            <div className="space-y-[4px] text-[10px]">
              {[
                ["Match threshold", "0.62"],
                ["Sort mode", "Gradient"],
                ["Direction", "Forward"],
                ["Transition", "Smooth"],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between border-b border-[#141414] pb-1">
                  <span className="text-[#454545]">{k}</span>
                  <span className="font-mono text-[#e05c00]">{v}</span>
                </div>
              ))}
            </div>
          )}
          {shuffleMode === "simple" && (
            <div className="text-[11px] text-[#454545] mt-1">Random order with hex-based naming. No analysis required.</div>
          )}
        </div>

        <div className="border border-[#1a1a1a] rounded-[2px] bg-[#0c0c0c] p-3">
          <div className="mb-2 text-[10px] uppercase tracking-[0.2em] text-[#404040]">
            {shuffleMode === "color"
              ? "Color Match Scores"
              : shuffleMode === "motion"
                ? "Motion Transition Scores"
                : "Clip Scores"}
          </div>
          <div className="space-y-[4px]">
            {Array.from({ length: 6 }, (_, i) => {
              const score = 0.4 + sv(i * 3 + activeClip) * 0.55;
              const good = score > minScore;
              const startPalette = getClipPalette(i);
              const endPalette = getClipPalette(i + 1);
              return (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-14 text-[9px] font-mono text-[#383838]">
                    C{i + 1}→C{i + 2}
                  </span>
                  {shuffleMode === "color" && (
                    <>
                      <div className="flex gap-px">
                        {startPalette.slice(0, 2).map((c, j) => (
                          <div key={j} className="w-3 h-3 rounded-[1px]" style={{ background: c }} />
                        ))}
                      </div>
                      <div className="flex-1 h-[3px] bg-[#141414] rounded-full">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${score * 100}%`, background: good ? "#e05c00" : "#252525" }}
                        />
                      </div>
                      <div className="flex gap-px">
                        {endPalette.slice(0, 2).map((c, j) => (
                          <div key={j} className="w-3 h-3 rounded-[1px]" style={{ background: c }} />
                        ))}
                      </div>
                    </>
                  )}
                  {shuffleMode !== "color" && (
                    <div className="flex-1 h-[3px] bg-[#141414] rounded-full">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${score * 100}%`, background: good ? "#e05c00" : "#252525" }}
                      />
                    </div>
                  )}
                  <span className={`w-8 text-right text-[9px] font-mono ${good ? "text-[#e05c00]" : "text-[#2e2e2e]"}`}>
                    {score.toFixed(2)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
