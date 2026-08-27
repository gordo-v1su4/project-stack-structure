import type { EditPlanPreviewSegment } from "./musicVideoProject";

export type PreviewCutRange = {
  startIndex: number;
  endIndex: number;
};

export function selectPreviewCutRange(params: {
  current: PreviewCutRange | null;
  index: number;
  segmentCount: number;
  extend: boolean;
}): PreviewCutRange | null {
  if (params.segmentCount <= 0) return null;
  const index = clampIndex(params.index, params.segmentCount);
  if (!params.extend || !params.current) return { startIndex: index, endIndex: index };

  const anchor = clampIndex(params.current.startIndex, params.segmentCount);
  return {
    startIndex: Math.min(anchor, index),
    endIndex: Math.max(anchor, index),
  };
}

export function selectPreviewSectionRange(
  segments: EditPlanPreviewSegment[],
  selectedRange: PreviewCutRange | null,
): PreviewCutRange | null {
  if (!segments.length || !selectedRange) return null;
  const selectedIndex = clampIndex(selectedRange.startIndex, segments.length);
  const sectionId = segments[selectedIndex]?.sectionId;
  if (!sectionId) return null;

  const indexes = segments.flatMap((segment, index) => segment.sectionId === sectionId ? [index] : []);
  if (!indexes.length) return null;
  return { startIndex: indexes[0]!, endIndex: indexes[indexes.length - 1]! };
}

export function slicePreviewCutRange<T>(segments: T[], selectedRange: PreviewCutRange | null): T[] {
  if (!selectedRange || !segments.length) return segments;
  const startIndex = clampIndex(Math.min(selectedRange.startIndex, selectedRange.endIndex), segments.length);
  const endIndex = clampIndex(Math.max(selectedRange.startIndex, selectedRange.endIndex), segments.length);
  return segments.slice(startIndex, endIndex + 1);
}

function clampIndex(index: number, segmentCount: number) {
  return Math.min(Math.max(0, Math.trunc(index)), Math.max(0, segmentCount - 1));
}
