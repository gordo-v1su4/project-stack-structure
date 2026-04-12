"use client";

import { useMemo } from "react";
import { lerp, sv } from "../math";
import { ParamSlider } from "../ParamSlider";
import { STUTTER_PRESETS } from "../remapPresets";
import type { StutterPresetDefinition } from "../remapPresets";
import type { BeatJoinAnalysis, BeatJoinSection, ShuffleMode } from "../types";

const ENERGY_BIN_COUNT = 32;
const MIN_THRESHOLD_GAP = 0.05;

const DEFAULT_EMPTY_SECTIONS: BeatJoinSection[] = [
  { label: "Intro", start: 0, end: 1 },
];

interface ArrangementSegment {
  id: number;
  clipId: number;
  start: number;
  end: number;
  duration: number;
  energy: number;
  detailLabel: string;
  tone: "low" | "mid" | "high";
}

interface CutCandidate {
  time: number;
  energy: number;
  amplitude: number;
  strength: number;
  source: "beat" | "onset" | "fft" | "section";
}

type BeatJoinTabProps = {
  playhead: number;
  minDur: number;
  maxDur: number;
  energyResp: number;
  chaos: number;
  onsetBoost: number;
  energyReactive: boolean;
  lowEnergyRange: number;
  highEnergyRange: number;
  analysis: BeatJoinAnalysis | null;
  audioPlayhead: number;
  clipOrder: number[];
  shuffleMode: ShuffleMode;
  isUsingCommittedSplit?: boolean;
  activeClip: number;
  onMinDur: (v: number) => void;
  onMaxDur: (v: number) => void;
  onEnergyResp: (v: number) => void;
  onChaos: (v: number) => void;
  onOnsetBoost: (v: number) => void;
  onEnergyReactive: (v: boolean) => void;
  onLowEnergyRange: (v: number) => void;
  onHighEnergyRange: (v: number) => void;
  analysisStatus: string;
  analysisError: string | null;
  isAnalyzing: boolean;
  onActiveClip: (i: number) => void;
};

