import { normalizeSongRanges, type SongRange } from "./reviewSelection";

export function readReviewPreviewContext(search: string): { shotId?: string; ranges: SongRange[] } {
  const params = new URLSearchParams(search);
  const shot = params.get("shot") ?? "";
  const ranges = (params.get("ranges") ?? "").slice(0, 2048).split(",").slice(0, 32).flatMap(value => {
    const match = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(value);
    return match && Number(match[2]) <= 3600 ? [{ start: Number(match[1]), end: Number(match[2]) }] : [];
  });
  return { shotId: /^[\w-]{1,96}$/.test(shot) ? shot : undefined, ranges: normalizeSongRanges(ranges) };
}

export function reviewPreviewHref(projectId: string, context: { shotId?: string; ranges?: SongRange[] } = {}) {
  const params = new URLSearchParams();
  if (context.shotId && /^[\w-]{1,96}$/.test(context.shotId)) params.set("shot", context.shotId);
  const ranges = normalizeSongRanges(context.ranges ?? []).filter(r => r.end <= 3600).slice(0, 32);
  if (ranges.length) params.set("ranges", ranges.map(r => `${r.start}-${r.end}`).join(","));
  return `/preview/${encodeURIComponent(projectId)}${params.size ? `?${params}` : ""}`;
}
