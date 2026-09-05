"use client";

import { fmt } from "../math";
import { SolidWaveform } from "../SolidWaveform";
import type { BeatJoinAnalysis } from "../types";

type BeatSpineProps = {
  analysis: BeatJoinAnalysis;
  bpm: number;
  /** 0..1 position of the playhead on the master song. */
  playhead: number;
  onSeek: (playhead: number) => void;
  /** Act-specific caption on the right, e.g. "Match · sections". */
  caption: string | null;
};

/**
 * The music is the spine. One beat-grid timeline on every act after Ingest:
 * section names in editorial type, the waveform with the beat ruler, and a
 * playhead the transport bar drives. Slots and take lanes land here in
 * Phase B.
 */
export function BeatSpine({ analysis, bpm, playhead, onSeek, caption }: BeatSpineProps) {
  const duration = Math.max(analysis.duration, 0.001);
  return (
    <section aria-label="Beat spine" className="vt-spine shrink-0 rounded-[10px] border border-line bg-ink-1">
      <div className="relative h-6 overflow-hidden border-b border-line">
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
      <div className="px-2 pb-1 pt-1">
        <SolidWaveform
          points={analysis.waveform}
          playhead={playhead}
          bpm={bpm}
          beatTimes={analysis.beats}
          durationSeconds={duration}
          beatsPerBar={4}
          accent="oklch(0.7 0.19 45)"
          height={92}
          label={caption ?? ""}
          showRuler
          zoom={1}
          onSeek={onSeek}
        />
      </div>
    </section>
  );
}
