import {
  prepareApprovedPlacements,
  validateMusicVideoProject,
  type MusicVideoProject,
  type SemanticClipMatch,
  type StorySection,
  type TimelineItem,
} from "./musicVideoProject";
import { assessStoryMatch, isUsableStoryMatch } from "./storyMatchAssessment";
import { scoreMomentForSection } from "./semanticEditPlanner";
import type { UploadedVideoSource } from "./types";

export type StorySectionCandidateSelection = {
  readonly sectionId: string;
  readonly momentId: string;
  readonly timelineItemId?: string;
};

export function selectStorySectionCandidate(project: MusicVideoProject, selection: StorySectionCandidateSelection): MusicVideoProject {
  const sectionItems = project.editPlan.timelineItems.filter((item) => item.sectionId === selection.sectionId);
  // A legacy section-wide click is ambiguous when a music section hosts multiple requirements.
  const item = selection.timelineItemId ? sectionItems.find((candidate) => candidate.id === selection.timelineItemId)
    : sectionItems.length === 1 ? sectionItems[0] : undefined;
  if (!item) return project;
  const moment = project.videoMoments.find((candidate) => candidate.id === selection.momentId);
  const section = project.storySections.find((candidate) => candidate.id === selection.sectionId);
  const listed = item.candidateMatches?.some((candidate) => candidate.momentId === selection.momentId)
    ?? item.eligibleMomentIds?.includes(selection.momentId)
    ?? (sectionItems.length === 1 && section?.candidateMatches?.some((candidate) => candidate.momentId === selection.momentId));
  if (!moment || !listed) return project;
  const evidence = { ...moment, subjects: moment.captionMeta?.subjects, action: moment.captionMeta?.action,
    setting: moment.captionMeta?.setting, shotType: moment.captionMeta?.shotType };
  const assessment = assessStoryMatch({ requirementId: item.requirementId ?? item.id, requirementText: item.prompt, constraints: item.requirements, moment: evidence });
  if (!isUsableStoryMatch(assessment)) return project;
  const scored = scoreMomentForSection({ section: { ...item, requirements: item.requirements }, moment: evidence });
  const selectedMatch: SemanticClipMatch = { momentId: moment.id, score: scored.score, semanticScore: scored.semanticScore,
    lyricCaptionScore: scored.lyricCaptionScore, actionIntentScore: scored.actionIntentScore, durationFitScore: scored.durationFitScore,
    motionContinuityScore: scored.motionContinuityScore, motionEnergyScore: scored.motionEnergyScore,
    colorContinuityScore: scored.colorContinuityScore, repetitionPenalty: scored.repetitionPenalty, reasons: scored.reasons, assessment };
  const nextProject: MusicVideoProject = {
    ...project,
    storySections: project.storySections.map((current) => current.id === selection.sectionId && sectionItems.length === 1 ? selectSectionMoment(current, selectedMatch) : current),
    editPlan: { ...project.editPlan, timelineItems: project.editPlan.timelineItems.map((current) => current.id === item.id ? selectTimelineItemMoment(current, selectedMatch) : current) },
  };
  // Retain the previous placement plan as history; its signature is now stale until prepared.
  return { ...nextProject, reviewFindings: validateMusicVideoProject(nextProject) };
}

function selectSectionMoment(section: StorySection, match: SemanticClipMatch): StorySection {
  return { ...section, semanticMatch: match,
    videoMomentIds: [match.momentId, ...section.videoMomentIds.filter((momentId) => momentId !== match.momentId)] };
}

function selectTimelineItemMoment(item: TimelineItem, match: SemanticClipMatch): TimelineItem {
  return { ...item, videoMomentId: match.momentId, semanticMatch: match,
    eligibleMomentIds: [match.momentId, ...(item.eligibleMomentIds ?? []).filter((id) => id !== match.momentId)] };
}

/** A pure proposal; applying it requires the separate user action in Match. */
export function proposeBestEffortCoverage(project: MusicVideoProject, videoSources: UploadedVideoSource[]) {
  const faithful = prepareApprovedPlacements({ project, videoSources, editSettings: project.placementPlan?.settings, policy: "faithful" });
  const proposed = prepareApprovedPlacements({ project, videoSources, editSettings: project.placementPlan?.settings, policy: "best-effort" });
  const used = new Map<number, Array<[number, number]>>();
  const momentsById = new Map(project.videoMoments.map((moment) => [moment.id, moment]));
  let repeatedSeconds = 0;
  let repeatedCuts = 0;
  for (const placement of proposed.placementPlan?.placements ?? []) {
    if (placement.kind !== "source" || !placement.momentId) continue;
    const sourceId = momentsById.get(placement.momentId)?.sourceClipId;
    if (sourceId === undefined) continue;
    const prior = used.get(sourceId) ?? [];
    const intersections = prior.map(([start, end]): [number, number] => [Math.max(start, placement.sourceStart), Math.min(end, placement.sourceEnd)])
      .filter(([start, end]) => end > start).sort((a, b) => a[0] - b[0]);
    let overlap = 0;
    let coveredEnd = -Infinity;
    for (const [start, end] of intersections) { overlap += Math.max(0, end - Math.max(start, coveredEnd)); coveredEnd = Math.max(coveredEnd, end); }
    repeatedSeconds += overlap;
    if (overlap > 0.025) repeatedCuts++;
    prior.push([placement.sourceStart, placement.sourceEnd]); used.set(sourceId, prior);
  }
  const gapDuration = (candidate: MusicVideoProject) => (candidate.placementPlan?.placements ?? [])
    .filter((placement) => placement.kind === "gap").reduce((sum, placement) => sum + placement.songEnd - placement.songStart, 0);
  return { faithful, proposed, repeatedSeconds, repeatedCuts, faithfulGapSeconds: gapDuration(faithful), remainingGapSeconds: gapDuration(proposed),
    omittedMoments: 0, unresolvedNarrativeCount: proposed.editPlan.timelineItems.filter((item) => !item.videoMomentId).length };
}
