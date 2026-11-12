"use client";

import { useEffect, useRef, useState } from "react";
import { useSongRangeDrag } from "../useSongRangeDrag";
import type { SelectionGesture, SongRange } from "../reviewSelection";
import { buildSongSectionReview } from "../songSectionReview";

import { fmt } from "../math";
import type { MatchCandidateRailItem } from "../panels/matchCandidateRailModel";
import { SolidWaveform } from "../SolidWaveform";
import type { BeatJoinAnalysis } from "../types";
import type { SpineSlot } from "./spineSlots";
import { clipSpineRange, getSpineViewport, type SpineZoomMode } from "./spineViewport";
import { ReviewVideoHover } from "../ReviewVideoHover";
import { viewingThumbnailUrl } from "../mediaThumbnailUrl";

/** The top filmstrip has priority over the scrolling board, but no offscreen originals. */
function SpineThumbnail({ url, active }: { url: string; active: boolean }) {
  const root = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false), [failed, setFailed] = useState("");
  const src = viewingThumbnailUrl(url);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") {
      const frame = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(frame);
    }
    const observer = new IntersectionObserver(entries => setVisible(entries.some(entry => entry.isIntersecting)));
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  return <span ref={root} className="block h-full w-full">
    {visible && src && failed !== src ? (
      // eslint-disable-next-line @next/next/no-img-element -- small viewing derivative, visible top timeline first
      <img src={src} alt="" fetchPriority="high" decoding="async" onError={() => setFailed(src)}
        className={`h-full w-full object-cover ${active ? "" : "opacity-80 group-hover:opacity-100"}`} />
    ) : <span className="block h-full w-full bg-[repeating-linear-gradient(135deg,oklch(1_0_0/0.05)_0_4px,transparent_4px_10px)]" />}
  </span>;
}

type BeatSpineProps = {
  analysis: BeatJoinAnalysis;
  bpm: number;
  /** 0..1 position of the playhead on the master song. */
  playhead: number;
  onSeek: (playhead: number) => void;
  /** Selecting a musical section also opens its shots in the editor. */
  onSelectSection?: (start: number, end: number, extend: boolean, toggle?: boolean) => void;
  selectedRange?: { start: number; end: number };
  selectedRanges?: SongRange[];
  onSelectRange?: (range: SongRange, gesture: SelectionGesture) => void;
  onVisibleRangeChange?: (range: SongRange) => void;
  initialVisibleRange?: SongRange | null;
  /** Act-specific caption on the right, e.g. "Match · sections". */
  caption: string | null;
  /** Cuts of the prepared edit, in song time. Empty until Story has a plan. */
  slots: SpineSlot[];
  selectedSlotId: string | null;
  onSelectSlot: (slot: SpineSlot | null, extend?: boolean, toggle?: boolean) => void;
  /** Section-wide source suggestions, not alternate generated shot takes. */
  takes: MatchCandidateRailItem[];
  onPreviewSource: (sectionId: string, momentId: string) => void;
};

/**
 * The music is the spine. One beat-grid timeline on every act after Ingest:
 * section names in editorial type, the cut as thumbnail slots, alternate
 * takes under the selected slot, then the waveform with the beat ruler and a
 * playhead the transport bar drives.
 */
