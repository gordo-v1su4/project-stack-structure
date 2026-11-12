import type { EditPlanPreviewSegment } from "./musicVideoProject";
import { shotTakeTargetKey } from "./shotTakeReview";

export type ReplacementTarget = { key: string; shotId?: string; label: string; start: number; end: number };
export type ReplacementMark = ReplacementTarget & { markedAt: string; note: string };
export type ReplacementReviewSnapshot = { projectId: string; revision: string | null; targets: ReplacementTarget[]; marks: ReplacementMark[] };
export type ReplacementOperation = { action: "mark" | "unmark" | "note"; keys: string[]; note?: string };

export function replacementTargets(projectId: string, segments: EditPlanPreviewSegment[]): ReplacementTarget[] {
  const rows = segments.filter(s => s.planSignature && s.timelineItemId && Number.isFinite(s.musicStart) && Number.isFinite(s.musicEnd)
    && s.musicStart >= 0 && s.musicEnd > s.musicStart).map(s => ({ key: shotTakeTargetKey(projectId, s), shotId: s.animaticShotId,
    label: s.label.slice(0, 160), start: s.musicStart, end: s.musicEnd }));
  return [...new Map(rows.map(row => [row.key, row])).values()];
}

/** Malformed records fail closed; they are never silently replaced with empty history. */
export function normalizeReplacementMarks(value: unknown): ReplacementMark[] {
  if (!Array.isArray(value) || value.length > 512) throw new Error("Invalid replacement review marks.");
  const keys = new Set<string>();
  return value.map(row => {
    if (!row || typeof row !== "object") throw new Error("Invalid replacement review mark.");
    const m = row as ReplacementMark;
    if (typeof m.key !== "string" || !m.key.length || m.key.length > 4096 || keys.has(m.key)
      || typeof m.label !== "string" || m.label.length > 160 || typeof m.note !== "string" || m.note.length > 2000
      || !Number.isFinite(m.start) || !Number.isFinite(m.end) || m.start < 0 || m.end <= m.start
      || typeof m.markedAt !== "string" || m.markedAt.length > 40 || !Number.isFinite(Date.parse(m.markedAt))
      || (m.shotId !== undefined && (typeof m.shotId !== "string" || !/^[\w-]{1,96}$/.test(m.shotId)))) throw new Error("Invalid replacement review mark.");
    keys.add(m.key);
    return { key: m.key, label: m.label, start: m.start, end: m.end, markedAt: m.markedAt, note: m.note, ...(m.shotId ? { shotId: m.shotId } : {}) };
  });
}

export function applyReplacementOperation(marks: ReplacementMark[], targets: ReplacementTarget[], operation: ReplacementOperation, now: string) {
  if (!operation || !["mark", "unmark", "note"].includes(operation.action) || !Array.isArray(operation.keys)
    || !operation.keys.length || operation.keys.length > 512 || operation.keys.some(key => typeof key !== "string" || key.length > 4096)
    || (operation.action === "note" && (typeof operation.note !== "string" || operation.note.length > 2000))) throw new Error("Invalid replacement review operation.");
  const current = new Map(targets.map(target => [target.key, target])), result = new Map(normalizeReplacementMarks(marks).map(mark => [mark.key, mark]));
  for (const key of new Set(operation.keys)) {
    if (operation.action === "mark") {
      const target = current.get(key);
      if (!target) throw new Error("The shot plan changed. Refresh the current plan before marking this shot.");
      if (!result.has(key)) result.set(key, { ...target, markedAt: now, note: "" });
    } else if (operation.action === "unmark") result.delete(key);
    else {
      const mark = result.get(key);
      if (!mark) throw new Error("The replacement mark no longer exists. Refresh review marks.");
      result.set(key, { ...mark, note: operation.note! });
    }
  }
  return normalizeReplacementMarks([...result.values()]);
}
