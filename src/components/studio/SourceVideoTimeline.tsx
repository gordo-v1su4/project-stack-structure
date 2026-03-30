"use client";

import { fmt } from "./math";
import type { UploadedVideoSource } from "./types";

type SourceVideoTimelineProps = {
  sources: UploadedVideoSource[];
  playhead: number;
  label: string;
  height?: number;
};

export function SourceVideoTimeline({
  sources,
  playhead,
  label,
  height = 124,
}: SourceVideoTimelineProps) {
  const totalDuration = sources.reduce((sum, source) => sum + source.duration, 0);

  return (
    <div className="relative overflow-hidden rounded-[2px] border border-[#1e1e1e] bg-[#070707]" style={{ height }}>
      <div className="absolute top-[3px] left-[8px] z-10 text-[9px] uppercase tracking-[0.18em] text-[#3a3a3a]">
        {label}
      </div>

      <div className="absolute inset-x-0 top-[22px] bottom-0 flex">
        {sources.map((source, index) => {
          const width = `${(source.duration / Math.max(totalDuration, 0.001)) * 100}%`;

          return (
            <div
              key={source.id}
              className="relative border-r border-[#0a0a0a] last:border-r-0"
              style={{ width }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={source.thumbnailUrl} alt={source.name} className="absolute inset-0 h-full w-full object-cover opacity-80" />
              <div className="absolute inset-0 bg-gradient-to-b from-[#00000055] via-[#00000022] to-[#00000099]" />
              <div className="absolute inset-y-0 right-0 w-px bg-[#121212]" />
              <div className="absolute left-[6px] top-[6px] rounded-[2px] bg-[#00000088] px-1 py-[2px] text-[8px] font-mono text-[#e0e0e0]">
                S{index + 1}
              </div>
              <div className="absolute bottom-[6px] left-[6px] max-w-[70%] truncate rounded-[2px] bg-[#00000088] px-1 py-[2px] text-[7px] font-mono text-[#cfcfcf]">
                {source.name}
              </div>
              <div className="absolute top-[6px] right-[6px] rounded-[2px] bg-[#00000088] px-1 py-[2px] text-[8px] font-mono text-[#9d9d9d]">
                {fmt(source.duration)}
              </div>
            </div>
          );
        })}
      </div>

      <div className="pointer-events-none absolute inset-y-0 w-[1px] bg-[#e05c00]" style={{ left: `${playhead * 100}%` }} />

      <div className="absolute bottom-[3px] right-[8px] flex gap-4 text-[9px] font-mono text-[#333]">
        <span>
          Clips <span className="text-[#4a4a4a]">{sources.length}</span>
        </span>
        <span>
          Total <span className="text-[#4a4a4a]">{fmt(totalDuration)}</span>
        </span>
      </div>
    </div>
  );
}
