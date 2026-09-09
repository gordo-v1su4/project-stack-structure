import { expect, test } from "bun:test";
import { buildSongSectionReview, buildRoughCutSections, selectReviewRange } from "@/components/studio/songSectionReview";
import type { EditPlanPreviewSegment } from "@/components/studio/musicVideoProject";

test("Shift selection includes intervening shots and holes, extends backwards and shrinks from the original anchor", () => {
  const verse2 = selectReviewRange(null, 8, 11, false);
  const bothVerses = selectReviewRange(verse2, 5, 7, true);
  expect(bothVerses).toEqual({ startIndex: 5, endIndex: 11, anchorStart: 8, anchorEnd: 11 });
  const throughChorus = selectReviewRange(bothVerses, 15, 19, true);
  expect(throughChorus.startIndex).toBe(8);
  expect(throughChorus.endIndex).toBe(19);
  expect(selectReviewRange(throughChorus, 13, 13, false)).toEqual({ startIndex: 13, endIndex: 13, anchorStart: 13, anchorEnd: 13 });
});

test("one Intro and continuous numbering retain distinct musical boundaries and IDs", () => {
  const names = ["intro", "Intro 2", "verse", "Verse 2", "Verse", "chorus", "chorus", "verse", "verse", "chorus", "chorus", "bridge", "bridge", "chorus"];
  const parts = names.map((label, index) => ({ id: `p${index}`, label, start: index === 0 ? 0 : index === 1 ? .21 : (index - 1) * 15, end: index === 0 ? .21 : index * 15 }));
  const before = JSON.stringify(parts);
  const groups = buildSongSectionReview(parts);
  expect(groups.map(group => group.label)).toEqual(["Intro", "Verse 1", "Verse 2", "Verse 3", "Chorus 1", "Chorus 2", "Verse 4", "Verse 5", "Chorus 3", "Chorus 4", "Bridge 1", "Bridge 2", "Chorus 5"]);
  expect(groups[0]!.sectionIds).toEqual(["p0", "p1"]);
  expect(groups[0]!.start).toBe(0);
  expect(groups[0]!.end).toBe(15);
  expect(groups.flatMap(group => group.sectionIds)).toEqual(parts.map(part => part.id));
  expect(JSON.stringify(parts)).toBe(before);
});

test("review grouping keeps shot indexes for edits and combined Intro playback", () => {
  const segments = [
    { sectionId: "i1", musicStart: 0, musicEnd: .21 },
    { sectionId: "i2", musicStart: .21, musicEnd: 5 },
    { sectionId: "i2", musicStart: 5, musicEnd: 15 },
    { sectionId: "v1", musicStart: 15, musicEnd: 30 },
  ] as EditPlanPreviewSegment[];
  const groups = buildRoughCutSections(segments, { i1: "Intro 1", i2: "Intro 2", v1: "Verse" });
  expect(groups[0]!.cuts.map(cut => cut.index)).toEqual([0, 1, 2]);
  expect(groups[1]!.cuts[0]!.index).toBe(3);
  expect(groups[1]!.label).toBe("Verse 1");
});
