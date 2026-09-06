"use client";

import { fmt } from "./math";
import type { UploadedVideoSource } from "./types";

type SourceVideoTimelineProps = {
  sources: UploadedVideoSource[];
  playhead: number;
  label: string;
  height?: number;
  /** duration = proportional to clip length; equal = same width per file (readable inventory). */
  layout?: "duration" | "equal";
};

export function SourceVideoTimeline({
  sources,
  playhead,
  label,
  height = 124,
  layout = "duration",
}: SourceVideoTimelineProps) {
  const totalDuration = sources.reduce((sum, source) => sum + source.duration, 0);
  const equalTileWidth = Math.max(128, Math.min(200, Math.floor(920 / Math.max(sources.length, 1))));

  return (
    <div className="relative overflow-hidden rounded-[2px] border border-[#1e1e1e] bg-[#070707]" style={{ height }}>
      <div className="absolute top-[4px] left-[8px] z-10 max-w-[70%] truncate text-[9px] uppercase tracking-[0.16em] text-[#5a5a5a]" title={label}>
        {label}
      </div>
      <div className="absolute top-[4px] right-[8px] z-10 font-mono text-[9px] text-[#666]">
        {sources.length} clip{sources.length === 1 ? "" : "s"} · {fmt(totalDuration)}
      </div>

      <div className={`absolute inset-x-0 top-[26px] bottom-[6px] flex ${layout === "equal" ? "overflow-x-auto" : ""}`}>
        {sources.map((source) => {
          const width = layout === "equal"
            ? `${equalTileWidth}px`
            : `${(source.duration / Math.max(totalDuration, 0.001)) * 100}%`;
          const sceneCount = source.scenes?.length ?? 0;

          return (
            <div
              key={source.id}
              className={`relative shrink-0 border-r border-[#0a0a0a] last:border-r-0 ${layout === "equal" ? "flex-none" : ""}`}
              style={{ width }}
              title={`${source.name} · ${fmt(source.duration)}${sceneCount ? ` · ${sceneCount} scenes` : ""}`}
            >
              {source.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={source.thumbnailUrl} alt={source.name} className="absolute inset-0 h-full w-full object-cover object-center opacity-90" loading="lazy" decoding="async" />
              ) : (
                <div className="absolute inset-0 bg-[linear-gradient(135deg,#161616,#050505)]" />
              )}
              <div className="absolute inset-0 bg-gradient-to-b from-[#00000066] via-transparent to-[#000000bb]" />
              <div className="absolute inset-y-0 right-0 w-px bg-[#121212]" />
              <div className="absolute left-[6px] top-[6px] rounded-[2px] bg-[#000000aa] px-1.5 py-[2px] text-[9px] font-mono font-semibold text-[#f0f0f0]">
                S{source.id + 1}
              </div>
              {sceneCount > 0 ? (
                <div className="absolute right-[6px] top-[6px] rounded-[2px] bg-[#000000aa] px-1.5 py-[2px] text-[8px] font-mono text-[#9d9d9d]">
                  {sceneCount} sc
                </div>
              ) : null}
              <div className="absolute bottom-[6px] inset-x-[6px] truncate rounded-[2px] bg-[#000000aa] px-1.5 py-[2px] text-[8px] font-mono leading-tight text-[#e8e8e8]" title={source.name}>
                {source.name}
              </div>
              <div className="absolute bottom-[22px] right-[6px] rounded-[2px] bg-[#000000aa] px-1.5 py-[2px] text-[8px] font-mono text-[#bdbdbd]">
                {fmt(source.duration)}
              </div>
            </div>
          );
        })}
      </div>

      {layout === "duration" ? (
        <div className="pointer-events-none absolute inset-y-0 w-[1px] bg-[#e05c00]" style={{ left: `${playhead * 100}%` }} />
      ) : null}
    </div>
  );
}
