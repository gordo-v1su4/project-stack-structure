import type { H3ShotPlanningInput } from "@/components/studio/h3ShotPlanning";
import { buildH3ResolvedPlanningScaffold } from "@/components/studio/h3ResolvedPlanningScaffold";
import { buildH3DraftPlanningInput } from "@/components/studio/h3PlannedDraftRequests";
import { withCurrentReferenceIdentity } from "@/components/studio/currentReferenceIdentity";
import type { SelectedFootageEvidence } from "@/components/studio/selectedFootageEvidence";
import { buildStoryContentSignature } from "@/components/studio/storyTreatments";
import { buildStudioSourceContextSignature } from "@/components/studio/studioSourceContext";
import { recordGenerationScopeBaseline, validateSavedGenerationScope } from "./generationScopeServer";
import { readStudioProject, type SavedStudioProject } from "./studioProjectStore";
import { normalizeStudioOwnerSegment, normalizeStudioProjectId } from "./studioStoragePaths";
import { readH3ShotPlan, storeH3ShotPlan } from "./h3ShotPlanningStore";
import { generateH3ShotPlan } from "./h3ShotPlanningGateway";
import { resolveCanonicalSelectedFootageEvidence } from "./selectedFootageEvidenceServer";

export class H3ShotPlanningError extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}

type Dependencies = {
  read: typeof readStudioProject;
  validate: typeof validateSavedGenerationScope;
  baseline?: typeof recordGenerationScopeBaseline;
  selectedEvidence?: typeof resolveCanonicalSelectedFootageEvidence;
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
  // A freshly confirmed v2 story has no generation submission yet. Admit only
  // its unchanged strong story/source context while assembling the exact input;
  // canonical media/reference pinning and strict validation still precede work.
  const needsBaseline = project.generationScopeVersion === 2 && !project.generationScope;
  const scope = await dependencies.validate(ownerId, saved, needsBaseline ? { allowUnissuedBaseline: true } : {});
  if (!scope || scope !== expected.planSignature) throw new H3ShotPlanningError("The confirmed cut plan changed.");
  let input: H3ShotPlanningInput;
  try {
    const assets = withCurrentReferenceIdentity(saved.draft.generatedAssets ?? [], project.currentIdentity);
    const scaffold = buildH3ResolvedPlanningScaffold({ project, generatedAssets: assets, draft: saved.draft.generatedDraft });
    const evidence = new Map<string, SelectedFootageEvidence>();
    for (const row of scaffold.coverageLedger) {
      if (row.kind !== "generated") continue;
      const asset = assets.find(asset => asset.id === row.generatedAssetId);
      if (!asset || row.sourceStart === undefined || row.sourceEnd === undefined) throw new Error("Selected footage is unavailable.");
      const resolved = await (dependencies.selectedEvidence ?? resolveCanonicalSelectedFootageEvidence)({ selected: true, ownerId, projectId,
        ...(row.reusedTakePlacementId ? { reusedTakePlacement: saved.draft.generatedDraft?.reusedTakePlacements?.find(placement => placement.id === row.reusedTakePlacementId),
          reuseOrigins: project.generationScope?.body.reuseOrigins } : {}),
        generationScope: scope, asset, window: { songStart: row.songStart, songEnd: row.songEnd, sourceStart: row.sourceStart, sourceEnd: row.sourceEnd }, currentIdentity: project.currentIdentity });
      if (!resolved) throw new Error("Selected footage canonical evidence changed.");
      evidence.set(row.windowKey, resolved);
    }
    input = buildH3DraftPlanningInput(projectId, project, saved.draft.referenceAssets ?? [], {
      assets, draft: saved.draft.generatedDraft, canonicalEvidenceByWindowKey: evidence,
      confirmedTreatment: story.confirmedTreatmentSnapshot,
    });
  }
  catch { throw new H3ShotPlanningError("The current saved placements cannot supply a complete bounded shot planning context."); }
  if (input.planSignature !== scope || (expected.bindingSha256 !== undefined && input.bindingSha256 !== expected.bindingSha256)) {
    throw new H3ShotPlanningError("The story, cut plan or planning context changed.");
  }
  if (needsBaseline) {
    await (dependencies.baseline ?? recordGenerationScopeBaseline)(ownerId, saved);
    if (await dependencies.validate(ownerId, saved) !== scope) throw new H3ShotPlanningError("The confirmed cut plan changed.");
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
