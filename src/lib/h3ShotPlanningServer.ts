import { buildH3ShotPlanningInput, type H3ShotPlanningInput } from "@/components/studio/h3ShotPlanning";
import { planH3DraftWindows } from "@/components/studio/h3DraftPlan";
import { buildEditPlanPreviewSegments } from "@/components/studio/musicVideoProject";
import { buildStoryContentSignature } from "@/components/studio/storyTreatments";
import { buildStudioSourceContextSignature } from "@/components/studio/studioSourceContext";
import { validateSavedGenerationScope } from "./generationScopeServer";
import { readStudioProject, type SavedStudioProject } from "./studioProjectStore";
import { normalizeStudioOwnerSegment, normalizeStudioProjectId } from "./studioStoragePaths";
import { readH3ShotPlan, storeH3ShotPlan } from "./h3ShotPlanningStore";
import { generateH3ShotPlan } from "./h3ShotPlanningGateway";

export class H3ShotPlanningError extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}

type Dependencies = {
  read: typeof readStudioProject;
  validate: typeof validateSavedGenerationScope;
};

/** The caller must obtain ownerId from the authenticated session or owned
 * Trigger dispatch. No client-authored story, timing or source URL is accepted.
 */
export async function loadH3ShotPlanningContext(ownerId: string, projectId: string,
  expected: { planSignature: string; bindingSha256?: string },
  dependencies: Dependencies = { read: readStudioProject, validate: validateSavedGenerationScope },
): Promise<{ saved: SavedStudioProject; input: H3ShotPlanningInput }> {
  if (!ownerId || normalizeStudioOwnerSegment(ownerId) !== ownerId
    || !projectId || normalizeStudioProjectId(projectId) !== projectId) {
    throw new H3ShotPlanningError("Invalid owned planning project.", 400);
  }
  const saved = await dependencies.read(ownerId, projectId, { fresh: true });
  if (!saved || saved.project.ownerId !== ownerId || saved.project.id !== projectId) {
    throw new H3ShotPlanningError("Project not found.", 404);
  }
  const { storyState: story, musicVideoProject: project } = saved.draft;
  if (!project || !story.storyGenerated || !story.confirmedTreatmentId
    || story.confirmedTreatmentSnapshot?.id !== story.confirmedTreatmentId
    || story.confirmedTreatmentSnapshot.reconciliation?.status === "pending") {
    throw new H3ShotPlanningError("Confirm the story before preparing its shot directions.");
  }
  if (story.storyContentSignature
    && buildStoryContentSignature(story.confirmedTreatmentSnapshot, story.storyBeats) !== story.storyContentSignature) {
    throw new H3ShotPlanningError("The approved story changed. Confirm the current story first.");
  }
  if (story.confirmedSourceContextSignature && buildStudioSourceContextSignature({
    analysis: saved.draft.analysis ? { ...saved.draft.analysis, audioUrl: saved.draft.analysis.storageUrl ?? "" } : null,
    videoSources: saved.draft.videoSources.map(source => ({ ...source, videoUrl: source.storageUrl ?? "" })),
    referenceAssets: saved.draft.referenceAssets ?? [],
  }) !== story.confirmedSourceContextSignature) {
    throw new H3ShotPlanningError("The master, footage or references changed after story approval.");
  }
  const scope = await dependencies.validate(ownerId, saved);
  if (!scope || scope !== expected.planSignature) throw new H3ShotPlanningError("The confirmed cut plan changed.");
  // Use all saved placements as context, including existing footage. Empty
  // videoSources makes planning copies into gaps solely for the existing
  // bounded window splitter; it does not change or dispatch the actual edit.
  const scaffold = planH3DraftWindows(buildEditPlanPreviewSegments({ project, videoSources: [] }));
  const subjectNames = (saved.draft.referenceAssets ?? [])
    .filter(asset => asset.kind === "character" || asset.role.startsWith("character"))
    .map(asset => asset.displayName);
  let input: H3ShotPlanningInput;
  try { input = buildH3ShotPlanningInput({ project, projectId, segments: scaffold, subjectNames }); }
  catch { throw new H3ShotPlanningError("The current saved placements cannot supply a complete bounded shot planning context."); }
  if (input.planSignature !== scope || (expected.bindingSha256 !== undefined && input.bindingSha256 !== expected.bindingSha256)) {
    throw new H3ShotPlanningError("The story, cut plan or planning context changed.");
  }
  return { saved, input };
}

export type H3ShotPlanningReference = { ownerId: string; projectId: string; planSignature: string; bindingSha256: string };

/** Worker orchestration: canonical inputs are read again after inference. This
 * stores planning data only; it never submits video or changes a selected cut.
 */
export async function executeH3ShotPlanning(reference: H3ShotPlanningReference, dependencies: {
  load?: typeof loadH3ShotPlanningContext;
  read?: typeof readH3ShotPlan;
  store?: typeof storeH3ShotPlan;
  generate?: typeof generateH3ShotPlan;
} = {}) {
  const load = dependencies.load ?? loadH3ShotPlanningContext;
  const read = dependencies.read ?? readH3ShotPlan;
  const store = dependencies.store ?? storeH3ShotPlan;
  const generate = dependencies.generate ?? generateH3ShotPlan;
  const { ownerId, projectId, ...expected } = reference;
  const { input } = await load(ownerId, projectId, expected);
  const existing = await read(ownerId, projectId, input);
  if (existing) return existing;
  const result = await generate(input);
  // The named project may change during model inference. Never publish a plan
  // against stale story/reference/placement input, even if its JSON is valid.
  const current = await load(ownerId, projectId, expected);
  return store(ownerId, projectId, current.input, result);
}
