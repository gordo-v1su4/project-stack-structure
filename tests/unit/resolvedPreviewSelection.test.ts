import { describe, expect, test } from "bun:test";

import {
  selectPreviewCutRange,
  selectPreviewSectionRange,
  slicePreviewCutRange,
} from "@/components/studio/resolvedPreviewSelection";
import type { EditPlanPreviewSegment } from "@/components/studio/musicVideoProject";

const segments = [
  makeSegment("verse", 0),
  makeSegment("verse", 1),
  makeSegment("chorus", 2),
  makeSegment("chorus", 3),
  makeSegment("chorus", 4),
];

describe("resolved preview selection", () => {
  test("selects one cut and extends a contiguous range from its anchor", () => {
    const selected = selectPreviewCutRange({ current: null, index: 3, segmentCount: segments.length, extend: false });
    expect(selected).toEqual({ startIndex: 3, endIndex: 3 });
    expect(selectPreviewCutRange({ current: selected, index: 1, segmentCount: segments.length, extend: true })).toEqual({ startIndex: 1, endIndex: 3 });
  });

  test("expands the selected cut to its complete Story section", () => {
    expect(selectPreviewSectionRange(segments, { startIndex: 3, endIndex: 3 })).toEqual({ startIndex: 2, endIndex: 4 });
  });

  test("returns exactly the selected resolved cuts in timeline order", () => {
    expect(slicePreviewCutRange(segments, { startIndex: 1, endIndex: 3 }).map((segment) => segment.musicStart)).toEqual([1, 2, 3]);
  });
});

function makeSegment(sectionId: string, index: number): EditPlanPreviewSegment {
  return {
    videoUrl: `blob:${index}`,
    startTime: index,
    endTime: index + 1,
    musicStart: index,
    musicEnd: index + 1,
    sectionId,
    label: `${sectionId} ${index}`,
  };
}
