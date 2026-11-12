import type { SlotEvidence } from "./shell/spineSlots";
import type { UploadedVideoSource } from "./types";

export type SourceSuggestionPreview = { videoUrl: string; start: number; end: number; label: string };

/** Resolve only a suggestion belonging to the currently inspected section. Never place it. */
export function resolveSourceSuggestionPreview(evidence: SlotEvidence, momentId: string, sources: UploadedVideoSource[]): SourceSuggestionPreview | null {
  const moment = evidence.takes.find(item => item.moment.id === momentId)?.moment;
  const source = moment && sources.find(source => source.id === moment.sourceClipId);
  if (!moment || !source?.videoUrl || !Number.isFinite(moment.start) || !Number.isFinite(moment.end)
    || moment.start < 0 || moment.end <= moment.start || !Number.isFinite(source.duration) || source.duration < moment.end) return null;
  return { videoUrl: source.videoUrl, start: moment.start, end: moment.end, label: moment.label };
}
