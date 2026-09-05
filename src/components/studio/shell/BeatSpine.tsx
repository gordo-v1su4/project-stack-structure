"use client";

import { fmt } from "../math";
import type { MatchCandidateRailItem } from "../panels/matchCandidateRailModel";
import { SolidWaveform } from "../SolidWaveform";
import type { BeatJoinAnalysis } from "../types";
import type { SpineSlot } from "./spineSlots";

type BeatSpineProps = {
  analysis: BeatJoinAnalysis;
  bpm: number;
  /** 0..1 position of the playhead on the master song. */
  playhead: number;
  onSeek: (playhead: number) => void;
  /** Act-specific caption on the right, e.g. "Match · sections". */
  caption: string | null;
  /** Cuts of the prepared edit, in song time. Empty until Story has a plan. */
  slots: SpineSlot[];
  selectedSlotId: string | null;
  onSelectSlot: (slot: SpineSlot | null) => void;
  /** Alternate takes for the selected slot's section; hang under the slot. */
  takes: MatchCandidateRailItem[];
  onSelectTake: (sectionId: string, momentId: string) => void;
};

/**
 * The music is the spine. One beat-grid timeline on every act after Ingest:
 * section names in editorial type, the cut as thumbnail slots, alternate
 * takes under the selected slot, then the waveform with the beat ruler and a
 * playhead the transport bar drives.
 */
export function BeatSpine({ analysis, bpm, playhead, onSeek, caption, slots, selectedSlotId, onSelectSlot, takes, onSelectTake }: BeatSpineProps) {
  const duration = Math.max(analysis.duration, 0.001);
  const playheadSeconds = playhead * duration;
  const selected = slots.find((slot) => slot.id === selectedSlotId) ?? null;
  const pct = (seconds: number) => `${(Math.max(0, Math.min(duration, seconds)) / duration) * 100}%`;

  return (
    <section aria-label="Beat spine" className="vt-spine shrink-0 overflow-hidden rounded-[10px] border border-line bg-ink-1">
      <div className="relative h-6 border-b border-line">
        {analysis.sections.map((section, index) => {
          const left = (Math.max(0, section.start) / duration) * 100;
          const width = Math.max(0.5, ((Math.min(duration, section.end) - Math.max(0, section.start)) / duration) * 100);
          return (
            <button
              key={`${section.label}-${index}`}
              type="button"
              onClick={() => onSeek(Math.max(0, section.start) / duration)}
              title={`${section.label} · ${fmt(section.start)}–${fmt(section.end)}`}
              style={{ left: `${left}%`, width: `${width}%` }}
              className="absolute top-0 h-full border-r border-line px-2 text-left font-display text-[13px] italic leading-6 text-fg-2 hover:bg-ink-2 hover:text-fg-0"
            >
              <span className="block truncate">{section.label}</span>
            </button>
          );
        })}
      </div>

      {slots.length ? (
        <div role="listbox" aria-label="Cuts" className="relative h-[58px] border-b border-line bg-ink-0" onClick={(event) => { if (event.target === event.currentTarget) onSelectSlot(null); }}>
          {slots.map((slot) => {
            const isSelected = slot.id === selectedSlotId;
            const isLive = playheadSeconds >= slot.start && playheadSeconds < slot.end;
            const wide = (slot.duration / duration) * 100 > 4;
            return (
              <button
                key={slot.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => onSelectSlot(isSelected ? null : slot)}
                onDoubleClick={() => onSeek(slot.start / duration)}
                title={`${slot.sectionLabel} · ${fmt(slot.start)}–${fmt(slot.end)}\n${slot.label}${slot.kind === "generated" ? "\nGenerated shot" : ""}`}
                style={{ left: pct(slot.start), width: `calc(${(slot.duration / duration) * 100}% - 2px)` }}
                className={`group absolute top-[5px] h-[48px] overflow-hidden rounded-[5px] bg-ink-3 text-left outline-offset-[-1px] transition-[transform,box-shadow] duration-[var(--duration-fast)] ease-[var(--ease-out-soft)] ${
                  isSelected
                    ? "z-10 scale-y-[1.04] shadow-[0_0_0_1.5px_var(--color-accent)]"
                    : isLive
                      ? "shadow-[0_0_0_1px_var(--color-fg-2)]"
                      : "shadow-[0_0_0_1px_oklch(1_0_0/0.1)] hover:shadow-[0_0_0_1px_var(--color-fg-3)]"
                }`}
              >
                {slot.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- object URLs and gateway thumbnails
                  <img src={slot.thumbnailUrl} alt="" className={`h-full w-full object-cover ${isSelected || isLive ? "" : "opacity-80 group-hover:opacity-100"}`} />
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
              </button>
            );
          })}
          <span aria-hidden className="pointer-events-none absolute top-0 h-full w-px bg-fg-0/80" style={{ left: pct(playheadSeconds) }} />
        </div>
      ) : null}

      {selected && takes.length > 1 ? (
        <div aria-label={`Takes for ${selected.sectionLabel}`} className="relative flex h-11 items-center gap-1 border-b border-line bg-ink-1 px-1.5">
          <span aria-hidden className="absolute top-0 h-full w-px bg-accent/60" style={{ left: pct(selected.start) }} />
          <span className="shrink-0 pl-1 pr-2 font-mono text-[10px] uppercase tracking-[0.12em] text-fg-3">Takes</span>
          {takes.map((take) => (
            <button
              key={take.moment.id}
              type="button"
              disabled={take.selected}
              onClick={() => onSelectTake(selected.sectionId, take.moment.id)}
              title={`${take.caption}\n${take.reason}`}
              className={`group flex h-8 shrink-0 items-center gap-1.5 overflow-hidden rounded-[5px] pr-2 text-left transition-[box-shadow] ${
                take.selected ? "bg-ink-3 shadow-[0_0_0_1.5px_var(--color-accent)]" : "bg-ink-2 shadow-[0_0_0_1px_oklch(1_0_0/0.1)] hover:shadow-[0_0_0_1px_var(--color-fg-2)]"
              }`}
            >
              {take.frameUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- gateway thumbnails
                <img src={take.frameUrl} alt="" className="h-8 w-[52px] object-cover" />
              ) : (
                <span className="h-8 w-[52px] bg-ink-3" />
              )}
              <span className="font-mono text-[10.5px] text-fg-1">{take.scorePercent}%</span>
              <span className="max-w-[16ch] truncate text-[11px] text-fg-3 group-hover:text-fg-1">{take.moment.label}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="px-2 pb-1 pt-1">
        <SolidWaveform
          points={analysis.waveform}
          playhead={playhead}
          bpm={bpm}
          beatTimes={analysis.beats}
          durationSeconds={duration}
          beatsPerBar={4}
          accent="oklch(0.7 0.19 45)"
          height={slots.length ? 64 : 92}
          label={caption ?? ""}
          showRuler
          zoom={1}
          onSeek={onSeek}
        />
      </div>
    </section>
  );
}
