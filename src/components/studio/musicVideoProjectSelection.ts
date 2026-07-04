import {
  validateMusicVideoProject,
  type MusicVideoProject,
  type SemanticClipMatch,
  type StorySection,
  type TimelineItem,
} from "./musicVideoProject";

export type StorySectionCandidateSelection = {
  readonly sectionId: string;
  readonly momentId: string;
};

export function selectStorySectionCandidate(
  project: MusicVideoProject,
  selection: StorySectionCandidateSelection,
): MusicVideoProject {
  const selectedMatch = findSectionCandidateMatch(project, selection);
  if (!selectedMatch) return project;

  const storySections = project.storySections.map((section) =>
    section.id === selection.sectionId ? selectSectionMoment(section, selectedMatch) : section,
  );
  const editPlan = {
    ...project.editPlan,
    timelineItems: project.editPlan.timelineItems.map((item) =>
      item.sectionId === selection.sectionId ? selectTimelineItemMoment(item, selectedMatch) : item,
    ),
  };
  const nextProject = {
    ...project,
    storySections,
    editPlan,
  } satisfies MusicVideoProject;

  return {
    ...nextProject,
    reviewFindings: validateMusicVideoProject(nextProject),
  };
}

function findSectionCandidateMatch(
  project: MusicVideoProject,
  selection: StorySectionCandidateSelection,
): SemanticClipMatch | null {
  const section = project.storySections.find((candidate) => candidate.id === selection.sectionId);
  return section?.candidateMatches?.find((candidate) => candidate.momentId === selection.momentId) ?? null;
}

function selectSectionMoment(section: StorySection, match: SemanticClipMatch): StorySection {
  return {
    ...section,
    semanticMatch: match,
    videoMomentIds: [match.momentId, ...section.videoMomentIds.filter((momentId) => momentId !== match.momentId)],
  };
}

function selectTimelineItemMoment(item: TimelineItem, match: SemanticClipMatch): TimelineItem {
  return {
    ...item,
    videoMomentId: match.momentId,
    semanticMatch: match,
  };
}
