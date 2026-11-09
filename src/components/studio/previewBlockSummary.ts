import type { PreviewSegment } from "./previewPlayer";

export function formatTimelineBlockCount(count: number): string {
  return `${count} timeline ${count === 1 ? "block" : "blocks"}`;
}

/** Preview entries can contain several camera cuts, or represent missing footage. */
export function describePreviewBlocks(segments: readonly Pick<PreviewSegment, "kind">[]): string {
  const gaps = segments.filter(segment => segment.kind === "gap").length;
  return `${formatTimelineBlockCount(segments.length)}${gaps ? ` · ${gaps} ${gaps === 1 ? "gap" : "gaps"}` : ""}`;
}
