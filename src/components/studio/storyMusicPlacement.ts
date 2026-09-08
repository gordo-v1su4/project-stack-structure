import { rankMomentsForSection } from "./semanticEditPlanner";
import { assessStoryMatch, isUsableStoryMatch } from "./storyMatchAssessment";
import type { MusicVideoProject, SemanticClipMatch, StoryPlanDraft, TimelineItem } from "./musicVideoProject";
import type { StoryAnchor, StoryTreatment } from "./storyTreatments";

export interface StoryMusicPlacement {
  id: string;
  momentId: string;
  requirementId: string;
  sectionId: string;
  start: number;
  end: number;
}

/** Presentation order is distinct from causal dependencies and source-clip chronology. */
export function suggestStoryMomentWindows(treatment: StoryTreatment, duration: number, cues: number[] = []) {
  const weights = treatment.anchors.map((anchor) => {
    const requested = anchor.requirements?.reduce((sum, requirement) => sum + (requirement.durationSeconds ?? 0), 0);
    if (requested) return requested;
    if (/opening|closing|final.image|establish/i.test(`${anchor.role} ${anchor.title}`)) return 1;
    if (/development|performance|climax|finale/i.test(`${anchor.role} ${anchor.title}`)) return 3;
    return 2;
  });
  const windows: Array<{ anchor: StoryAnchor; start: number; end: number }> = [];
  let cursor = 0;
  for (let index = 0; index < treatment.anchors.length;) {
    const anchor = treatment.anchors[index]!;
    if (anchor.songWindow) {
      const { start, end } = anchor.songWindow;
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < cursor - 0.025 || end <= start || end > duration) {
        throw new Error("Story moment timing overlaps or falls outside the song. Adjust the moment windows before using this story.");
      }
      windows.push({ anchor, start, end });
      cursor = end;
      index++;
      continue;
    }
    let nextExplicit = index + 1;
    while (nextExplicit < treatment.anchors.length && !treatment.anchors[nextExplicit]!.songWindow) nextExplicit++;
    const blockEnd = treatment.anchors[nextExplicit]?.songWindow?.start ?? duration;
    const blockStart = cursor;
    if (blockEnd <= blockStart) throw new Error("There is no song time between these fixed story moments. Adjust the timing or remove an extra moment.");
    const total = weights.slice(index, nextExplicit).reduce((sum, weight) => sum + weight, 0) || 1;
    let cumulative = 0;
    for (; index < nextExplicit; index++) {
      cumulative += weights[index]!;
      const desired = blockStart + (blockEnd - blockStart) * cumulative / total;
      // A snap cannot consume the next moment's nominal interval. Its fallback
      // boundary must remain ahead of this cursor even when nearby cues are sparse.
      const nextBoundary = blockStart + (blockEnd - blockStart) * (cumulative + (weights[index + 1] ?? 0)) / total;
      const candidates = cues.filter((cue) => cue > cursor + 0.1 && cue < Math.min(blockEnd, nextBoundary) && Math.abs(cue - desired) <= Math.min(3, duration * 0.03));
      const end = index === nextExplicit - 1 ? blockEnd : candidates.sort((left, right) => Math.abs(left - desired) - Math.abs(right - desired))[0] ?? desired;
      windows.push({ anchor: treatment.anchors[index]!, start: cursor, end });
      cursor = end;
    }
  }
  return windows;
}

export function mapStoryToMusic(treatment: StoryTreatment, sections: StoryPlanDraft[], duration: number, cues: number[] = []): StoryMusicPlacement[] {
  const windows = suggestStoryMomentWindows(treatment, duration, cues);
  return sections.flatMap((section) => {
    const start = section.start ?? 0;
    const end = section.end ?? start;
    const explicit = treatment.anchors.find((anchor) => anchor.id === treatment.sectionAnchorIds?.[section.id]);
    const intersections = explicit ? [{ anchor: explicit, start, end }] : windows;
    const placed = intersections.flatMap((window) => {
      const requirements = window.anchor.requirements?.length ? window.anchor.requirements : [{ id: `${window.anchor.id}:visual`, durationSeconds: undefined }];
      const total = requirements.reduce((sum, requirement) => sum + (requirement.durationSeconds || 1), 0);
      let cursor = window.start;
      return requirements.flatMap((requirement, index) => {
        const next = index === requirements.length - 1 ? window.end : cursor + (window.end - window.start) * (requirement.durationSeconds || 1) / total;
        const from = Math.max(start, cursor);
        const to = Math.min(end, next);
        cursor = next;
        return to > from + 0.025 ? [{ id: `${section.id}:${requirement.id}:${from.toFixed(3)}`, momentId: window.anchor.id, requirementId: requirement.id, sectionId: section.id, start: from, end: to }] : [];
      });
    }).sort((left, right) => left.start - right.start);
    const result: StoryMusicPlacement[] = [];
    let cursor = start;
    for (const placement of placed) {
      if (placement.start < cursor - 0.025) throw new Error("Story moment timing overlaps. Adjust the moment windows before using this story.");
      if (placement.start > cursor + 0.025) result.push({ id: `${section.id}:unassigned:${cursor}`, momentId: "unassigned", requirementId: "unassigned", sectionId: section.id, start: cursor, end: placement.start });
      result.push(placement);
      cursor = placement.end;
    }
    if (cursor < end - 0.025) result.push({ id: `${section.id}:unassigned:${cursor}`, momentId: "unassigned", requirementId: "unassigned", sectionId: section.id, start: cursor, end });
    return result;
  });
}