export function BeatSpine({ analysis, bpm, playhead, onSeek, onSelectSection, selectedRange, selectedRanges, onSelectRange, onVisibleRangeChange, initialVisibleRange, caption, slots, selectedSlotId, onSelectSlot, takes, onPreviewSource }: BeatSpineProps) {
  const [restoredView, setRestoredView] = useState(initialVisibleRange);
  const [zoomMode, setZoomMode] = useState<SpineZoomMode>("fit");
  const [focusedSection, setFocusedSection] = useState<{ start: number; selectionAnchor: number | undefined } | null>(null);
  const duration = Math.max(analysis.duration, 0.001);
  const playheadSeconds = playhead * duration;
  const selected = slots.find((slot) => slot.id === selectedSlotId) ?? null;
  const sections = buildSongSectionReview(analysis.sections.map((section, index) => ({ ...section, id: `analysis-${index}` })));
  const selectionAnchor = selectedRange?.start ?? selected?.start;
  const anchor = focusedSection?.start ?? selectionAnchor ?? selectedRanges?.[0]?.start ?? playheadSeconds;
  const sectionIndex = sections.findIndex(section => anchor >= section.start && anchor < section.end);
  const section = sections[sectionIndex] ?? null;
  const view = restoredView ? getSpineViewport(duration, "section", restoredView) : getSpineViewport(duration, zoomMode, section, selected);
  const drag = useSongRangeDrag(view, slots, onSelectRange);
  useEffect(() => { onVisibleRangeChange?.({ start: view.start, end: view.end }); }, [onVisibleRangeChange, view.start, view.end]);
  const viewDuration = view.end - view.start;
  const pct = (seconds: number) => `${((seconds - view.start) / viewDuration) * 100}%`;
  const playheadVisible = playheadSeconds >= view.start && playheadSeconds <= view.end;
  function selectSection(index: number, extend = false, toggle = false) {
    const next = sections[index];
    if (!next) return;
    setRestoredView(null);
    onSelectSection?.(next.start, next.end, extend, toggle);
    if (!onSelectRange) onSeek(Math.max(0, next.start) / duration);
    setFocusedSection({ start: next.start, selectionAnchor });
    setZoomMode("section");
  }

  return (
    <section aria-label="Beat spine" className="studio-song-spine vt-spine shrink-0 overflow-hidden rounded-[10px] border border-line bg-ink-1">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-2 py-1.5">
        <div role="group" aria-label="Timeline zoom" className="flex gap-1">
          {([["fit", "Full song"], ["section", "Selected section"], ["selected", "Selected cut"]] as const).map(([mode, label]) => (
            <button key={mode} type="button" aria-pressed={!restoredView && zoomMode === mode} disabled={mode === "section" ? !section : mode === "selected" ? !selected : false} onClick={() => { setRestoredView(null); if (mode === "section" && section) setFocusedSection({ start: section.start, selectionAnchor }); setZoomMode(mode); }} className={`rounded-sm px-2 py-1 text-xs focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40 ${!restoredView && zoomMode === mode ? "bg-accent-tint text-accent" : "text-fg-2 hover:bg-ink-2"}`}>{label}</button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-xs text-fg-2">
          <button type="button" aria-label="Previous song section" disabled={sectionIndex <= 0} onClick={() => selectSection(sectionIndex - 1)} className="rounded-sm px-2 py-1 hover:bg-ink-2 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40">←</button>
          <span>{restoredView ? "Review focus" : zoomMode === "fit" ? "Full song" : zoomMode === "section" ? section?.label ?? "Full song" : selected?.label ?? "Full song"} <span className="font-mono text-fg-3">{fmt(view.start)}–{fmt(view.end)}</span></span>
          <button type="button" aria-label="Next song section" disabled={!sections.length || sectionIndex >= sections.length - 1} onClick={() => selectSection(sectionIndex + 1)} className="rounded-sm px-2 py-1 hover:bg-ink-2 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40">→</button>
        </div>
      </div>
      <nav aria-label="Song sections" className="relative h-7 border-b border-line">
        {sections.map((section, index) => {
          const left = (Math.max(0, section.start) / duration) * 100;
          const width = Math.max(0.5, ((Math.min(duration, section.end) - Math.max(0, section.start)) / duration) * 100);
          const isSelected = (selectedRanges ?? (selectedRange ? [selectedRange] : [])).some(range => range.end > section.start && range.start < section.end);
          return (
            <button
              key={`${section.label}-${index}`}
              type="button"
              aria-pressed={onSelectSection ? isSelected : undefined}
              onClick={(event) => {
                selectSection(index, event.shiftKey, event.ctrlKey || event.metaKey);
              }}
              title={`${section.label} · ${fmt(section.start)}–${fmt(section.end)}`}
              style={{ left: `${left}%`, width: `${width}%` }}
              className={`absolute top-0 h-full border-r border-line px-2 text-left font-sans text-xs font-medium leading-7 ${isSelected ? "bg-accent-tint text-accent" : "text-fg-2 hover:bg-ink-2 hover:text-fg-0"}`}
            >
              <span className="block truncate">{section.label}</span>
            </button>
          );
        })}
      </nav>

      {slots.length ? (
        <>
          <div className="flex items-center justify-between border-b border-line bg-ink-1 px-2 py-1">
            <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-fg-3">Edit plan · song time</span>
            <span className="font-mono text-[9px] text-fg-3">Match places footage here · Space plays song</span>
          </div>
          <div {...drag} role="listbox" aria-label="Cuts" aria-multiselectable={Boolean(onSelectSection)} className="relative h-[68px] overflow-hidden border-b border-line bg-ink-0" onClick={(event) => { if (event.target === event.currentTarget) onSelectSlot(null); }}>
          {slots.map((slot) => {
            const geometry = clipSpineRange(slot, view);
            if (!geometry) return null;
            const isSelected = selectedRanges ? selectedRanges.some(range => slot.end > range.start && slot.start < range.end)
              : selectedRange ? slot.end > selectedRange.start && slot.start < selectedRange.end : slot.id === selectedSlotId;
            const isLive = playheadSeconds >= slot.start && playheadSeconds < slot.end;
            const wide = geometry.width > 4;
            return (
              <ReviewVideoHover
                key={slot.id}
                videoUrl={slot.videoUrl}
                start={slot.previewSegment?.startTime ?? 0}
                end={slot.previewSegment?.endTime}
                floating contextKey={`${view.start}:${view.end}`} previewLabel={slot.label}
                posterWhenVisible={!slot.thumbnailUrl}
                showStatus={wide}
                buttonProps={{ type: "button", role: "option", "aria-selected": isSelected, "aria-current": slot.id === selectedSlotId ? "true" : undefined,
                  onClick: event => { setFocusedSection(null); onSelectSlot(onSelectSection ? slot : isSelected ? null : slot, event.shiftKey, event.ctrlKey || event.metaKey); },
                  onDoubleClick: () => onSeek(slot.start / duration),
                  title: `${slot.sectionLabel} · ${fmt(slot.start)}–${fmt(slot.end)}\n${slot.label}${slot.kind === "generated" ? "\nGenerated shot" : ""}${slot.videoUrl ? "\nHover for silent preview" : "\nNo selected video · inspect shot takes"}`,
                  style: { left: `${geometry.left}%`, width: `max(2px, calc(${geometry.width}% - 2px))` } }}
                className={`group absolute top-[5px] h-[58px] overflow-hidden rounded-[5px] bg-ink-3 text-left outline-offset-[-1px] transition-[transform,box-shadow] duration-[var(--duration-fast)] ease-[var(--ease-out-soft)] ${
                  isSelected
                    ? "z-10 scale-y-[1.04] shadow-[0_0_0_1.5px_var(--color-accent)]"
                    : isLive
                      ? "shadow-[0_0_0_1px_var(--color-fg-2)]"
                      : "shadow-[0_0_0_1px_oklch(1_0_0/0.1)] hover:shadow-[0_0_0_1px_var(--color-fg-3)]"
                }`}
              >
                {slot.thumbnailUrl ? (
                  <SpineThumbnail url={slot.thumbnailUrl} active={isSelected || isLive} />
                ) : (
                  <span className="block h-full w-full bg-[repeating-linear-gradient(135deg,oklch(1_0_0/0.05)_0_4px,transparent_4px_10px)]" />
                )}
                {slot.kind === "generated" ? (
                  <span className="absolute left-0 top-0 rounded-br-[4px] bg-accent px-1 font-mono text-[8.5px] font-semibold leading-[13px] tracking-[0.06em] text-ink-0">AI</span>
                ) : null}
                {wide ? (
                  <span className="absolute inset-x-0 bottom-0 truncate bg-[linear-gradient(0deg,oklch(0_0_0/0.75),transparent)] px-1.5 pb-[3px] pt-3 font-mono text-[9.5px] leading-none text-fg-0">
                    {slot.label}
                  </span>
                ) : null}
              </ReviewVideoHover>
            );
          })}
          {playheadVisible ? <span aria-hidden className="pointer-events-none absolute top-0 h-full w-px bg-fg-0/80" style={{ left: pct(playheadSeconds) }} /> : null}
        </div>
        </>
      ) : null}

      {selected && takes.length > 1 ? (
        <div aria-label={`Source suggestions for ${selected.sectionLabel}`} className="relative flex h-11 items-center gap-1 overflow-x-auto border-b border-line bg-ink-1 px-1.5">
          <span aria-hidden className="absolute top-0 h-full w-px bg-accent/60" style={{ left: pct(selected.start) }} />
          <span title="Section-wide source suggestions. Percentages show matching fit, not render quality. Click to preview without changing the cut." className="shrink-0 pl-1 pr-2 font-mono text-[10px] text-fg-3">Sources · fit</span>
          {takes.map((take) => (
            <button
              key={take.moment.id}
              type="button"
              onClick={() => onPreviewSource(selected.sectionId, take.moment.id)}
              aria-label={`Preview source: ${take.moment.label}`}
              title={`Preview only · ${take.scorePercent}% matching fit\n${take.caption}\n${take.reason}`}
              className={`group flex h-8 shrink-0 items-center gap-1.5 overflow-hidden rounded-[5px] pr-2 text-left transition-[box-shadow] ${
                take.selected ? "bg-ink-3 shadow-[0_0_0_1.5px_var(--color-accent)]" : "bg-ink-2 shadow-[0_0_0_1px_oklch(1_0_0/0.1)] hover:shadow-[0_0_0_1px_var(--color-fg-2)]"
              }`}
            >
              {take.frameUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- gateway thumbnails
                <img src={take.frameUrl} alt="" className="aspect-video h-8 w-auto object-cover" />
              ) : (
                <span className="aspect-video h-8 shrink-0 bg-ink-3" />
              )}
              <span className="font-mono text-[10.5px] text-fg-1">{take.scorePercent}% fit</span>
              <span className="max-w-[16ch] truncate text-[11px] text-fg-3 group-hover:text-fg-1">{take.moment.label}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="pb-1 pt-1">
        <SolidWaveform
          points={analysis.waveform}
          playhead={playhead}
          bpm={bpm}
          beatTimes={analysis.beats}
          durationSeconds={duration}
          beatsPerBar={4}
          accent="oklch(0.7 0.19 45)"
          height={slots.length ? 88 : 112}
          label={caption ?? ""}
          showRuler
          zoom={1}
          visibleRange={view}
          edgeToEdge
          onSeek={onSeek}
        />
      </div>
    </section>
  );
}
