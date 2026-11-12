"use client";
import { Button } from "./ui";
import type { SongSelection, SongRange } from "./reviewSelection";

const time = (seconds: number) => {
  const ms = Math.round(seconds * 1000);
  return `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(3).padStart(6, "0")}`;
};

export function ReviewSelectionBar({ selection, multiSelect, onMultiSelect, onPlay, onClear, auditioning, auditionRanges, onFullSong, hideMultiSelect = false }: {
  selection: SongSelection | null; multiSelect: boolean; onMultiSelect: () => void; onPlay: () => void; onClear: () => void;
  auditioning: boolean; onFullSong: () => void;
  auditionRanges?: SongRange[];
  hideMultiSelect?: boolean;
}) {
  const ranges = selection?.ranges ?? [];
  const duration = ranges.reduce((sum, r) => sum + r.end - r.start, 0);
  const playedRanges = auditioning ? auditionRanges ?? ranges : ranges;
  const skipped = playedRanges.slice(1).flatMap((range, index) => range.start > playedRanges[index].end
    ? [`${time(playedRanges[index].end)}–${time(range.start)}`] : []);
  return <div aria-label="Review selection" className="flex shrink-0 flex-wrap items-center gap-2 rounded-md border border-line bg-ink-2 px-3 py-2 text-xs text-fg-2">
    {!hideMultiSelect ? <Button size="sm" aria-pressed={multiSelect} onClick={onMultiSelect}>Multi-select {multiSelect ? "on" : "off"}</Button> : null}
    <Button size="sm" disabled={!ranges.length} onClick={onPlay}>Play selection</Button>
    <Button size="sm" disabled={!ranges.length} onClick={onClear}>Clear selection</Button>
    {auditioning ? <Button size="sm" onClick={onFullSong}>Return to full cut</Button> : null}
    <span role="status">{ranges.length ? `${ranges.length} ${ranges.length === 1 ? "range" : "ranges"} · ${duration.toFixed(3)}s · ${ranges.slice(0, 6).map(r => `${time(r.start)}–${time(r.end)}`).join(", ")}${ranges.length > 6 ? ", …" : ""}` : "Click a cut or section; Shift extends, Ctrl/Cmd toggles, Shift-drag adds."}</span>
    {auditioning && auditionRanges?.length ? <span className="text-accent">Audition: {auditionRanges.slice(0, 6).map(r => `${time(r.start)}–${time(r.end)}`).join(", ")}{auditionRanges.length > 6 ? ", …" : ""}</span> : null}
    {ranges.length > 1 || auditioning ? <span className="text-fg-3">Selected ranges use matching song audio. Skipped intervals are comparison jumps, not cut transitions.</span> : null}
    {skipped.length ? <span className="text-fg-2">Skipped: {skipped.slice(0, 6).join(", ")}{skipped.length > 6 ? ", …" : ""}</span> : null}
  </div>;
}
