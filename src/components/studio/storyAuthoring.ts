import { hydrateTreatmentCoverage, parseGeneratedTreatment, type StoryAnchor, type StoryTreatment, type StoryTreatmentState } from "./storyTreatments";
import { mapStoryToMusic } from "./storyMusicPlacement";
import type { StoryPlanDraft, VideoMoment } from "./musicVideoProject";

export function describeStoryCoverage(treatment: StoryTreatment): string {
  const missing = treatment.anchors.filter(anchor => anchor.coverage === "missing").length;
  const uncertain = treatment.anchors.filter(anchor => anchor.coverage === "weak").length;
  return [missing ? `${missing} moments need footage` : "", uncertain ? `${uncertain} uncertain matches need review` : ""]
    .filter(Boolean).join(" · ") || "Footage found for all moments";
}

/** Validate new model output, while persisted legacy treatments remain readable. */
export function validateStoryAuthoring(treatment: StoryTreatment) {
  const elements = treatment.loglineElements;
  if (!elements || Object.values(elements).some(value => !value.trim())) throw new Error("Story response is missing one of the five logline elements.");
  const sentences = treatment.synopsis.match(/[^.!?]+[.!?]+(?:["']|$|\s)/g) ?? [];
  if (sentences.length !== 3) throw new Error("The story hook must contain three short sentences.");
  if (treatment.anchors.some(anchor => !anchor.role || !anchor.requirements?.length)) throw new Error("Each story moment needs a narrative purpose and explicit shot requirements.");
  return treatment;
}

export function markStoryEdited(original: StoryTreatment, draft: StoryTreatment): StoryTreatment {
  const proseChanged = original.logline !== draft.logline || original.synopsis !== draft.synopsis || JSON.stringify(original.loglineElements) !== JSON.stringify(draft.loglineElements);
  const momentsChanged = JSON.stringify(original.anchors.map(authoringAnchor)) !== JSON.stringify(draft.anchors.map(authoringAnchor));
  const changed = proseChanged || momentsChanged || original.title !== draft.title;
  return {
    ...draft,
    revision: changed ? (original.revision ?? 0) + 1 : original.revision,
    reconciliation: proseChanged || momentsChanged
      ? { status: "pending", note: "Review an updated moment plan before using this story." }
      : draft.reconciliation,
  };
}

function authoringAnchor(anchor: StoryAnchor) {
  return { id: anchor.id, title: anchor.title, description: anchor.description, purpose: anchor.purpose, role: anchor.role, requirements: anchor.requirements?.map(requirementAuthoring), causalDependencies: anchor.causalDependencies, optional: anchor.optional };
}

function requirementAuthoring(requirement: NonNullable<StoryAnchor["requirements"]>[number]) {
  return { id: requirement.id, momentId: requirement.momentId, description: requirement.description, optional: requirement.optional, durationSeconds: requirement.durationSeconds, constraints: requirement.constraints };
}

export function mergeStoryRevision(original: StoryTreatment, output: unknown, moments: VideoMoment[]): StoryTreatment {
  const record = output as { treatment?: unknown; treatments?: unknown[] };
  if (!record?.treatment && record?.treatments?.length !== 1) throw new Error("A targeted revision must return exactly one treatment.");
  const generated = parseGeneratedTreatment(record?.treatment ?? record?.treatments?.[0]);
  const revised = hydrateTreatmentCoverage([{ ...generated, id: original.id, kind: original.kind }], moments)[0];
  validateStoryAuthoring(revised);
  const anchors = revised.anchors.map(anchor => {
    const previous = original.anchors.find(item => item.id === anchor.id);
    // Only exact unchanged requirements keep an earlier decision. Reordering alone is safe.
    const requirements = anchor.requirements?.map(requirement => {
      const previousRequirement = previous?.requirements?.find(item => item.id === requirement.id);
      if (!previousRequirement || JSON.stringify(requirementAuthoring(previousRequirement)) !== JSON.stringify(requirementAuthoring(requirement))) return requirement;
      return { ...requirement, resolution: previousRequirement.resolution, selectedCandidateId: previousRequirement.selectedCandidateId };
    });
    if (!previous || JSON.stringify(authoringAnchor(previous)) !== JSON.stringify(authoringAnchor(anchor))) return { ...anchor, requirements };
    return { ...anchor, requirements, resolution: previous.resolution, selectedCandidateId: previous.selectedCandidateId, songWindow: previous.songWindow };
  });
  const ids = new Set(anchors.map(anchor => anchor.id));
  return {
    ...revised, anchors, revision: (original.revision ?? 0) + 1,
    reconciliation: { status: "current", note: "Prose and story moments reconciled together; review before using." },
    sectionAnchorIds: Object.fromEntries(Object.entries(original.sectionAnchorIds ?? {}).filter(([, id]) => ids.has(id))),
  };
}

export function describeStoryRevision(previous: StoryTreatment, next: StoryTreatment): string[] {
  const changes: string[] = [];
  if (previous.logline !== next.logline) changes.push("Updated logline");
  if (previous.synopsis !== next.synopsis) changes.push("Updated story hook");
  next.anchors.forEach((anchor, index) => {
    const prior = previous.anchors.find(item => item.id === anchor.id);
    if (!prior) changes.push(`Added ${anchor.title}`);
    else if (JSON.stringify(authoringAnchor(prior)) !== JSON.stringify(authoringAnchor(anchor))) changes.push(`Revised ${anchor.title}`);
    else if (previous.anchors.indexOf(prior) !== index) changes.push(`Moved ${anchor.title}`);
  });
  previous.anchors.filter(anchor => !next.anchors.some(item => item.id === anchor.id)).forEach(anchor => changes.push(`Removed ${anchor.title}`));
  return changes.length ? changes : ["Story and moments agree; no text changes needed"];
}

/** A reply may only apply to the exact input snapshot that dispatched it. */
export function createStoryRequestGuard() {
  let revision = 0;
  return {
    invalidate() { revision += 1; },
    begin() { revision += 1; return revision; },
    isCurrent(token: number) { return token === revision; },
  };
}

export function storyAuthoringInputSignature(input: unknown) {
  // Kept as a canonical snapshot locally; never used as a security hash.
  return JSON.stringify(input);
}

export function getStoryTimingError(treatment: StoryTreatment, sections: StoryPlanDraft[], duration?: number, cues: number[] = []): string | null {
  try {
    if (treatment.anchors.some(anchor => anchor.songWindow && (!Number.isFinite(anchor.songWindow.start) || !Number.isFinite(anchor.songWindow.end) || anchor.songWindow.start < 0 || anchor.songWindow.end <= anchor.songWindow.start || (duration !== undefined && anchor.songWindow.end > duration)))) throw new Error("Each story window must start at or after zero and end later, within the song duration.");
    if (duration) mapStoryToMusic(treatment, sections, duration, cues);
    return null;
  } catch (caught) { return caught instanceof Error ? caught.message : "Story moment timing is invalid."; }
}

/** Inspection is a detached draft; abandoning it has no project write. */
export function beginStoryInspection(treatment: StoryTreatment): StoryTreatment {
  return structuredClone(treatment);
}

export function buildStoryDraftCommit(state: StoryTreatmentState, next: StoryTreatment, select = false) {
  const changed = JSON.stringify(state.treatments.find(treatment => treatment.id === next.id)) !== JSON.stringify(next);
  const invalidatesConfirmed = changed && next.id === state.confirmedTreatmentId;
  const patch: Partial<StoryTreatmentState> = {
    treatments: state.treatments.map(treatment => treatment.id === next.id ? next : treatment),
    ...(select ? { selectedTreatmentId: next.id } : {}),
    ...(invalidatesConfirmed ? { confirmedTreatmentId: null, confirmedTreatmentSnapshot: null, storyContentSignature: null } : {}),
  };
  return { patch, invalidatesConfirmed };
}
