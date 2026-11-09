import { buildH3ShotPlanningInput, parseH3ShotPlanningResult, type H3ShotDirection, type H3ShotPlanningInput, type H3ShotPlanningResult } from "./h3ShotPlanning";
import { appendH3AestheticReferenceIds, h3RequestWindowKey, h3WindowKey, nextH3Attempt, planH3DraftWindows, selectH3ReferenceAssetIds } from "./h3DraftPlan";
import { buildEditPlanPreviewSegments, type EditPlanPreviewSegment, type MusicVideoProject } from "./musicVideoProject";
import { isH3JobTerminal, type H3GenerationJob, type H3GenerationRequest } from "./h3Generation";
import { identityPolicyChoiceForReferences } from "./issuedIdentityPolicy";
import type { ReferenceAsset } from "./referenceAssets";
import type { AestheticReferenceLibrary } from "./aestheticReferences";

export function buildH3DraftPlanningInput(projectId: string, project: MusicVideoProject, references: ReferenceAsset[]) {
  return buildH3ShotPlanningInput({ projectId, project,
    segments: planH3DraftWindows(buildEditPlanPreviewSegments({ project, videoSources: [] })),
    subjectNames: references.filter(asset => asset.kind === "character" || asset.role.startsWith("character")).map(asset => asset.displayName),
  });
}

export function previousH3WindowJob(projectId: string, window: EditPlanPreviewSegment, jobs: H3GenerationJob[]) {
  return jobs.filter(job => job.projectId === projectId && h3RequestWindowKey(job.request) === h3WindowKey(window))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

/** Keep one native camera/framing lead and put the reviewed physical states
 * into the rendered shot body. Actual H3 compilation/lint remains a separate
 * preflight; this adapter neither repairs prose nor certifies its quality. */
export function composePlannedH3ShotDirection(planned: H3ShotDirection) {
  const framing = /^(\[[^\]]+\]\s*[^.\n]+\.)\s*([\s\S]*)$/.exec(planned.direction);
  if (!framing) throw new Error("The planned shot needs its native camera and framing sentence before video generation.");
  const sentence = (value: string) => /[.!?]$/.test(value) ? value : `${value}.`;
  return `${framing[1].replace(/\s+/g, " ")} ${sentence(planned.entryState)} ${framing[2].trim()} ${sentence(planned.exitState)}`.trim();
}

/** Existing packets retain their own authority; partial overlays need an exact
 * scoped direction rather than replaying the enclosing completed action. */
export function buildPlannedH3DraftRequests(params: {
  projectId: string; windows: EditPlanPreviewSegment[]; jobs: H3GenerationJob[]; draftRevision: number;
  referenceAssets: ReferenceAsset[]; aestheticReferences?: AestheticReferenceLibrary;
  planningInput?: H3ShotPlanningInput; planningResult?: H3ShotPlanningResult; newIntent?: () => string;
}): H3GenerationRequest[] {
  const result = params.planningInput && params.planningResult ? parseH3ShotPlanningResult(params.planningResult, params.planningInput) : undefined;
  if (params.planningInput && params.planningInput.projectId !== params.projectId) throw new Error("Shot planning belongs to another project.");
  return params.windows.map(window => {
    const previous = previousH3WindowJob(params.projectId, window, params.jobs);
    if (previous && !isH3JobTerminal(previous)) return previous.request;
    if (previous) return { ...nextH3Attempt(previous, params.jobs, params.draftRevision), draftRevision: undefined };
    const planned = result?.directions.find(direction => direction.windowKey === h3WindowKey(window));
    if (!planned || params.planningInput?.planSignature !== window.planSignature) {
      throw new Error("This missing window has no exact current shot direction. Review its partial pickup or changed cut plan before generating.");
    }
    const prompt = composePlannedH3ShotDirection(planned);
    const referenceAssetIds = appendH3AestheticReferenceIds(selectH3ReferenceAssetIds(params.referenceAssets, prompt), params.aestheticReferences, window);
    return { projectId: params.projectId, planSignature: window.planSignature!, requirementId: window.requirementId,
      timelineItemId: window.timelineItemId, sectionId: window.sectionId, songStart: window.musicStart, songEnd: window.musicEnd,
      prompt, requestIntentId: params.newIntent ? params.newIntent() : crypto.randomUUID(), attempt: 0, referenceAssetIds,
      ...identityPolicyChoiceForReferences(params.referenceAssets, referenceAssetIds), draftRevision: undefined };
  });
}