export function applyStoryDirectionToMusic(beats: StoryPlanDraft[], treatment: StoryTreatment): StoryPlanDraft[] {
  const duration = Math.max(0, ...beats.map((beat) => beat.end ?? 0));
  if (!duration) return beats;
  const placements = mapStoryToMusic(treatment, beats, duration);
  return beats.map((beat) => ({ ...beat, prompt: [...new Set(placements.filter((placement) => placement.sectionId === beat.id).map((placement) => {
    const anchor = treatment.anchors.find((candidate) => candidate.id === placement.momentId);
    return anchor ? `${anchor.title}: ${anchor.description}` : "Unassigned story window";
  }))].join(" Then ") }));
}

export function applyStoryCoverage(project: MusicVideoProject, treatment: StoryTreatment | null | undefined): MusicVideoProject {
  if (!treatment?.anchors.length) return project;
  const placements = mapStoryToMusic(treatment, project.storySections, project.duration, [...(project.song?.onsets ?? []), ...(project.song?.beats ?? [])]);
  const timelineItems: TimelineItem[] = placements.map((placement) => {
    const anchor = treatment.anchors.find((candidate) => candidate.id === placement.momentId) ?? { id: "unassigned", title: "Unassigned story window", description: "No story moment is assigned to this music window", resolution: null, selectedCandidateId: null } as StoryAnchor;
    const requirement = anchor.requirements?.find((candidate) => candidate.id === placement.requirementId);
    const description = requirement?.description || anchor.description;
    const section = project.storySections.find((candidate) => candidate.id === placement.sectionId)!;
    const ranked = rankMomentsForSection({ section: { id: placement.requirementId, label: anchor.title, prompt: description, start: placement.start, end: placement.end, requirements: requirement?.constraints }, moments: project.videoMoments.map((moment) => ({ ...moment, subjects: moment.captionMeta?.subjects, action: moment.captionMeta?.action, setting: moment.captionMeta?.setting, shotType: moment.captionMeta?.shotType })) });
    const resolution = requirement?.resolution !== undefined ? requirement.resolution : anchor.resolution;
    const selectedCandidateId = requirement?.resolution !== undefined ? requirement.selectedCandidateId : anchor.selectedCandidateId;
    const explicit = ranked.find((candidate) => candidate.momentId === selectedCandidateId);
    const accepted = resolution === "source" ? explicit : undefined;
    const selected = accepted && isUsableStoryMatch(assessStoryMatch({ requirementId: placement.requirementId, requirementText: description, constraints: requirement?.constraints, moment: accepted.moment })) ? accepted : undefined;
    const semanticMatch: SemanticClipMatch | undefined = selected ? { ...selected } : undefined;
    return {
      id: `story-item:${placement.id}`, sectionId: section.id, narrativeMomentId: anchor.id, requirementId: placement.requirementId,
      eligibleMomentIds: resolution === "source" ? ranked.map((candidate) => candidate.momentId) : [],
      lyricChunkIds: section.lyricChunkIds, videoMomentId: selected?.momentId ?? null,
      start: placement.start, end: placement.end, label: `${section.label} · ${anchor.title}`,
      prompt: `${resolution === "generate" ? "[GENERATE GAP] " : resolution === "omit" ? "[OMITTED MOMENT] " : ""}${description}`,
      semanticMatch, candidateMatches: ranked.map((candidate) => ({ ...candidate })), requirements: requirement?.constraints,
    };
  });
  const storySections = project.storySections.map((section) => {
    const items = timelineItems.filter((item) => item.sectionId === section.id);
    const ids = [...new Set(items.flatMap((item) => item.eligibleMomentIds ?? []))];
    return { ...section, prompt: items.map((item) => item.prompt).join(" Then "), videoMomentIds: ids, approvedMomentIds: undefined, semanticMatch: items[0]?.semanticMatch };
  });
  return { ...project, storySections, storyMusicPlacements: placements, placementPlan: undefined, editPlan: { ...project.editPlan, timelineItems } };
}
