"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { fmt } from "./math";
import type { StorySection, StorySectionDraft } from "./musicVideoProject";
import type { BeatJoinSection } from "./types";

type StoryStructureEditorProps = {
  detectedSections: BeatJoinSection[];
  plannedSections: StorySection[];
  duration: number;
  activeSectionId: string;
  onSelect: (id: string) => void;
  onUpdate: (id: string, patch: Partial<StorySectionDraft>) => void;
  onMoveBoundary: (boundaryIndex: number, time: number) => void;
  onSplit: () => void;
  onRemove: (id: string) => void;
  onResetFromDetection: () => void;
};

export function StoryStructureEditor({
  detectedSections,
  plannedSections,
  duration,
  activeSectionId,
  onSelect,
  onUpdate,
  onMoveBoundary,
  onSplit,
  onRemove,
  onResetFromDetection,
}: StoryStructureEditorProps) {
  const railRef = useRef<HTMLDivElement>(null);
  const draggingBoundaryRef = useRef<number | null>(null);
  const [draggingBoundary, setDraggingBoundary] = useState<number | null>(null);
  const activeSection = plannedSections.find((section) => section.id === activeSectionId) ?? plannedSections[0] ?? null;

  function pointerTime(clientX: number) {
    const rect = railRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || duration <= 0) return 0;
    return Math.max(0, Math.min(duration, ((clientX - rect.left) / rect.width) * duration));
  }

  function beginBoundaryDrag(event: PointerEvent<HTMLButtonElement>, boundaryIndex: number) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    draggingBoundaryRef.current = boundaryIndex;
    setDraggingBoundary(boundaryIndex);
    onMoveBoundary(boundaryIndex, pointerTime(event.clientX));
  }

  function continueBoundaryDrag(event: PointerEvent<HTMLButtonElement>, boundaryIndex: number) {
    if (draggingBoundaryRef.current !== boundaryIndex || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    onMoveBoundary(boundaryIndex, pointerTime(event.clientX));
  }

  function endBoundaryDrag(event: PointerEvent<HTMLButtonElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    draggingBoundaryRef.current = null;
    setDraggingBoundary(null);
  }

  function nudgeBoundary(event: KeyboardEvent<HTMLButtonElement>, boundaryIndex: number, currentTime: number) {
    const direction = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (!direction) return;
    event.preventDefault();
    onMoveBoundary(boundaryIndex, currentTime + direction * (event.shiftKey ? 1 : 0.25));
  }

  return (
    <section className="rounded-[2px] border border-[#1a1a1a] bg-[#0b0b0b] p-3">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-[#e05c00]">Song sections</div>
          <div className="mt-1 text-[11px] text-[#6d6d6d]">Drag an orange divider to resize two neighboring sections. Click a section to rename, split, or remove it.</div>
        </div>
        <button type="button" onClick={onResetFromDetection} disabled={!detectedSections.length} className="rounded-[2px] border border-[#2a2a2a] px-3 py-1.5 text-[8px] uppercase tracking-[0.12em] text-[#888] hover:border-[#555] hover:text-[#bbb] disabled:cursor-not-allowed disabled:opacity-40">
          Reset to detection
        </button>
      </div>

      <div ref={railRef} className="relative h-24 select-none overflow-hidden rounded-[2px] border border-[#191919] bg-[#030303]">
        {duration > 0 ? <>
        {detectedSections.slice(0, -1).map((section, index) => (
          <div key={`detected-${index}`} aria-hidden="true" className="pointer-events-none absolute inset-y-0 z-10 border-l border-dashed border-[#3a7043] opacity-70" style={{ left: `${duration > 0 ? (section.end / duration) * 100 : 0}%` }} />
        ))}

        {plannedSections.map((section) => {
          const left = duration > 0 ? (section.start / duration) * 100 : 0;
          const width = duration > 0 ? ((section.end - section.start) / duration) * 100 : 0;
          const active = section.id === activeSectionId;
          return (
            <button
              key={section.id}
              type="button"
              onClick={() => onSelect(section.id)}
              className={`absolute inset-y-0 overflow-hidden border-r px-2 text-left transition-colors ${active ? "border-[#e05c00] bg-[#211006] text-[#f0b184]" : "border-[#30231b] bg-[#100b08] text-[#b78361] hover:bg-[#18100b]"}`}
              style={{ left: `${left}%`, width: `${width}%` }}
            >
              <span className="block truncate text-[9px] font-semibold uppercase tracking-[0.1em]">{section.label}</span>
              <span className="mt-1 block truncate font-mono text-[8px] opacity-65">{fmt(section.start)}–{fmt(section.end)}</span>
            </button>
          );
        })}

        {plannedSections.slice(0, -1).map((section, boundaryIndex) => {
          const next = plannedSections[boundaryIndex + 1];
          const left = duration > 0 ? (section.end / duration) * 100 : 0;
          return (
            <button
              key={`boundary-${section.id}`}
              type="button"
              role="slider"
              aria-label={`Boundary between ${section.label} and ${next?.label ?? "next section"}`}
              aria-orientation="horizontal"
              aria-valuemin={section.start}
              aria-valuemax={next?.end ?? duration}
              aria-valuenow={section.end}
              aria-valuetext={fmt(section.end)}
              onPointerDown={(event) => beginBoundaryDrag(event, boundaryIndex)}
              onPointerMove={(event) => continueBoundaryDrag(event, boundaryIndex)}
              onPointerUp={endBoundaryDrag}
              onPointerCancel={endBoundaryDrag}
              onKeyDown={(event) => nudgeBoundary(event, boundaryIndex, section.end)}
              className={`absolute inset-y-0 z-20 w-5 -translate-x-1/2 cursor-col-resize touch-none focus:outline-none ${draggingBoundary === boundaryIndex ? "bg-[#e05c0022]" : "bg-transparent"}`}
              style={{ left: `${left}%` }}
            >
              <span className="absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 bg-[#e05c00]" />
              <span className="absolute left-1/2 top-1/2 flex h-5 w-3 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[2px] border border-[#e05c00] bg-[#160b05] font-mono text-[8px] text-[#e05c00]">↔</span>
            </button>
          );
        })}

        </> : <div className="flex h-full items-center justify-center text-[9px] uppercase tracking-[0.12em] text-[#444]">Analyze the master song to create editable sections</div>}
      </div>

      {activeSection && duration > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-[2px] border border-[#171717] bg-[#070707] p-2">
          <span className="font-mono text-[9px] text-[#666]">{fmt(activeSection.start)}–{fmt(activeSection.end)}</span>
          <input
            aria-label="Selected section name"
            value={activeSection.label}
            onChange={(event) => onUpdate(activeSection.id, { label: event.target.value })}
            className="min-w-36 flex-1 rounded-[2px] border border-[#202020] bg-[#050505] px-2 py-1.5 text-[10px] text-[#c8c8c8] outline-none focus:border-[#e05c00]"
          />
          <button type="button" onClick={onSplit} className="rounded-[2px] border border-[#2a2a2a] px-3 py-1.5 text-[8px] uppercase tracking-[0.12em] text-[#aaa] hover:border-[#e05c00] hover:text-[#e05c00]">Split section</button>
          <button type="button" disabled={plannedSections.length <= 1} onClick={() => onRemove(activeSection.id)} className="rounded-[2px] border border-[#2a2a2a] px-3 py-1.5 text-[8px] uppercase tracking-[0.12em] text-[#777] hover:border-[#6a3324] hover:text-[#c77745] disabled:cursor-not-allowed disabled:opacity-35">Remove</button>
        </div>
      ) : null}

      {detectedSections.length ? <div className="mt-2 text-[8px] uppercase tracking-[0.12em] text-[#444]"><span className="mr-2 inline-block h-2 border-l border-dashed border-[#3a7043]" />Dashed markers show the original audio detection</div> : null}
    </section>
  );
}
