"use client";

import { fmt } from "../math";
import type { EditPlanPreviewSegment } from "../musicVideoProject";

type JoinTabProps = {
  previewSegments: EditPlanPreviewSegment[];
  activeClip: number;
  onActiveClip: (index: number) => void;
};

export function JoinTab({ previewSegments, activeClip, onActiveClip }: JoinTabProps) {
  if (!previewSegments.length) {
    return (
      <div className="rounded-[2px] border border-dashed border-[#222] bg-[#090909] px-4 py-10 text-center">
        <div className="text-[13px] text-[#b0b0b0]">Join is waiting for the resolved edit.</div>
        <div className="mt-2 text-[10px] uppercase tracking-[0.14em] text-[#555]">
          Finish Match and resolve required Generate gaps so Join can show the exact preview/export sequence.
        </div>
      </div>
    );
  }

  const totalDuration = Math.max(previewSegments.at(-1)?.musicEnd ?? 0, 0.001);
  const sourceCount = new Set(previewSegments.map((segment) => segment.sourceClipId).filter((id) => id !== undefined)).size;
  const sectionCount = new Set(previewSegments.map((segment) => segment.sectionId)).size;
  const selectedIndex = Math.min(activeClip, previewSegments.length - 1);

  return (
    <div className="space-y-3">
      <div className="rounded-[2px] border border-[#26351f] bg-[#091008] px-3 py-2">
        <div className="text-[10px] uppercase tracking-[0.16em] text-[#78b96a]">Resolved edit locked to preview / export</div>
        <div className="mt-1 text-[10px] leading-4 text-[#707a6d]">
          This is the actual Match result in song order—not the larger Split candidate pool. Review replacements in Match or Generate; Join does not silently reshuffle or omit cuts.
        </div>
      </div>

      <div className="overflow-hidden rounded-[2px] border border-[#1a1a1a] bg-[#080808]">
        <div className="flex flex-wrap items-center gap-3 border-b border-[#181818] px-3 py-2 text-[10px]">
          <span className="uppercase tracking-[0.18em] text-[#8a8a8a]">Resolved edit timeline</span>
          <span className="font-mono text-[#666]">
            {previewSegments.length} cuts · <span className="text-[#e05c00]">{fmt(totalDuration)}</span>
          </span>
          <span className="font-mono text-[#555]">{sectionCount} sections · {sourceCount} sources</span>
          <span className="ml-auto font-mono uppercase text-[#4f6f46]">combined Match output</span>
        </div>
        <div className="relative h-14 bg-[#050505]">
          {previewSegments.map((segment, index) => {
            const left = (segment.musicStart / totalDuration) * 100;
            const width = Math.max(0.25, ((segment.musicEnd - segment.musicStart) / totalDuration) * 100);
            const selected = index === selectedIndex;
            return (
              <button
                key={`${segment.sectionId}-${segment.musicStart}-${index}`}
                type="button"
                aria-label={`Cut ${index + 1} · ${segment.sourceRefLabel ?? segment.label}`}
                aria-pressed={selected}
                onClick={() => onActiveClip(index)}
                className={`absolute inset-y-1 overflow-hidden rounded-[1px] border transition-colors ${selected ? "z-10 border-[#e05c00] bg-[#3a1808]" : "border-[#0a0a0a] bg-[#102014] hover:border-[#8a421d]"}`}
                style={{ left: `${left}%`, width: `${width}%` }}
                title={`${segment.sourceRefLabel ?? segment.label} · song ${formatCutTime(segment.musicStart)}-${formatCutTime(segment.musicEnd)}`}
              >
                <span className="absolute left-[2px] top-[2px] font-mono text-[7px] text-[#777]">{index + 1}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-end justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-[#6a6a6a]">Final cut order</div>
            <div className="mt-1 text-[9px] text-[#555]">Click a cut to focus its exact source and song position.</div>
          </div>
          <div className="font-mono text-[9px] text-[#555]">CUT {String(selectedIndex + 1).padStart(3, "0")} / {previewSegments.length}</div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-6">
          {previewSegments.map((segment, index) => {
            const selected = index === selectedIndex;
            const duration = Math.max(0, segment.musicEnd - segment.musicStart);
            const sourceLabel = segment.sourceRefLabel
              ?? (segment.sourceClipId !== undefined ? `S${segment.sourceClipId + 1}` : "Unknown source");
            return (
              <button
                key={`${segment.sectionId}-${segment.musicStart}-${segment.startTime}-${index}`}
                type="button"
                aria-pressed={selected}
                onClick={() => onActiveClip(index)}
                className={`group overflow-hidden rounded-[2px] border bg-[#070707] text-left transition-colors ${selected ? "border-[#e05c00]" : "border-[#202020] hover:border-[#6a3218]"}`}
              >
                <div className="relative aspect-video bg-[#030303]">
                  {segment.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={segment.thumbnailUrl} alt={`${sourceLabel} final cut`} className="h-full w-full object-cover opacity-80 group-hover:opacity-100" loading="lazy" decoding="async" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[8px] uppercase tracking-[0.12em] text-[#444]">No frame</div>
                  )}
                  <div className="absolute left-1 top-1 rounded-[1px] bg-[#000000c0] px-1.5 py-0.5 font-mono text-[7px] text-[#ddd]">{sourceLabel}</div>
                  <div className="absolute right-1 top-1 rounded-[1px] bg-[#000000c0] px-1.5 py-0.5 font-mono text-[7px] text-[#aaa]">{duration.toFixed(1)}s</div>
                  <div className="absolute bottom-1 left-1 rounded-[1px] bg-[#000000c0] px-1.5 py-0.5 font-mono text-[7px] text-[#aaa]">SRC {formatCutTime(segment.startTime)}–{formatCutTime(segment.endTime)}</div>
                </div>
                <div className="border-t border-[#151515] px-2 py-1.5">
                  <div className="truncate font-mono text-[8px] uppercase tracking-[0.1em] text-[#8a8a8a]">CUT {String(index + 1).padStart(3, "0")} · {segment.label}</div>
                  <div className="mt-1 font-mono text-[7px] text-[#555]">SONG {formatCutTime(segment.musicStart)}–{formatCutTime(segment.musicEnd)}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function formatCutTime(value: number) {
  const safe = Math.max(0, value);
  const minutes = Math.floor(safe / 60);
  const seconds = safe - minutes * 60;
  return `${minutes}:${seconds.toFixed(2).padStart(5, "0")}`;
}
