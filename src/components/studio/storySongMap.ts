import { buildStorySections, type StoryPlanDraft } from "./musicVideoProject";
import { toTimedStoryDrafts } from "./storyStructure";
import type { BeatJoinAnalysis } from "./types";

/** Reanalysis replaces detected timing, never a deliberately edited song structure. */
export function reconcileDetectedStorySongMap(
  drafts: StoryPlanDraft[],
  analysis: BeatJoinAnalysis | null,
  duration: number,
): StoryPlanDraft[] {
  if (!analysis?.sections.length || duration <= 0) return drafts;
  const timed = drafts.filter(hasStoryTiming);
  if (timed.some((draft) => draft.timingSource !== "analysis")) return drafts;
  // Older saved renames did not change timingSource. Preserve those maps too;
  // the explicit “Reset to analysis” action remains available to reset them.
  if (timed.some((draft) => !isDetectedSectionLabel(draft.label))) return drafts;

  // buildStorySections otherwise treats even analysis-derived numeric windows
  // as authoritative and never consults the new analysis.
  const templates = drafts.map((draft) => ({ ...draft, start: undefined, end: undefined }));
  const detected = toTimedStoryDrafts(buildStorySections({ analysis, duration, drafts: templates }))
    .map((draft) => ({ ...draft, prompt: drafts.find((previous) => previous.id === draft.id)?.prompt ?? draft.prompt }));
  if (!detected.length || detected.every((draft) => !hasStoryTiming(draft))) return drafts;
  return JSON.stringify(detected) === JSON.stringify(drafts) ? drafts : detected;
}

function hasStoryTiming(draft: StoryPlanDraft) {
  return Number.isFinite(draft.start) && Number.isFinite(draft.end) && (draft.end ?? 0) > (draft.start ?? 0);
}

function isDetectedSectionLabel(label: string) {
  return /^(?:(?:intro|verse|pre-chorus|chorus|bridge|outro)(?: \d+)?|part [a-z]+)$/i.test(label.trim());
}
