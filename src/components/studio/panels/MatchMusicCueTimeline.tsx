import { buildSongSectionReview } from "../songSectionReview";
import { fmt } from "../math";
import type { AdaptiveCueMap, OnsetMarker } from "../adaptiveCueMap";
import type { MusicVideoProject } from "../musicVideoProject";
import { clipSpineRange } from "../shell/spineViewport";
import { useSongRangeDrag } from "../useSongRangeDrag";
import type { SelectionGesture, SongRange } from "../reviewSelection";

export function MatchMusicCueTimeline({ cueMap, project, selectedChunkId, onSelectChunk, selectedRanges, focusedRange, visibleRange, onSelectRange, multiSelect, coverage }: {
  cueMap: AdaptiveCueMap; project: MusicVideoProject | null; selectedChunkId?: string; onSelectChunk?: (id: string) => void;
  selectedRanges?: SongRange[]; visibleRange?: SongRange | null; multiSelect?: boolean;
  focusedRange?: SongRange | null;
  onSelectRange?: (range: SongRange, gesture: SelectionGesture) => void;
  coverage?: Array<SongRange & { filled: boolean }>;
}) {
  const duration = cueMap.duration || project?.duration || 0;
  const view = visibleRange ?? { start: 0, end: Math.max(duration, 0.001) };
  const position = (time: number) => (time - view.start) / Math.max(0.001, view.end - view.start) * 100;
  const drag = useSongRangeDrag(view, cueMap.chunks, onSelectRange);
  if (!duration) {
    return <div className="rounded-[2px] border border-dashed border-[#202020] bg-[#070707] px-3 py-8 text-center text-[10px] uppercase tracking-[0.14em] text-[#4f4f4f]">Upload/analyze master song to show adaptive cut blocks.</div>;
  }

  // A merged lyric cut is rendered on the onset that absorbed it, not as a
  // separate marker at the lyric position.
  const mergedLyricsByOnsetKey = new Map<string, OnsetMarker>();
  for (const marker of cueMap.markers) {
    if (marker.kind === "lyric" && marker.mergedWithTime !== undefined) {
      mergedLyricsByOnsetKey.set(marker.mergedWithTime.toFixed(2), marker);
    }
  }

  const showSparseTranscriptWarning = shouldWarnForEarlySrtEnd(cueMap, duration);

  return (
    <div className="bg-ink-0">
      <div {...drag} aria-label="Timing blocks" className="relative h-24 overflow-hidden border-y border-line bg-ink-0">
        {buildSongSectionReview(project?.storySections ?? []).map((section) => {
          const geometry = clipSpineRange(section, view);
          if (!geometry) return null;
          const { left, width } = geometry;
          return (
            <div
              key={section.id}
              className="pointer-events-none absolute inset-y-0 border-r border-line bg-accent-tint/10"
              style={{ left: `${left}%`, width: `${width}%` }}
              title={`${section.label} · ${fmt(section.start)}–${fmt(section.end)}`}
            >
              <span className="absolute left-1 top-1 max-w-[140px] truncate text-[8px] uppercase tracking-[0.12em] text-[#8a4b20]">{section.label}</span>
            </div>
          );
        })}
        {cueMap.chunks.map((chunk) => {
          const geometry = clipSpineRange(chunk, view);
          if (!geometry) return null;
          const { left, width } = geometry;
          const isSelected = selectedRanges ? selectedRanges.some(r => r.end > chunk.start && r.start < chunk.end) : selectedChunkId === chunk.id;
          return (
            <button
              key={chunk.id}
              type="button"
              aria-label={`Suggested block ${chunk.start.toFixed(3)} to ${chunk.end.toFixed(3)} seconds`}
              aria-pressed={onSelectChunk || onSelectRange ? isSelected : undefined}
              aria-current={focusedRange && focusedRange.start >= chunk.start && focusedRange.start < chunk.end ? "true" : undefined}
              onClick={event => { onSelectChunk?.(chunk.id); onSelectRange?.(chunk, { extend: event.shiftKey, toggle: event.ctrlKey || event.metaKey || multiSelect }); }}
              className={`absolute inset-y-0 border text-left transition-colors hover:border-accent focus-visible:outline-2 focus-visible:outline-accent ${isSelected ? "border-fg-0 outline-2 outline-fg-0 -outline-offset-2" : "border-line"}`}
              style={{
                left: `${left}%`,
                width: `${width}%`,
                background: `color-mix(in srgb, var(--color-accent) ${(0.16 + chunk.strength * 0.58) * 100}%, transparent)`,
              }}
              title={`${chunk.sectionLabel} · ${fmt(chunk.start)}–${fmt(chunk.end)} · ${chunk.onsetCueCount} music · ${chunk.lyricCueCount} lyric`}
            >
              <span className="pointer-events-none absolute bottom-1 left-1 text-[7px] font-mono text-ink-0 opacity-70">{chunk.onsetCueCount}+{chunk.lyricCueCount}</span>
            </button>
          );
        })}
        {cueMap.markers.map((marker, index) => {
          if (marker.time < view.start || marker.time > view.end) return null;
          if (marker.kind === "lyric") {
            if (marker.mergedWithTime !== undefined) return null;
            return (
              <div
                key={`${marker.kind}-${index}-${marker.time}`}
                className="pointer-events-none absolute bottom-2 w-[2px]"
                style={{
                  left: `${position(marker.time)}%`,
                  height: "52%",
                  background: marker.active ? "#32c7d7" : "#1d3a3e",
                  opacity: marker.active ? 0.92 : 0.35,
                }}
                title={`SRT ${fmt(marker.time)} · ${marker.label ?? "phrase"}${marker.active ? " · added cut" : " · filtered"}${marker.text ? ` · ${marker.text}` : ""}`}
              />
            );
          }

          const absorbedLyric = mergedLyricsByOnsetKey.get(marker.time.toFixed(2));
          return (
            <div
              key={`${marker.kind}-${index}-${marker.time}`}
              className={`pointer-events-none absolute bottom-2 ${absorbedLyric ? "w-[2px]" : "w-px"}`}
              style={{
                left: `${position(marker.time)}%`,
                height: `${Math.max(12, marker.strength * 62)}%`,
                background: absorbedLyric ? "#75d767" : marker.active ? "#ff9a28" : "#333",
                opacity: marker.active || absorbedLyric ? 0.92 : 0.3,
              }}
              title={absorbedLyric
                ? `${marker.kind} ${fmt(marker.time)} + SRT ${fmt(absorbedLyric.time)} merged${absorbedLyric.text ? ` · ${absorbedLyric.text}` : ""}`
                : `${marker.kind} ${fmt(marker.time)} · strength ${marker.strength.toFixed(2)}${marker.active ? " · section-kept" : " · filtered"}`}
            />
          );
        })}
        {coverage?.map((range, index) => {
          const geometry = clipSpineRange(range, view);
          return geometry ? <span key={index} aria-hidden className={`pointer-events-none absolute bottom-0 h-1 border-r border-ink-0 ${range.filled ? "bg-ok" : "border-t border-dashed border-fg-3"}`}
            style={{ left: `${geometry.left}%`, width: `${geometry.width}%` }} /> : null;
        })}
      </div>
      {coverage ? <p className="mt-1 text-xs text-fg-3">Light outline = review selection. Footage coverage: solid green = selected video; dashed = gap. Orange blocks are musical timing suggestions.</p> : null}
      {showSparseTranscriptWarning ? (
        <div className="mt-2 rounded-[2px] border border-[#6f4a12] bg-[#120d05] px-2 py-1.5 text-[10px] leading-4 text-[#c07a3f]">
          SRT transcript ends at {fmt(cueMap.lyricLastTime)} of {fmt(duration)} — the vocal after that has no timed lyrics, so no cyan cuts can appear there. Re-run the transcription in Story for full-song lyric cuts.
        </div>
      ) : null}
      <div className="mt-2 flex items-center justify-between font-mono text-[9px] text-[#555]">
        <span>{fmt(view.start)}</span>
        <span>{cueMap.chunks.length} blocks · {cueMap.onsetActiveCount} active music cues · {cueMap.lyricActiveCount}/{cueMap.lyricCount} SRT cuts · {cueMap.lyricMergedCount} merged into music cues · {cueMap.beatCount} beats</span>
        <span>{fmt(view.end)}</span>
      </div>
    </div>
  );
}


export function shouldWarnForEarlySrtEnd(cueMap: Pick<AdaptiveCueMap, "lyricCount" | "lyricLastTime">, duration: number) {
  return duration > 0 && cueMap.lyricCount > 0 && cueMap.lyricLastTime < duration * 0.85;
}
