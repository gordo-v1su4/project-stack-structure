"use client";

import { startTransition, useMemo, useState } from "react";
import { lerp, sv } from "../math";
import { ParamSlider } from "../ParamSlider";
import { SolidWaveform } from "../SolidWaveform";
import { WAVE_AUDIO } from "../waveData";

const TOTAL_BEATS = 32;
const MIN_THRESHOLD_GAP = 0.05;

const DEFAULT_SECTION_MARKERS = [
  { label: "I", start: 0, end: 4 },
  { label: "V1", start: 4, end: 12 },
  { label: "Ch", start: 12, end: 16 },
  { label: "V2", start: 16, end: 24 },
  { label: "Br", start: 24, end: 28 },
  { label: "O", start: 28, end: 32 },
] satisfies SectionMarker[];

interface SectionMarker {
  label: string;
  start: number;
  end: number;
}

interface ArrangementSegment {
  id: number;
  start: number;
  span: number;
  energy: number;
  duration: number;
  detailLabel: string;
  tone: "low" | "mid" | "high";
}

interface AudioAnalysis {
  sourceLabel: string;
  waveform: number[];
  energy: number[];
  sections: SectionMarker[];
}

type BeatJoinTabProps = {
  playhead: number;
  bpm: number;
  minDur: number;
  maxDur: number;
  energyResp: number;
  chaos: number;
  onsetBoost: number;
  energyReactive: boolean;
  lowEnergyRange: number;
  highEnergyRange: number;
  activeClip: number;
  onMinDur: (v: number) => void;
  onMaxDur: (v: number) => void;
  onEnergyResp: (v: number) => void;
  onChaos: (v: number) => void;
  onOnsetBoost: (v: number) => void;
  onEnergyReactive: (v: boolean) => void;
  onLowEnergyRange: (v: number) => void;
  onHighEnergyRange: (v: number) => void;
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
  lowEnergyRange,
  highEnergyRange,
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
  const [analysis, setAnalysis] = useState<AudioAnalysis | null>(null);
  const [analysisStatus, setAnalysisStatus] = useState("Synthetic guide");
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const waveformPoints = analysis?.waveform.length ? analysis.waveform : WAVE_AUDIO;
  const beatEnergy = useMemo(
    () => resampleSeries(analysis?.energy.length ? analysis.energy : waveformPoints, TOTAL_BEATS),
    [analysis, waveformPoints]
  );
  const sections = analysis?.sections.length ? analysis.sections : DEFAULT_SECTION_MARKERS;
  const arrangementSegments = useMemo(
    () =>
      buildArrangementSegments({
        beatEnergy,
        minDur,
        maxDur,
        energyResp,
        energyReactive,
        lowEnergyRange,
        highEnergyRange,
        onsetBoost,
        chaos,
      }),
    [beatEnergy, minDur, maxDur, energyResp, energyReactive, lowEnergyRange, highEnergyRange, onsetBoost, chaos]
  );

  async function handleAudioUpload(file: File | null) {
    if (!file) return;

    setAnalysisError(null);
    setAnalysisStatus(`Analyzing ${file.name}...`);
    setIsAnalyzing(true);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/essentia/full", {
        method: "POST",
        body: formData,
      });

      const payload = (await response.json()) as unknown;

      if (!response.ok) {
        const message =
          payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
            ? payload.error
            : `Analysis failed with ${response.status}`;
        throw new Error(message);
      }

      const parsed = parseEssentiaPayload(payload, file.name);

      if (!parsed) {
        throw new Error("No usable energy or section data came back from the analysis endpoint.");
      }

      startTransition(() => {
        setAnalysis(parsed);
        setAnalysisStatus(`Live analysis · ${parsed.sourceLabel}`);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown analysis error";
      setAnalysisError(message);
      setAnalysisStatus("Synthetic guide");
    } finally {
      setIsAnalyzing(false);
    }
  }

  return (
    <>
      <SolidWaveform
        points={waveformPoints}
        playhead={playhead}
        bpm={bpm}
        totalBars={8}
        beatsPerBar={4}
        accent="#c8900a"
        label={analysis ? `AUDIO TRACK · ${analysis.sourceLabel} — MASTER TIMELINE` : "AUDIO TRACK · TRACK_01.WAV — MASTER TIMELINE"}
        height={110}
      />

      <div className="border border-[#1a1a1a] rounded-[2px] bg-[#080808] overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-[#181818]">
          <span className="text-[10px] uppercase tracking-[0.18em] text-[#404040]">Arrangement · Energy Reactive</span>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-[#555]">{analysisStatus}</span>
            <label
              className={`text-[10px] uppercase tracking-[0.12em] px-2 py-[2px] border rounded-[2px] cursor-pointer ${
                isAnalyzing ? "border-[#404040] text-[#707070]" : "border-[#1e1e1e] text-[#a0a0a0] hover:border-[#2f2f2f]"
              }`}
            >
              Upload Audio
              <input
                type="file"
                accept="audio/*"
                className="hidden"
                disabled={isAnalyzing}
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  void handleAudioUpload(file);
                  event.target.value = "";
                }}
              />
            </label>
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

        <div className="bg-[#060606] p-1 border-b border-[#161616] space-y-1">
          <div className="relative h-5 border border-[#121212] rounded-[2px] bg-[#090909] overflow-hidden">
            <BeatGrid />
            {sections.map((section) => (
              <div
                key={`${section.label}-${section.start}`}
                className="absolute inset-y-0 border-l border-[#262626]"
                style={{ left: `${(section.start / TOTAL_BEATS) * 100}%`, width: `${((section.end - section.start) / TOTAL_BEATS) * 100}%` }}
              >
                <span className="absolute top-1/2 -translate-y-1/2 left-1 text-[9px] uppercase tracking-[0.14em] text-[#666]">
                  {section.label}
                </span>
              </div>
            ))}
          </div>

          <div className="relative h-11 border border-[#121212] rounded-[2px] bg-[#080808] overflow-hidden">
            <div className="absolute inset-0 flex">
              {beatEnergy.map((energy, index) => (
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
            <BeatGrid />
          </div>

          <div className="relative h-16 border border-[#121212] rounded-[2px] bg-[#090909] overflow-hidden">
            <div className="absolute inset-0 flex">
              {beatEnergy.map((energy, index) => (
                <div
                  key={`zone-${index}`}
                  className="flex-1 border-r border-[#0d0d0d] last:border-r-0"
                  style={{ background: getCutZoneColor(energy, energyReactive, lowEnergyRange, highEnergyRange) }}
                />
              ))}
            </div>

            {arrangementSegments.map((segment, index) => {
              const width = (segment.span / TOTAL_BEATS) * 100;
              const left = (segment.start / TOTAL_BEATS) * 100;
              const isActive = index === activeClip;
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
                    background: getSegmentColor(segment),
                    minWidth: 3,
                  }}
                  onClick={() => onActiveClip(index)}
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

            <BeatGrid />
            <div className="absolute inset-y-0 w-[1px] bg-[#e05c00]" style={{ left: `${playhead * 100}%` }} />
          </div>
        </div>

        {analysisError ? (
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
            Grey zones hold. Orange zones can accelerate into tighter beat cuts.
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
  beatEnergy: number[];
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
    beatEnergy,
    minDur,
    maxDur,
    energyResp,
    energyReactive,
    lowEnergyRange,
    highEnergyRange,
    onsetBoost,
    chaos,
  } = params;

  const segments: ArrangementSegment[] = [];
  const range = Math.max(0.001, highEnergyRange - lowEnergyRange);
  let index = 0;
  let segmentId = 0;

  while (index < beatEnergy.length) {
    const energy = beatEnergy[index] ?? 0;
    const normalized = energyReactive ? clamp((energy - lowEnergyRange) / range, 0, 1) : 0.5;
    const response = energyReactive ? clamp(Math.pow(normalized, 1 / Math.max(0.5, energyResp)), 0, 1) : 0.5;
    const baseDuration = lerp(maxDur, minDur, response);

    if (energyReactive && energy < lowEnergyRange) {
      const canHold =
        index % 2 === 0 &&
        index < beatEnergy.length - 1 &&
        (beatEnergy[index + 1] ?? 0) < lowEnergyRange;
      const span = canHold ? 2 : 1;

      segments.push({
        id: segmentId++,
        start: index,
        span,
        energy,
        duration: baseDuration * span,
        detailLabel: span === 2 ? "HOLD" : "1B",
        tone: "low",
      });
      index += span;
      continue;
    }

    if (energyReactive && energy >= highEnergyRange) {
      const pulse = sv((index + 1) * 13.1 + chaos * 9.7);
      const burstFactor = response + onsetBoost * 0.24 + (pulse - 0.5) * chaos * 0.3;
      const subdivisions = burstFactor > 0.86 ? 4 : 2;

      for (let subdivision = 0; subdivision < subdivisions; subdivision += 1) {
        segments.push({
          id: segmentId++,
          start: index + subdivision / subdivisions,
          span: 1 / subdivisions,
          energy,
          duration: Math.max(minDur * 0.45, baseDuration / subdivisions),
          detailLabel: subdivisions === 4 ? "1/4" : "1/2",
          tone: "high",
        });
      }

      index += 1;
      continue;
    }

    segments.push({
      id: segmentId++,
      start: index,
      span: 1,
      energy,
      duration: baseDuration,
      detailLabel: "1B",
      tone: "mid",
    });
    index += 1;
  }

  return segments;
}

function resampleSeries(points: number[], targetCount: number) {
  if (!points.length) return Array.from({ length: targetCount }, () => 0);
  if (points.length === targetCount) return points.map((point) => clamp(point, 0, 1));

  return Array.from({ length: targetCount }, (_, index) => {
    const start = Math.floor((index / targetCount) * points.length);
    const end = Math.max(start + 1, Math.floor(((index + 1) / targetCount) * points.length));
    const slice = points.slice(start, end);
    const avg = slice.reduce((sum, value) => sum + value, 0) / slice.length;
    return clamp(avg, 0, 1);
  });
}

function parseEssentiaPayload(payload: unknown, fileName: string): AudioAnalysis | null {
  if (!payload || typeof payload !== "object") return null;

  const source = payload as Record<string, unknown>;
  const waveform = normalizeSeries(
    findSeries(source, [
      ["waveform"],
      ["audio", "waveform"],
      ["analysis", "waveform"],
      ["data", "waveform"],
    ])
  );
  const energy = normalizeSeries(
    findSeries(source, [
      ["energy"],
      ["energies"],
      ["energy_timeline"],
      ["audio", "energy"],
      ["analysis", "energy"],
      ["analysis", "energies"],
      ["analysis", "energyTimeline"],
      ["data", "energy"],
    ])
  );
  const rawSections = findValue(source, [
    ["sections"],
    ["structure"],
    ["segments"],
    ["audio", "sections"],
    ["analysis", "sections"],
    ["analysis", "structure"],
    ["data", "sections"],
  ]);
  const sections = normalizeSections(rawSections);

  if (!waveform.length && !energy.length && !sections.length) return null;

  return {
    sourceLabel: fileName,
    waveform: waveform.length ? waveform : energy,
    energy: energy.length ? energy : waveform,
    sections: sections.length ? sections : DEFAULT_SECTION_MARKERS,
  };
}

function normalizeSeries(value: unknown) {
  if (!Array.isArray(value)) return [];

  const numbers = value
    .map((entry) => (typeof entry === "number" ? entry : Number(entry)))
    .filter((entry) => Number.isFinite(entry));

  if (!numbers.length) return [];

  const maxValue = Math.max(...numbers);
  const scale = maxValue > 1 ? maxValue : 1;
  return numbers.map((entry) => clamp(entry / scale, 0, 1));
}

function normalizeSections(value: unknown): SectionMarker[] {
  const items = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { segments?: unknown[] }).segments)
      ? (value as { segments: unknown[] }).segments
      : [];

  if (!items.length) return [];

  const sections = items
    .map((item, index) => parseSectionMarker(item, index))
    .filter((item): item is SectionMarker => item !== null)
    .sort((left, right) => left.start - right.start);

  if (!sections.length) return [];

  const maxEnd = Math.max(...sections.map((section) => section.end), TOTAL_BEATS);
  const scale = maxEnd > TOTAL_BEATS ? TOTAL_BEATS / maxEnd : 1;

  return sections
    .map((section) => ({
      label: section.label,
      start: clamp(section.start * scale, 0, TOTAL_BEATS),
      end: clamp(section.end * scale, 0, TOTAL_BEATS),
    }))
    .filter((section) => section.end > section.start + 0.25);
}

function parseSectionMarker(value: unknown, index: number): SectionMarker | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const start = getNumericField(item, ["start", "startTime", "start_time", "startBeat", "start_beat"]);
  const end =
    getNumericField(item, ["end", "endTime", "end_time", "endBeat", "end_beat"]) ??
    (() => {
      const duration = getNumericField(item, ["duration", "durationTime", "duration_time"]);
      return duration !== null && start !== null ? start + duration : null;
    })();

  if (start === null || end === null) return null;

  const label = abbreviateSectionLabel(
    String(item.label ?? item.name ?? item.section ?? item.type ?? `S${index + 1}`)
  );

  return { label, start, end };
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

function findSeries(source: Record<string, unknown>, paths: string[][]) {
  for (const path of paths) {
    const value = findNestedValue(source, path);
    if (Array.isArray(value)) return value;
  }
  return [];
}

function findValue(source: Record<string, unknown>, paths: string[][]) {
  for (const path of paths) {
    const value = findNestedValue(source, path);
    if (value !== undefined) return value;
  }
  return undefined;
}

function findNestedValue(source: Record<string, unknown>, path: string[]) {
  let current: unknown = source;

  for (const key of path) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }

  return current;
}

function getNumericField(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const number = Number(value);
      if (Number.isFinite(number)) return number;
    }
  }
  return null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getEnergyBarColor(energy: number, isReactive: boolean, lowEnergyRange: number, highEnergyRange: number) {
  if (!isReactive) return "#2d2d2d";
  if (energy >= highEnergyRange) return "#e05c00";
  if (energy <= lowEnergyRange) return "#3a3a3a";
  return "#a55416";
}

