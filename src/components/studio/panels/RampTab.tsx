"use client";

import { ParamSlider } from "../ParamSlider";
import { getRampPresetDefinition, RAMP_PRESETS } from "../remapPresets";
import { SpeedCurve } from "../SpeedCurve";
import type { BeatJoinAnalysis, RampPreset } from "../types";
import type { EffectsTimelineSegment } from "../resolvedPreviewSelection";

type RampTabProps = {
  playhead: number;
  bpm: number;
  analysis: BeatJoinAnalysis | null;
  segmentPreviews: EffectsTimelineSegment[];
  isUsingCommittedSplit?: boolean;
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

export function RampTab({
  playhead,
  analysis,
  segmentPreviews,
  isUsingCommittedSplit = false,
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
  const arrangementDuration = Math.max(0, ...segmentPreviews.map(preview => preview.musicEnd));
  const rampNodes = buildRampNodes({
    segmentPreviews,
    analysis,
    preset: rampPreset,
    minSpeed,
    maxSpeed,
    energyThresh,
    buildBoost,
    dropSlowdown,
  });
  const selectedPreset = getRampPresetDefinition(rampPreset);

  function applyRampPreset(preset: RampPreset) {
    const definition = getRampPresetDefinition(preset);
    onRampPreset(preset);
    onMinSpeed(definition.minSpeed);
    onMaxSpeed(definition.maxSpeed);
    onRampDur(definition.rampDur);
    onEnergyThresh(definition.energyThresh);
    onBuildBoost(definition.buildBoost);
    onDropSlowdown(definition.dropSlowdown);
  }

  return (
    <>
      {!isUsingCommittedSplit ? (
        <div className="rounded-[2px] border border-[#3a220c] bg-[#120b06] px-3 py-2 text-[10px] uppercase tracking-[0.14em] text-[#d5a56a]">
          Build the Join timeline first so Effects can derive anchors from the approved arrangement.
        </div>
      ) : null}

      <div className="overflow-hidden rounded-md border border-line bg-ink-1">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
          <span className="text-xs font-medium text-fg-2">Effects timeline</span>
          <span className="font-mono text-[10px] text-fg-3">{segmentPreviews.length} placements · {arrangementDuration.toFixed(1)}s</span>
        </div>
        <div className="relative h-16 bg-ink-0">
          {segmentPreviews.map((preview, index) => {
            const total = Math.max(arrangementDuration, 0.001);
            return (
              <div
                key={preview.clipId}
                title={`${preview.label} · song ${preview.musicStart.toFixed(3)}–${preview.musicEnd.toFixed(3)}s`}
                className={`absolute inset-y-0 overflow-hidden border-r border-line ${preview.kind === "gap" ? "border border-dashed border-warn-lo bg-ink-0" : index % 2 === 0 ? "bg-ink-3" : "bg-ink-2"}`}
                style={{ left: `${(preview.musicStart / total) * 100}%`, width: `${(preview.duration / total) * 100}%` }}
              >
                <span className="absolute inset-x-1 top-1 truncate font-mono text-[8px] text-fg-2">
                  {preview.kind === "gap" ? "Missing footage" : preview.sourceRefLabel ?? `Cut ${index + 1}`}
                </span>
                <span className="absolute bottom-1 right-1 font-mono text-[8px] text-fg-3">
                  {preview.duration.toFixed(1)}s
                </span>
              </div>
            );
          })}
          <div className="absolute inset-y-0 w-px bg-accent" style={{ left: `${playhead * 100}%` }} />
        </div>
      </div>

      <div className="border border-[#1a1a1a] rounded-[2px] bg-[#0c0c0c]">
        <div className="flex items-center justify-between px-3 py-2 border-b border-[#181818]">
          <span className="text-[10px] uppercase tracking-[0.2em] text-fg-3">Speed study — drag anchors</span>
          <span className="text-[10px] font-mono text-[#e05c00] uppercase">{selectedPreset.label}</span>
        </div>
        <div className="p-2">
          <p className="mb-2 text-xs text-fg-3">This speed study is not applied to preview or export. The saved cut keeps its musical timing.</p>
          <SpeedCurve key={`${rampPreset}-${JSON.stringify(rampNodes)}`} minSpeed={minSpeed} maxSpeed={maxSpeed} preset={rampPreset} initialNodes={rampNodes} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="border border-[#1a1a1a] rounded-[2px] bg-[#0c0c0c] p-3">
          <div className="mb-1 text-[10px] uppercase tracking-[0.2em] text-[#404040]">Timing Parameters</div>
          <ParamSlider label="Min Speed" value={minSpeed} min={0.1} max={1} step={0.05} unit="×" onChange={onMinSpeed} />
          <ParamSlider label="Max Speed" value={maxSpeed} min={1} max={8} step={0.1} unit="×" onChange={onMaxSpeed} />
          <ParamSlider label="Ramp Duration" value={rampDur} min={0.1} max={2} step={0.05} unit="s" onChange={onRampDur} />
          <ParamSlider label="Energy Thresh" value={energyThresh} min={0} max={1} step={0.01} onChange={onEnergyThresh} />
          <ParamSlider label="Buildup Boost" value={buildBoost} min={1} max={3} step={0.05} unit="×" onChange={onBuildBoost} />
          <ParamSlider label="Drop Slowdown" value={dropSlowdown} min={0.1} max={1} step={0.05} unit="×" onChange={onDropSlowdown} />
        </div>
        <div className="border border-[#1a1a1a] rounded-[2px] bg-[#0c0c0c] p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-[0.2em] text-[#6f8287]">Transition Preset Bank</div>
            <div className="font-mono text-[9px] text-[#40545a]">{RAMP_PRESETS.length} curves</div>
          </div>
          <div className="grid gap-1">
            {RAMP_PRESETS.map((definition) => {
            const p = definition.key;
            return (
              <button
                key={p}
                type="button"
                onClick={() => applyRampPreset(p)}
                className={`grid w-full grid-cols-[minmax(0,1fr)_78px] items-center gap-2 px-2 py-[7px] border rounded-[2px] text-left transition-colors ${
                  rampPreset === p
                    ? "border-[#e05c00] bg-[#e05c0012] shadow-[inset_0_0_0_1px_rgba(224,92,0,0.12)]"
                    : "border-[#1a1a1a] bg-[#090909] hover:border-[#2d3c40]"
                }`}
              >
                <div>
                  <div className={`text-[11px] font-medium ${rampPreset === p ? "text-[#e05c00]" : "text-[#8ca0a5]"}`}>
                    {definition.label}
                  </div>
                  <div className="text-[9px] text-[#4d5a5e]">{definition.detail}</div>
                </div>
                <div className="space-y-1">
                  <PresetSparkline values={definition.shape} active={rampPreset === p} />
                  <div className="text-right font-mono text-[9px] text-[#58656a]">{definition.rangeLabel}</div>
                </div>
              </button>
            );
          })}
          </div>
        </div>
      </div>
    </>
  );
}

function buildRampNodes(params: {
  segmentPreviews: EffectsTimelineSegment[];
  analysis: BeatJoinAnalysis | null;
  preset: RampPreset;
  minSpeed: number;
  maxSpeed: number;
  energyThresh: number;
  buildBoost: number;
  dropSlowdown: number;
}) {
  const { segmentPreviews, analysis, preset, minSpeed, maxSpeed, energyThresh, buildBoost, dropSlowdown } = params;
  if (!segmentPreviews.length) return [];

  const totalDuration = Math.max(0, ...segmentPreviews.map(preview => preview.musicEnd));
  const sectionMap = (analysis?.sections ?? []).map((section) => ({
    ...section,
    normalized: analysis && analysis.duration > 0 ? section.start / analysis.duration : 0,
  }));

  const presetDefinition = getRampPresetDefinition(preset);

  const anchors: { x: number; y: number; kind?: string; label?: string }[] = [
    { x: 0, y: normalizeSpeed(1, minSpeed, maxSpeed), kind: "start", label: "START" },
  ];

  for (const preview of segmentPreviews) {
    if (preview.kind === "gap") continue;
    const midpoint = preview.musicStart + preview.duration / 2;
    const normalized = midpoint / Math.max(totalDuration, 0.001);
    const matchingSection = sectionMap.find((section, index) => {
      const next = sectionMap[index + 1];
      return normalized >= section.normalized && normalized < (next?.normalized ?? 1);
    });
    const energy = matchingSection?.energy ?? 0.5;
    const highLift = presetDefinition.highBias * buildBoost;
    const lowDrop = presetDefinition.lowBias * (1 - dropSlowdown);
    const targetSpeed =
      energy >= energyThresh
        ? Math.min(maxSpeed, 1 + highLift * energy)
        : Math.max(minSpeed, 1 - lowDrop * (1 - energy));

    anchors.push({
      x: normalized,
      y: normalizeSpeed(targetSpeed, minSpeed, maxSpeed),
      kind: matchingSection ? "section" : "cut",
      label: matchingSection?.label?.slice(0, 3).toUpperCase() ?? `C${preview.clipId + 1}`,
    });
  }

  anchors.push({ x: 1, y: normalizeSpeed(1, minSpeed, maxSpeed), kind: "end", label: "END" });

  return anchors
    .sort((left, right) => left.x - right.x)
    .filter((anchor, index, all) => index === 0 || Math.abs(anchor.x - all[index - 1].x) > 0.02);
}

function normalizeSpeed(value: number, minSpeed: number, maxSpeed: number) {
  const bounded = Math.max(minSpeed, Math.min(maxSpeed, value));
  return (bounded - minSpeed) / Math.max(maxSpeed - minSpeed, 0.001);
}

function PresetSparkline({ values, active }: { values: number[]; active: boolean }) {
  const width = 72;
  const height = 20;
  const points = values
    .map((value, index) => {
      const x = values.length <= 1 ? 0 : (index / (values.length - 1)) * width;
      const y = (1 - value) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-5 w-[72px] rounded-[1px] bg-[#071014]">
      <polyline
        points={points}
        fill="none"
        stroke={active ? "#e05c00" : "#6f8287"}
        strokeWidth={1.6}
        vectorEffect="non-scaling-stroke"
      />
      {values.map((value, index) => (
        <circle
          key={`${value}-${index}`}
          cx={values.length <= 1 ? 0 : (index / (values.length - 1)) * width}
          cy={(1 - value) * height}
          r={1.5}
          fill={active ? "#e05c00" : "#40545a"}
        />
      ))}
    </svg>
  );
}
