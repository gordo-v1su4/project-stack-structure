import { expect, test } from "bun:test";
import { applyReplacementOperation, normalizeReplacementMarks, replacementTargets } from "@/components/studio/replacementReview";
import { readReplacementReview, writeReplacementReview } from "@/lib/replacementReviewStore";
import { StudioProjectConflictError, type StudioJsonObjectStore } from "@/lib/studioProjectObjectStore";
import type { EditPlanPreviewSegment } from "@/components/studio/musicVideoProject";

const base: EditPlanPreviewSegment = { kind: "gap", videoUrl: "", startTime: 0, endTime: 2, musicStart: 10, musicEnd: 12, sectionId: "verse",
  timelineItemId: "animatic:A001", animaticShotId: "A001", planSignature: "plan", label: "A001" };
const targets = replacementTargets("project-1", [base, { ...base, timelineItemId: "animatic:A002", animaticShotId: "A002", musicStart: 12, musicEnd: 14 }]);
const now = "2026-11-12T00:00:00Z";

test("multi-shot marks and notes persist exact targets without touching media or approval", () => {
  const before = JSON.stringify(targets), marked = applyReplacementOperation([], targets, { action: "mark", keys: targets.map(row => row.key) }, now);
  expect(marked.map(row => row.shotId)).toEqual(["A001", "A002"]);
  const noted = applyReplacementOperation(marked, targets, { action: "note", keys: [targets[0].key], note: "Darker foreground" }, now);
  expect(noted[0].note).toBe("Darker foreground"); expect(marked[0].note).toBe("");
  expect(applyReplacementOperation(noted, targets, { action: "mark", keys: [targets[0].key] }, "2026-11-13T00:00:00Z")).toEqual(noted);
  expect(normalizeReplacementMarks(JSON.parse(JSON.stringify(noted)))).toEqual(noted);
  expect(JSON.stringify(targets)).toBe(before);
});

test("changed plan/reference/project keys cannot silently become current marks, while stale marks may be cleared", () => {
  const marked = applyReplacementOperation([], targets, { action: "mark", keys: [targets[0].key] }, now);
  const changed = replacementTargets("project-1", [{ ...base, planSignature: "changed" }]);
  expect(() => applyReplacementOperation(marked, changed, { action: "mark", keys: [targets[0].key] }, now)).toThrow("shot plan changed");
  expect(replacementTargets("other-project", [base])[0].key).not.toBe(targets[0].key);
  const binding = { shotId: "A001", bindingSha256: "b", reviewBindingSha256: "r", imageSha256: "first" };
  expect(replacementTargets("project-1", [{ ...base, animaticMotion: binding }])[0].key)
    .not.toBe(replacementTargets("project-1", [{ ...base, animaticMotion: { ...binding, imageSha256: "new" } }])[0].key);
  expect(applyReplacementOperation(marked, changed, { action: "unmark", keys: [targets[0].key] }, now)).toEqual([]);
  expect(() => normalizeReplacementMarks([{ ...marked[0], note: "x".repeat(2001) }])).toThrow();
  expect(() => normalizeReplacementMarks([marked[0], marked[0]])).toThrow();
});

test("durable review CAS preserves concurrent marks and uses an owner/project artifact independent of the film draft", async () => {
  const data = new Map<string, { value: unknown; revision: string }>(); let version = 0;
  const objects: StudioJsonObjectStore = { async read<T>(key: string) { return data.get(key) as { value: T; revision: string } | undefined ?? null; },
    async write(key, value, revision) {
      if ((data.get(key)?.revision ?? null) !== revision) throw new StudioProjectConflictError();
      const next = `"review-${++version}"`; data.set(key, { value: JSON.parse(JSON.stringify(value)), revision: next }); return next;
    } };
  expect(await readReplacementReview("github-test", "project-1", objects)).toEqual({ marks: [], revision: null });
  const a = await writeReplacementReview("github-test", "project-1", null, targets, { action: "mark", keys: [targets[0].key] }, objects, now);
  await expect(writeReplacementReview("github-test", "project-1", null, targets, { action: "mark", keys: [targets[1].key] }, objects, now)).rejects.toThrow("another window");
  expect(await readReplacementReview("github-test", "project-1", objects)).toEqual(a);
  const b = await writeReplacementReview("github-test", "project-1", a.revision, targets, { action: "mark", keys: [targets[1].key] }, objects, now);
  expect(b.marks).toHaveLength(2);
  expect([...data.keys()]).toEqual(["media-uploads/projects/github-test/project-1/review/replacement-marks.json"]);
  expect(await readReplacementReview("foreign", "project-1", objects)).toEqual({ marks: [], revision: null });
  const wrongOwner: StudioJsonObjectStore = { ...objects, async read<T>() { return { value: { version: 1, ownerId: "foreign", projectId: "project-1", marks: [] } as T, revision: '"foreign"' }; } };
  await expect(readReplacementReview("github-test", "project-1", wrongOwner)).rejects.toThrow("ownership");
});
