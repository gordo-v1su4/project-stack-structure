export type SpineZoomMode = "fit" | "section" | "selected";
export type SongTimeRange = { start: number; end: number };

/** View coordinates only: edit boundaries and transport positions stay in song time. */
export function getSpineViewport(duration: number, mode: SpineZoomMode, section?: SongTimeRange | null, selected?: SongTimeRange | null): SongTimeRange {
  const fullDuration = Math.max(0.001, duration);
  const target = mode === "section" ? section : mode === "selected" ? selected : null;
  if (!target || target.end <= target.start) return { start: 0, end: fullDuration };
  const padding = mode === "selected" ? Math.max(1, (target.end - target.start) * 0.5) : 0;
  const start = Math.max(0, Math.min(fullDuration, target.start - padding));
  const end = Math.max(start, Math.min(fullDuration, target.end + padding));
  return end > start ? { start, end } : { start: 0, end: fullDuration };
}

export function clipSpineRange(range: SongTimeRange, view: SongTimeRange) {
  const start = Math.max(range.start, view.start);
  const end = Math.min(range.end, view.end);
  if (end <= start) return null;
  const duration = Math.max(0.001, view.end - view.start);
  return { left: (start - view.start) / duration * 100, width: (end - start) / duration * 100 };
}
