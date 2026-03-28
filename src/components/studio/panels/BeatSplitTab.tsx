"use client";

import { ParamSlider } from "../ParamSlider";
import { SolidWaveform } from "../SolidWaveform";
import type { SourceClipSpan, SourceTimelineSegment } from "../sourceTimeline";
import { WAVE_AUDIO } from "../waveData";
import { fmt } from "../math";

type BeatSplitTabProps = {
  playhead: number;
  bpm: number;
  barsPerSeg: number;
  sourceClips: SourceClipSpan[];
  segments: SourceTimelineSegment[];
  sensitivity: number;
  activeClip: number;
  onBarsPerSeg: (v: number) => void;
  onSensitivity: (v: number) => void;
  onActiveClip: (i: number) => void;
};

export function BeatSplitTab({
  playhead,
  bpm,
  barsPerSeg,
  sourceClips,
  segments,
  sensitivity,
  activeClip,
  onBarsPerSeg,
  onSensitivity,
  onActiveClip,
}: BeatSplitTabProps) {
  const totalDuration = sourceClips[sourceClips.length - 1]?.end ?? 0;
  const barDuration = (60 / Math.max(1, bpm)) * 4;
  const estimatedBars = Math.max(1, Math.round(totalDuration / barDuration));

  return (
    <>
      <SolidWaveform
        points={WAVE_AUDIO}
        playhead={playhead}
        bpm={bpm}
        totalBars={8}
        beatsPerBar={4}
        accent="#c8900a"
        label={`A/V SOURCE · ${sourceClips.length} CLIP${sourceClips.length === 1 ? "" : "S"} STITCHED · ${fmt(totalDuration)}`}
        height={120}
      />

      <div className="border border-[#1a1a1a] rounded-[2px] bg-[#0c0c0c] overflow-hidden">
        <div className="flex items-center gap-4 px-3 py-2 border-b border-[#181818] text-[10px]">
          <span className="uppercase tracking-[0.18em] text-[#404040]">Beat Segments</span>
          <span className="font-mono text-[#555]">
            BPM <span className="text-[#e05c00]">{bpm}</span>
          </span>
          <span className="font-mono text-[#555]">
            BARS/SEG <span className="text-[#e05c00]">{barsPerSeg}</span>
          </span>
          <span className="font-mono text-[#555]">
            SEGS <span className="text-[#666]">{segments.length}</span>
          </span>
        </div>
        <div className="relative h-12 bg-[#070707] flex">
          {segments.map((segment, i) => (
            <div
              key={i}
              className={`relative border-r border-[#0d0d0d] cursor-pointer flex-shrink-0 transition-colors ${
                i === activeClip ? "bg-[#e05c0025]" : i % 2 === 0 ? "bg-[#0f0f0f]" : "bg-[#0b0b0b]"
              }`}
              style={{ width: `${(segment.duration / Math.max(totalDuration, 0.001)) * 100}%` }}
              onClick={() => onActiveClip(i)}
            >
              {i === activeClip && <div className="absolute top-0 left-0 right-0 h-[2px] bg-[#e05c00]" />}
              <span className="absolute top-[4px] left-[4px] text-[8px] font-mono text-[#555]">
                {formatSourceRefs(segment.sourceClipIds)}
              </span>
              <span className="absolute bottom-[3px] right-[3px] text-[7px] font-mono text-[#383838]">
                {segment.duration.toFixed(1)}s
              </span>
            </div>
          ))}
          <div className="absolute inset-y-0 w-[1px] bg-[#e05c00]" style={{ left: `${playhead * 100}%` }} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="border border-[#1a1a1a] rounded-[2px] bg-[#0c0c0c] p-3">
          <div className="mb-1 text-[10px] uppercase tracking-[0.2em] text-[#404040]">Detection Params</div>
          <ParamSlider label="Bars / Segment" value={barsPerSeg} min={1} max={8} step={1} onChange={onBarsPerSeg} />
          <ParamSlider label="Sensitivity" value={sensitivity} min={0} max={100} step={1} unit="%" onChange={onSensitivity} />
        </div>
        <div className="border border-[#1a1a1a] rounded-[2px] bg-[#0c0c0c] p-3">
          <div className="mb-1 text-[10px] uppercase tracking-[0.2em] text-[#404040]">Analysis Result</div>
          <div className="space-y-[4px]">
            {[
              ["Detected BPM", bpm],
              ["Beat confidence", "94.2%"],
              ["Estimated bars", estimatedBars],
              ["Segments", segments.length],
            ].map(([k, v]) => (
              <div key={String(k)} className="flex justify-between text-[11px] border-b border-[#141414] pb-1">
                <span className="text-[#484848]">{k}</span>
                <span className="font-mono text-[#e05c00]">{v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function formatSourceRefs(sourceClipIds: number[]) {
  if (!sourceClipIds.length) return "S0";
  if (sourceClipIds.length === 1) return `S${sourceClipIds[0] + 1}`;
  const first = sourceClipIds[0] ?? 0;
  const last = sourceClipIds[sourceClipIds.length - 1] ?? first;
  return `S${first + 1}-${last + 1}`;
}
