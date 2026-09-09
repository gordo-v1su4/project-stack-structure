import type { EditPlanPreviewSegment } from "./musicVideoProject";

type SongPart = { id: string; label: string; start: number; end: number };

export type ReviewSelection = { startIndex: number; endIndex: number; anchorStart: number; anchorEnd: number };

/** Shift extends from the original click, in either direction, including intervening holes. */
export function selectReviewRange(previous: ReviewSelection | null, startIndex: number, endIndex: number, extend: boolean): ReviewSelection {
  const anchorStart = extend && previous ? previous.anchorStart : startIndex;
  const anchorEnd = extend && previous ? previous.anchorEnd : endIndex;
  return { anchorStart, anchorEnd, startIndex: Math.min(anchorStart, startIndex), endIndex: Math.max(anchorEnd, endIndex) };
}

/** Display grouping only: source section IDs and exact song time remain authoritative. */
export function buildSongSectionReview(parts: SongPart[]) {
  const groups: Array<SongPart & { sectionIds: string[] }> = [];
  const counters = new Map<string, number>();
  for (const part of [...parts].sort((a, b) => a.start - b.start)) {
    const type = part.label.trim().match(/^(intro|pre[- ]chorus|verse|chorus|bridge|outro)(?:\s*\d+)?$/i)?.[1]?.toLowerCase().replace("pre chorus", "pre-chorus");
    const previous = groups.at(-1);
    if (type === "intro" && previous?.label === "Intro" && Math.abs(previous.end - part.start) < 0.001) {
      previous.end = part.end;
      previous.sectionIds.push(part.id);
      continue;
    }
    let label = part.label;
    if (type) {
      const count = (counters.get(type) ?? 0) + 1;
      counters.set(type, count);
      const title = type === "pre-chorus" ? "Pre-Chorus" : type[0]!.toUpperCase() + type.slice(1);
      label = type === "intro" || type === "outro" ? title : `${title} ${count}`;
    }
    groups.push({ ...part, label, sectionIds: [part.id] });
  }
  return groups;
}

export function buildRoughCutSections(segments: EditPlanPreviewSegment[], labels: Record<string, string>) {
  const parts = [...new Set(segments.map(segment => segment.sectionId))].map(id => {
    const cuts = segments.filter(segment => segment.sectionId === id);
    return { id, label: labels[id] ?? id, start: cuts[0]!.musicStart, end: cuts.at(-1)!.musicEnd };
  });
  return buildSongSectionReview(parts).map(part => ({ ...part,
    cuts: segments.flatMap((segment, index) => part.sectionIds.includes(segment.sectionId) ? [{ segment, index }] : []),
  }));
}