function getEnergyBandColor(energy: number, isReactive: boolean, lowEnergyRange: number, highEnergyRange: number) {
  if (!isReactive) return "#090909";
  if (energy >= highEnergyRange) return "#1c1108";
  if (energy <= lowEnergyRange) return "#0b0b0b";
  return "#120d09";
}

function getCutZoneColor(energy: number, isReactive: boolean, lowEnergyRange: number, highEnergyRange: number) {
  if (!isReactive) return "#0a0a0a";
  if (energy >= highEnergyRange) return "#130c07";
  if (energy <= lowEnergyRange) return "#090909";
  return "#0e0b09";
}

function getSegmentColor(segment: ArrangementSegment) {
  if (segment.tone === "low") return "linear-gradient(180deg, #191919 0%, #111111 100%)";
  if (segment.tone === "high") return "linear-gradient(180deg, #dd6a12 0%, #8a3400 100%)";
  return "linear-gradient(180deg, #5e3110 0%, #2f1808 100%)";
}

function BeatGrid() {
  return (
    <div className="absolute inset-0 pointer-events-none">
      {Array.from({ length: TOTAL_BEATS + 1 }, (_, index) => (
        <div
          key={`grid-${index}`}
          className="absolute inset-y-0"
          style={{
            left: `${(index / TOTAL_BEATS) * 100}%`,
            width: 1,
            background: index % 4 === 0 ? "#2a2a2a" : "#171717",
          }}
        />
      ))}
    </div>
  );
}
