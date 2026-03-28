"use client";

import { ParamSlider } from "../ParamSlider";
import { SolidWaveform } from "../SolidWaveform";
import type { SourceClipSpan, SourceTimelineSegment } from "../sourceTimeline";
import { WAVE_MAIN } from "../waveData";
import { fmt } from "../math";

type SplitTabProps = {
  playhead: number;
  bpm: number;
  clipDur: number;
  sourceClips: SourceClipSpan[];
  segments: SourceTimelineSegment[];
  activeClip: number;
  onClipDur: (v: number) => void;
  onActiveClip: (i: number) => void;
};

export function SplitTab({
  playhead,
  bpm,
  clipDur,
  sourceClips,
  segments,
  activeClip,
  onClipDur,
  onActiveClip,
}: SplitTabProps) {
  const totalDuration = sourceClips[sourceClips.length - 1]?.end ?? 0;

  return (
    <>
      <SolidWaveform
        points={WAVE_MAIN}
        playhead={playhead}
        bpm={bpm}
        totalBars={8}
        beatsPerBar={4}
        label={`SOURCE · ${sourceClips.length} CLIP${sourceClips.length === 1 ? "" : "S"} STITCHED · ${fmt(totalDuration)}`}
        height={120}
      />

      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] uppercase tracking-[0.18em] text-[#404040]">
            Output Segments — {segments.length} clips @ {clipDur}s
          </span>
          <span className="text-[10px] font-mono text-[#e05c00]">/output/split/</span>
        </div>
        <div className="relative h-10 bg-[#070707] border border-[#1a1a1a] rounded-[2px] flex overflow-hidden">
          {segments.map((segment, i) => (
            <div
              key={i}
              className={`relative border-r border-[#0d0d0d] cursor-pointer flex-shrink-0 transition-colors ${
                i === activeClip ? "bg-[#e05c0030]" : i % 2 === 0 ? "bg-[#111]" : "bg-[#0e0e0e]"
              }`}
              style={{ width: `${(segment.duration / Math.max(totalDuration, 0.001)) * 100}%` }}
              onClick={() => onActiveClip(i)}
            >
              {i === activeClip && <div className="absolute top-0 left-0 right-0 h-[2px] bg-[#e05c00]" />}
              <span className="absolute bottom-[2px] left-[2px] text-[7px] font-mono text-[#333]">{i + 1}</span>
              <span className="absolute top-[2px] right-[2px] text-[7px] font-mono text-[#444]">
                {formatSourceRefs(segment.sourceClipIds)}
              </span>
            </div>
          ))}
          <div className="absolute inset-y-0 w-[1px] bg-[#e05c00]" style={{ left: `${playhead * 100}%` }} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="border border-[#1a1a1a] rounded-[2px] bg-[#0c0c0c] p-3">
          <div className="mb-2 text-[10px] uppercase tracking-[0.2em] text-[#404040]">Segment Parameters</div>
          <ParamSlider label="Duration" value={clipDur} min={1} max={30} step={0.5} unit="s" onChange={onClipDur} />
          <div className="mt-3 text-[10px] uppercase tracking-[0.14em] text-[#555]">
            Short tails merge forward so the final section never drops under the minimum usable length.
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {(["H.264", "H.265", "AV1"] as const).map((e) => (
              <button
                key={e}
                type="button"
                className="py-1 text-[11px] font-mono border border-[#1e1e1e] rounded-[2px] text-[#555] hover:border-[#2a2a2a]"
              >
                {e}
              </button>
            ))}
          </div>
        </div>
        <div className="border border-[#1a1a1a] rounded-[2px] bg-[#0c0c0c] p-3">
          <div className="mb-2 text-[10px] uppercase tracking-[0.2em] text-[#404040]">Hardware Target</div>
          <div className="border border-[#e05c0033] bg-[#e05c000d] rounded-[2px] px-3 py-2 text-[11px] font-mono text-[#e05c00] mb-2">
            NVIDIA CUDA (SM_120) — RTX 5090
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            {[
              ["Cores", "16384"],
              ["VRAM", "24 GB"],
              ["Est.", `${(clipDur * 0.3).toFixed(1)}s`],
              ["Output", "/output/"],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between text-[10px]">
                <span className="text-[#3a3a3a]">{k}</span>
                <span className="font-mono text-[#666]">{v}</span>
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