export function BeatJoinTab({
  playhead,
  minDur,
  maxDur,
  energyResp,
  chaos,
  onsetBoost,
  energyReactive,
  lowEnergyRange,
  highEnergyRange,
  analysis,
  audioPlayhead,
  analysisStatus,
  analysisError,
  isAnalyzing,
  clipOrder,
  shuffleMode,
  isUsingCommittedSplit = false,
  activeClip,
  onMinDur,
  onMaxDur,
  onEnergyResp,
  onChaos,
  onOnsetBoost,
  onEnergyReactive,
  onLowEnergyRange,
  onHighEnergyRange,
  onActiveClip,
}: BeatJoinTabProps) {
  const hasAnalysis = analysis !== null;
  const duration = analysis?.duration ?? 0;
  const sections = analysis?.sections.length ? analysis.sections : DEFAULT_EMPTY_SECTIONS;
  const displayPlayhead = hasAnalysis ? audioPlayhead : playhead;
  const beatPositions = useMemo(
    () =>
      duration > 0
        ? (analysis?.beats ?? [])
            .map((time) => clamp(time / duration, 0, 1))
            .filter((position, index, all) => position >= 0 && position <= 1 && (index === 0 || Math.abs(position - all[index - 1]) > 0.001))
        : [],
    [analysis, duration]
  );
  const energyBins = useMemo(
    () => (hasAnalysis ? resampleSeries(analysis?.energy ?? [], ENERGY_BIN_COUNT) : []),
    [analysis, hasAnalysis]
  );
  const arrangementSegments = useMemo(
    () =>
      hasAnalysis && analysis
        ? buildArrangementSegments({
            analysis,
            clipOrder,
            minDur,
            maxDur,
            energyResp,
            energyReactive,
            lowEnergyRange,
            highEnergyRange,
            onsetBoost,
            chaos,
          })
        : [],
    [
      analysis,
      clipOrder,
      minDur,
      maxDur,
      energyResp,
      energyReactive,
      lowEnergyRange,
      highEnergyRange,
      onsetBoost,
      chaos,
      hasAnalysis,
    ]
  );
  const activePresetKey = STUTTER_PRESETS.find((preset) =>
    isStutterPresetActive(preset, {
      minDur,
      maxDur,
      energyResp,
      chaos,
      onsetBoost,
      lowEnergyRange,
      highEnergyRange,
      energyReactive,
    })
  )?.key;

  function applyStutterPreset(preset: StutterPresetDefinition) {
    onMinDur(preset.minDur);
    onMaxDur(preset.maxDur);
    onEnergyResp(preset.energyResp);
    onChaos(preset.chaos);
    onOnsetBoost(preset.onsetBoost);
    onLowEnergyRange(preset.lowEnergyRange);
    onHighEnergyRange(preset.highEnergyRange);
    onEnergyReactive(preset.energyReactive);
  }

  return (
    <>
      {!isUsingCommittedSplit ? (
        <div className="rounded-[2px] border border-[#3a220c] bg-[#120b06] px-3 py-2 text-[10px] uppercase tracking-[0.14em] text-[#d5a56a]">
          Commit Beat Split first so Beat Join reacts to the same working segment set as Shuffle and Join.
        </div>
      ) : null}

      <div className="border border-[#1a1a1a] rounded-[2px] bg-[#0c0c0c] overflow-hidden">
        <div className="flex items-center justify-between border-b border-[#181818] px-3 py-2">
          <span className="text-[10px] uppercase tracking-[0.2em] text-[#6f8287]">Stutter Cut Presets</span>
          <span className="font-mono text-[9px] text-[#40545a]">{STUTTER_PRESETS.length} working arrangements</span>
        </div>
        <div className="grid gap-1 p-2 md:grid-cols-2">
          {STUTTER_PRESETS.map((preset) => {
            const isActive = activePresetKey === preset.key;
            return (
              <button
                key={preset.key}
                type="button"
                onClick={() => applyStutterPreset(preset)}
                className={`grid grid-cols-[minmax(0,1fr)_86px] items-center gap-2 rounded-[2px] border px-2 py-[7px] text-left transition-colors ${
                  isActive
                    ? "border-[#e05c00] bg-[#e05c0012] shadow-[inset_0_0_0_1px_rgba(224,92,0,0.12)]"
                    : "border-[#1a1a1a] bg-[#090909] hover:border-[#2d3c40]"
                }`}
              >
                <div>
                  <div className={`text-[11px] font-medium ${isActive ? "text-[#e05c00]" : "text-[#8ca0a5]"}`}>
                    {preset.label}
                  </div>
                  <div className="text-[9px] text-[#4d5a5e]">{preset.detail}</div>
                </div>
                <div className="space-y-1">
                  <MiniLane values={preset.laneShape} active={isActive} />
                  <div className="text-right font-mono text-[9px] text-[#58656a]">{preset.densityLabel}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {!hasAnalysis ? (
        <div className="border border-[#1e1e1e] rounded-[2px] bg-[#070707] p-4">
          <div className="text-[10px] uppercase tracking-[0.18em] text-[#3a3a3a] mb-3">Beat Join Analysis</div>
          <div className="text-[13px] text-[#b0b0b0] mb-2">Upload the master song in the shared lane above.</div>
          <div className="text-[10px] uppercase tracking-[0.16em] text-[#555]">
            Beat Join unlocks its markers, section map, and reactive arrangement once Essentia finishes.
          </div>
          {isAnalyzing ? <div className="mt-3 text-[10px] font-mono text-[#727272]">{analysisStatus}</div> : null}
          {analysisError ? <div className="mt-2 text-[10px] text-[#b96c43]">{analysisError}</div> : null}
        </div>
      ) : null}

      <div className="border border-[#1a1a1a] rounded-[2px] bg-[#080808] overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-[#181818]">
          <span className="text-[10px] uppercase tracking-[0.18em] text-[#404040]">
            Arrangement · Stutter Envelope · {shuffleMode}
          </span>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-[#555]">{analysisStatus}</span>
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
        </div>

        {hasAnalysis ? (
          <div className="bg-[#060606] p-1 border-b border-[#161616] space-y-1">
            <div className="relative h-5 border border-[#121212] rounded-[2px] bg-[#090909] overflow-hidden">
              <MarkerGrid beatPositions={beatPositions} />
              {sections.map((section) => (
                <div
                  key={`${section.label}-${section.start}`}
                  className="absolute inset-y-0 border-l border-[#262626]"
                  style={{
                    left: `${duration > 0 ? (section.start / duration) * 100 : 0}%`,
                    width: `${duration > 0 ? ((section.end - section.start) / duration) * 100 : 0}%`,
                  }}
                >
                  <span className="absolute top-1/2 -translate-y-1/2 left-1 text-[9px] uppercase tracking-[0.14em] text-[#666]">
                    {abbreviateSectionLabel(section.label)}
                  </span>
                </div>
              ))}
            </div>

            <div className="relative h-11 border border-[#121212] rounded-[2px] bg-[#080808] overflow-hidden">
              <div className="absolute inset-0 flex">
                {energyBins.map((energy, index) => (
                  <div
                    key={`energy-${index}`}
                    className="relative flex-1 border-r border-[#0e0e0e] last:border-r-0"
                    style={{ background: getEnergyBandColor(energy, energyReactive, lowEnergyRange, highEnergyRange) }}
                  >
                    <div
                      className="absolute bottom-0 inset-x-[1px] rounded-t-[1px]"
                      style={{
                        height: `${Math.max(10, energy * 100)}%`,
                        background: getEnergyBarColor(energy, energyReactive, lowEnergyRange, highEnergyRange),
                      }}
                    />
                  </div>
                ))}
              </div>
              <MarkerGrid beatPositions={beatPositions} />
            </div>

            <div className="relative h-16 border border-[#121212] rounded-[2px] bg-[#090909] overflow-hidden">
              <div className="absolute inset-0 flex">
                {energyBins.map((energy, index) => (
                  <div
                    key={`zone-${index}`}
                    className="flex-1 border-r border-[#0d0d0d] last:border-r-0"
                    style={{ background: getCutZoneColor(energy, energyReactive, lowEnergyRange, highEnergyRange) }}
                  />
                ))}
              </div>

              {arrangementSegments.map((segment) => {
                const width = duration > 0 ? ((segment.end - segment.start) / duration) * 100 : 0;
                const left = duration > 0 ? (segment.start / duration) * 100 : 0;
                const isActive = segment.clipId === activeClip;
                return (
                  <button
                    key={segment.id}
                    type="button"
                    className={`absolute inset-y-1 rounded-[2px] border text-left cursor-pointer ${
                      isActive ? "border-[#e05c00] shadow-[0_0_0_1px_rgba(224,92,0,0.2)]" : "border-[#151515]"
                    }`}
                    style={{
                      left: `${left}%`,
                      width: `${width}%`,
                      background: getSegmentColor(segment, shuffleMode),
                      minWidth: 3,
                    }}
                    onClick={() => onActiveClip(segment.clipId)}
                  >
                    {width > 5 ? (
                      <>
                        <span className="absolute top-[2px] left-[3px] text-[8px] uppercase tracking-[0.12em] text-[#ffffff80]">
                          {segment.detailLabel}
                        </span>
                        <span className="absolute bottom-[2px] left-[3px] text-[7px] font-mono text-[#ffffff45]">
                          {segment.duration.toFixed(2)}s
                        </span>
                      </>
                    ) : null}
                  </button>
                );
              })}

              <MarkerGrid beatPositions={beatPositions} />
              <div className="absolute inset-y-0 w-[1px] bg-[#e05c00]" style={{ left: `${displayPlayhead * 100}%` }} />
            </div>
          </div>
        ) : (
          <div className="px-4 py-8 border-b border-[#161616] text-center">
            <div className="text-[12px] text-[#a0a0a0] mb-2">No arrangement yet.</div>
            <div className="text-[10px] uppercase tracking-[0.15em] text-[#555]">
              Upload a song and Beat Join will build the section map, waveform, and onset-driven cut plan from that track only.
            </div>
          </div>
        )}

        {hasAnalysis && analysisError ? (
          <div className="px-3 py-2 border-b border-[#161616] text-[10px] text-[#b96c43]">{analysisError}</div>
        ) : null}
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="border border-[#1a1a1a] rounded-[2px] bg-[#0c0c0c] p-3">
          <div className="mb-1 text-[10px] uppercase tracking-[0.2em] text-[#404040]">Duration Control</div>
          <ParamSlider label="Min Duration" value={minDur} min={0.05} max={1} step={0.01} unit="s" onChange={onMinDur} />
          <ParamSlider label="Max Duration" value={maxDur} min={0.1} max={3} step={0.05} unit="s" onChange={onMaxDur} />
          <ParamSlider label="Energy Response" value={energyResp} min={0.5} max={3} step={0.1} onChange={onEnergyResp} />
        </div>
        <div className="border border-[#1a1a1a] rounded-[2px] bg-[#0c0c0c] p-3">
          <div className="mb-1 text-[10px] uppercase tracking-[0.2em] text-[#404040]">Energy Window</div>
          <ParamSlider
            label="Low Energy"
            value={lowEnergyRange}
            min={0}
            max={Math.max(0, highEnergyRange - MIN_THRESHOLD_GAP)}
            step={0.01}
            onChange={onLowEnergyRange}
          />
          <ParamSlider
            label="High Energy"
            value={highEnergyRange}
            min={Math.min(1, lowEnergyRange + MIN_THRESHOLD_GAP)}
            max={1}
            step={0.01}
            onChange={onHighEnergyRange}
          />
          <div className="mt-2 text-[10px] uppercase tracking-[0.14em] text-[#555]">
            Grey zones hold. Orange zones unlock tighter onset and FFT-style detail.
          </div>
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

function buildArrangementSegments(params: {
  analysis: BeatJoinAnalysis;
  clipOrder: number[];
  minDur: number;
  maxDur: number;
  energyResp: number;
  energyReactive: boolean;
  lowEnergyRange: number;
  highEnergyRange: number;
  onsetBoost: number;
  chaos: number;
}): ArrangementSegment[] {
  const {
    analysis,
    clipOrder,
    minDur,
    maxDur,
    energyResp,
    energyReactive,
    lowEnergyRange,
    highEnergyRange,
    onsetBoost,
    chaos,
  } = params;

  const duration = Math.max(analysis.duration, 0.001);
  const beatTimes = uniqueSortedTimes(analysis.beats, duration);
  const rawOnsets = uniqueSortedTimes(analysis.onsets, duration);
  const beatInterval = medianInterval(beatTimes) || Math.max(0.18, duration / 32);
  const fftRiseMarkers = buildOfflineFftMarkers(analysis.energy, duration);
  const waveform = analysis.waveform.length ? analysis.waveform : analysis.energy;
  const onsets = rawOnsets.filter(
    (time) => !beatTimes.some((beat) => Math.abs(beat - time) < Math.max(beatInterval * 0.12, 0.04))
  );

  const candidates: CutCandidate[] = [
    ...beatTimes.map((time) => createCandidate("beat", time, analysis.energy, waveform, duration, 0.86)),
    ...onsets.map((time) => createCandidate("onset", time, analysis.energy, waveform, duration, 1 + onsetBoost * 0.25)),
    ...fftRiseMarkers.map((time) => createCandidate("fft", time, analysis.energy, waveform, duration, 0.94)),
    ...analysis.sections
      .slice(1)
      .map((section) => createCandidate("section", clamp(section.start, 0, duration), analysis.energy, waveform, duration, 1.2)),
  ]
    .sort((left, right) => left.time - right.time)
    .filter((candidate, index, all) => index === 0 || Math.abs(candidate.time - all[index - 1].time) > 0.015);

  const acceptedCuts = [0];
  let lastCut = 0;

  for (const candidate of candidates) {
    if (candidate.time <= 0.02 || candidate.time >= duration - 0.02) continue;

    const normalized = energyReactive
      ? clamp((candidate.energy - lowEnergyRange) / Math.max(0.001, highEnergyRange - lowEnergyRange), 0, 1)
      : 0.5;
    const response = energyReactive ? clamp(Math.pow(normalized, 1 / Math.max(0.5, energyResp)), 0, 1) : 0.5;
    const lowZone = energyReactive && candidate.energy < lowEnergyRange;
    const highZone = energyReactive && candidate.energy >= highEnergyRange;
    const variation = lerp(0.88, 1.12, sv(candidate.time * 7.1 + chaos * 11.3));

    if (lowZone && candidate.source !== "beat" && candidate.source !== "section") continue;
    if (!highZone && candidate.source === "fft" && normalized < 0.46) continue;

    const dynamicMinSpacing = lowZone
      ? Math.max(maxDur * 0.92, beatInterval * 1.05)
      : highZone
        ? Math.max(minDur * 0.5, beatInterval * lerp(0.42, 0.18, Math.min(1, response + onsetBoost * 0.28)))
        : Math.max(minDur * 0.8, Math.min(maxDur * 0.94, beatInterval * lerp(0.9, 0.58, response)));

    if (candidate.time - lastCut < dynamicMinSpacing * variation) continue;

    const sourceLift =
      candidate.source === "section" ? 0.55 : candidate.source === "onset" ? 0.26 : candidate.source === "fft" ? 0.21 : 0.12;
    const keepScore =
      candidate.strength +
      candidate.amplitude * 0.85 +
      response * 0.65 +
      sourceLift +
      (chaos - 0.5) * (sv(candidate.time * 3.9) - 0.5) * 0.3;
    const required = candidate.source === "section" ? 0 : lowZone ? 1.38 : highZone ? 1.02 : 1.18;

    if (keepScore < required) continue;

    acceptedCuts.push(candidate.time);
    lastCut = candidate.time;
  }

  const cutTimes = acceptedCuts
    .concat(duration)
    .sort((left, right) => left - right)
    .filter((time, index, all) => index === 0 || time - all[index - 1] > 0.03);
  const sequence = clipOrder.length ? clipOrder : [0];

  return cutTimes.slice(0, -1).map((start, index) => {
    const end = cutTimes[index + 1] ?? duration;
    const segmentDuration = Math.max(0.03, end - start);
    const averageEnergy = averageEnergyBetween(analysis.energy, duration, start, end);
    const tone = classifyEnergyTone(averageEnergy, lowEnergyRange, highEnergyRange, energyReactive);
    const clipId = sequence[index % sequence.length] ?? 0;

    return {
      id: index,
      clipId,
      start,
      end,
      duration: segmentDuration,
      energy: averageEnergy,
      detailLabel: `C${String(clipId + 1).padStart(2, "0")} · ${tone === "high" ? "RUSH" : tone === "mid" ? "CUT" : "HOLD"}`,
      tone,
    };
  });
}

function isStutterPresetActive(
  preset: StutterPresetDefinition,
  current: Pick<
    StutterPresetDefinition,
    | "minDur"
    | "maxDur"
    | "energyResp"
    | "chaos"
    | "onsetBoost"
    | "lowEnergyRange"
    | "highEnergyRange"
    | "energyReactive"
  >
) {
  return (
    current.energyReactive === preset.energyReactive &&
    nearlyEqual(current.minDur, preset.minDur, 0.005) &&
    nearlyEqual(current.maxDur, preset.maxDur, 0.005) &&
    nearlyEqual(current.energyResp, preset.energyResp, 0.025) &&
    nearlyEqual(current.chaos, preset.chaos, 0.005) &&
    nearlyEqual(current.onsetBoost, preset.onsetBoost, 0.005) &&
    nearlyEqual(current.lowEnergyRange, preset.lowEnergyRange, 0.005) &&
    nearlyEqual(current.highEnergyRange, preset.highEnergyRange, 0.005)
  );
}

function nearlyEqual(left: number, right: number, epsilon: number) {
  return Math.abs(left - right) <= epsilon;
}

function MiniLane({ values, active }: { values: number[]; active: boolean }) {
  return (
    <div className="flex h-5 items-end gap-[2px] rounded-[1px] bg-[#071014] px-[3px] pb-[3px]">
      {values.map((value, index) => (
        <span
          key={`${value}-${index}`}
          className="flex-1 rounded-t-[1px]"
          style={{
            height: `${Math.max(18, value * 100)}%`,
            background: active ? "#e05c00" : index % 2 === 0 ? "#6f8287" : "#40545a",
            opacity: active ? 1 : 0.72,
          }}
        />
      ))}
    </div>
  );
}

function createCandidate(
  source: CutCandidate["source"],
  time: number,
  energy: number[],
  waveform: number[],
  duration: number,
  strength: number
): CutCandidate {
  return {
    time,
    energy: energyAtTime(energy, duration, time),
    amplitude: amplitudeAtTime(waveform, duration, time),
    strength,
    source,
  };
}

function buildOfflineFftMarkers(energy: number[], duration: number) {
  if (!energy.length || duration <= 0) return [];

  const markers: number[] = [];
  let previous = energy[0] ?? 0;
  let cooldown = 0;

  for (let index = 1; index < energy.length; index += 1) {
    const current = energy[index] ?? 0;
    const diff = current - previous;
    previous = current;

    if (cooldown > 0) {
      cooldown -= 1;
      continue;
    }

    const historyStart = Math.max(0, index - 6);
    const history = energy.slice(historyStart, index);
    const localMean = history.reduce((sum, value) => sum + value, 0) / Math.max(1, history.length);

    if (diff > 0.08 && current > Math.max(0.12, localMean + 0.05)) {
      markers.push((index / Math.max(energy.length - 1, 1)) * duration);
      cooldown = 2;
    }
  }

  return markers;
}

function resampleSeries(points: number[], targetCount: number) {
  if (!points.length) return [];
  if (points.length === targetCount) return points.map((point) => clamp(point, 0, 1));

  return Array.from({ length: targetCount }, (_, index) => {
    const start = Math.floor((index / targetCount) * points.length);
    const end = Math.max(start + 1, Math.floor(((index + 1) / targetCount) * points.length));
    const slice = points.slice(start, end);
    const avg = slice.reduce((sum, value) => sum + value, 0) / Math.max(1, slice.length);
    return clamp(avg, 0, 1);
  });
}

function amplitudeAtTime(waveform: number[], duration: number, time: number) {
  if (!waveform.length || duration <= 0) return 0;
  const index = clamp(Math.floor((time / duration) * (waveform.length - 1)), 0, waveform.length - 1);
  return clamp(waveform[index] ?? 0, 0, 1);
}

function energyAtTime(energy: number[], duration: number, time: number) {
  if (!energy.length || duration <= 0) return 0;
  const index = clamp(Math.floor((time / duration) * (energy.length - 1)), 0, energy.length - 1);
  return clamp(energy[index] ?? 0, 0, 1);
}

function averageEnergyBetween(energy: number[], duration: number, start: number, end: number) {
  if (!energy.length || duration <= 0) return 0;

  const startIndex = clamp(Math.floor((start / duration) * (energy.length - 1)), 0, energy.length - 1);
  const endIndex = clamp(Math.max(startIndex + 1, Math.ceil((end / duration) * (energy.length - 1))), 0, energy.length);
  const slice = energy.slice(startIndex, endIndex);
  return slice.reduce((sum, value) => sum + value, 0) / Math.max(1, slice.length);
}

function uniqueSortedTimes(values: number[], duration: number) {
  return values
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= duration)
    .sort((left, right) => left - right)
    .filter((time, index, all) => index === 0 || Math.abs(time - all[index - 1]) > 0.015);
}

function medianInterval(values: number[]) {
  if (values.length < 2) return null;

  const intervals = values
    .slice(1)
    .map((time, index) => time - values[index])
    .filter((interval) => interval > 0.02);

  if (!intervals.length) return null;
  const sorted = [...intervals].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
}

function classifyEnergyTone(
  energy: number,
  lowEnergyRange: number,
  highEnergyRange: number,
  energyReactive: boolean
): ArrangementSegment["tone"] {
  if (!energyReactive) return "mid";
  if (energy < lowEnergyRange) return "low";
  if (energy >= highEnergyRange) return "high";
  return "mid";
}

function abbreviateSectionLabel(label: string) {
  const normalized = label.trim().toLowerCase();
  if (!normalized) return "S";
  if (normalized.startsWith("intro")) return "I";
  if (normalized.startsWith("verse")) {
    const match = normalized.match(/\d+/);
    return match ? `V${match[0]}` : "V";
  }
  if (normalized.startsWith("chorus")) return "Ch";
  if (normalized.startsWith("bridge")) return "Br";
  if (normalized.startsWith("outro")) return "O";
  if (normalized.startsWith("drop")) return "Dr";
  return label.slice(0, 3);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getEnergyBarColor(energy: number, isReactive: boolean, lowEnergyRange: number, highEnergyRange: number) {
  if (!isReactive) return "#2d2d2d";
  if (energy >= highEnergyRange) return "#ef7600";
  if (energy <= lowEnergyRange) return "#4a4a4a";
  return "#b85a0e";
}

function getEnergyBandColor(energy: number, isReactive: boolean, lowEnergyRange: number, highEnergyRange: number) {
  if (!isReactive) return "#090909";
  if (energy >= highEnergyRange) return "#1d1206";
  if (energy <= lowEnergyRange) return "#0b0b0b";
  return "#130d08";
}

function getCutZoneColor(energy: number, isReactive: boolean, lowEnergyRange: number, highEnergyRange: number) {
  if (!isReactive) return "#0a0a0a";
  if (energy >= highEnergyRange) return "#140d06";
  if (energy <= lowEnergyRange) return "#090909";
  return "#0f0b08";
}

function getSegmentColor(segment: ArrangementSegment, shuffleMode: ShuffleMode) {
  const clipSeed = sv((segment.clipId + 1) * 7.13 + segment.start * 0.37);
  const modeBoost = shuffleMode === "motion" ? 1 : shuffleMode === "color" ? 0.82 : shuffleMode === "size" ? 0.72 : 0.64;
  const alpha = lerp(0.14, 0.32, clipSeed * modeBoost);

  if (segment.tone === "low") {
    return `linear-gradient(180deg, rgba(34, 34, 34, ${0.78 + alpha * 0.3}) 0%, rgba(14, 14, 14, 0.96) 100%)`;
  }

  if (segment.tone === "high") {
    return `linear-gradient(180deg, rgba(235, 116, 18, ${0.78 + alpha}) 0%, rgba(122, 48, 0, 0.96) 100%)`;
  }

  return `linear-gradient(180deg, rgba(126, 65, 16, ${0.72 + alpha * 0.7}) 0%, rgba(48, 25, 10, 0.96) 100%)`;
}

function MarkerGrid({ beatPositions }: { beatPositions: number[] }) {
  return (
    <div className="absolute inset-0 pointer-events-none">
      {beatPositions.map((position, index) => (
        <div
          key={`beat-${position}-${index}`}
          className="absolute inset-y-0"
          style={{
            left: `${position * 100}%`,
            width: 1,
            background: index % 4 === 0 ? "#2a2a2a" : "#171717",
          }}
        />
      ))}
    </div>
  );
}
