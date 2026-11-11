import type { EditPlanPreviewSegment } from "./musicVideoProject";
import type { PreviewSegment } from "./previewPlayer";

export type SongRange = { start: number; end: number };
export type SelectionGesture = { extend?: boolean; toggle?: boolean; add?: boolean };
export type SongSelection = { ranges: SongRange[]; anchor: SongRange };

export function normalizeSongRanges(ranges: SongRange[]): SongRange[] {
  const sorted = ranges.filter(r => Number.isFinite(r.start) && Number.isFinite(r.end) && r.start >= 0 && r.end > r.start)
    .map(r => ({ start: r.start, end: r.end })).sort((a, b) => a.start - b.start);
  const result: SongRange[] = [];
  for (const range of sorted) {
    const last = result.at(-1);
    if (last && range.start <= last.end + 1e-6) last.end = Math.max(last.end, range.end);
    else result.push(range);
  }
  return result;
}

export function rangeIsSelected(ranges: SongRange[], target: SongRange) {
  return ranges.some(r => r.start <= target.start + 1e-6 && r.end >= target.end - 1e-6);
}

/** Plain click replaces, Shift extends from the anchor, modifier/multi-select toggles. */
export function selectSongRange(previous: SongSelection | null, target: SongRange, gesture: SelectionGesture = {}): SongSelection | null {
  if (!normalizeSongRanges([target]).length) return previous;
  const anchor = gesture.extend && previous ? previous.anchor : { start: target.start, end: target.end };
  const next = gesture.extend ? { start: Math.min(anchor.start, target.start), end: Math.max(anchor.end, target.end) } : target;
  let ranges: SongRange[];
  if (gesture.toggle && !gesture.extend && previous && rangeIsSelected(previous.ranges, next)) {
    ranges = previous.ranges.flatMap(r => r.end <= next.start || r.start >= next.end ? [r] : [
      ...(r.start < next.start ? [{ start: r.start, end: next.start }] : []),
      ...(r.end > next.end ? [{ start: next.end, end: r.end }] : []),
    ]);
  } else ranges = normalizeSongRanges([...(gesture.add || gesture.toggle ? previous?.ranges ?? [] : []), next]);
  return ranges.length ? { ranges, anchor } : null;
}

/** Build an audition only. Never modify source trims, placement plans or review receipts. */
export function buildSelectedPlayback(segments: EditPlanPreviewSegment[], ranges: SongRange[]): EditPlanPreviewSegment[] {
  const missing = (start: number, end: number): EditPlanPreviewSegment => ({ kind: "gap", videoUrl: "", useClipAudio: false,
    label: "Missing footage", sectionId: "review-gap", musicStart: start, musicEnd: end, startTime: 0, endTime: end - start,
    gapReason: "No selected footage covers this song window." });
  return normalizeSongRanges(ranges).flatMap(range => {
    const pieces = segments.flatMap(segment => {
    const start = Math.max(range.start, segment.musicStart), end = Math.min(range.end, segment.musicEnd);
    if (end <= start) return [];
    const gap = segment.kind === "gap" || !segment.videoUrl;
    const sourceStart = gap ? 0 : segment.startTime + start - segment.musicStart;
    const available = gap ? end - start : Math.max(0, Math.min(end - start, segment.endTime - sourceStart));
    const result: EditPlanPreviewSegment[] = [];
    if (available > 1e-6) result.push({ ...segment, musicStart: start, musicEnd: start + available,
      startTime: sourceStart, endTime: sourceStart + available });
    if (end - start - available > 1e-6) result.push({ ...segment, kind: "gap", videoUrl: "", useClipAudio: false,
      musicStart: start + available, musicEnd: end, startTime: 0, endTime: end - start - available,
      gapReason: "Selected window exceeds available source footage." });
    return result;
    }).sort((a, b) => a.musicStart - b.musicStart);
    const result: EditPlanPreviewSegment[] = [];
    let cursor = range.start;
    for (const piece of pieces) {
      if (piece.musicStart > cursor + 1e-6) result.push(missing(cursor, piece.musicStart));
      result.push(piece);
      cursor = Math.max(cursor, piece.musicEnd);
    }
    if (cursor < range.end - 1e-6) result.push(missing(cursor, range.end));
    return result;
  });
}

/** Convert a master-song position into the local clock of a selected-ranges audition. */
export function previewOffsetAtSongTime(segments: PreviewSegment[], songTime: number): number | null {
  if (!Number.isFinite(songTime)) return null;
  let before = 0;
  for (const segment of segments) {
    const duration = segment.endTime - segment.startTime;
    if (Number.isFinite(segment.musicStart) && songTime >= segment.musicStart! && songTime < segment.musicStart! + duration) {
      return before + songTime - segment.musicStart!;
    }
    before += duration;
  }
  const last = segments.at(-1);
  return last && Number.isFinite(last.musicEnd) && Math.abs(songTime - last.musicEnd!) < 1e-6 ? before : null;
}
