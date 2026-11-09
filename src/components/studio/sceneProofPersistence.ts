import { generationScopeSha256 } from "./generationScope";
import { normalizeSceneProofPlan, sceneProofContextSha256, type SceneProofPlan } from "./sceneProofs";
import type { PersistedStudioProjectDraft } from "./projectPersistence";

/** Compare before save so late still acknowledgements cannot replace newer edits. */
export function prepareSceneProofSave(projectId: string | null, draft: PersistedStudioProjectDraft, next: SceneProofPlan, expected?: SceneProofPlan): PersistedStudioProjectDraft {
  const project = draft.musicVideoProject, treatment = draft.storyState.confirmedTreatmentSnapshot;
  if (!projectId || next.projectId !== projectId || !project || !treatment || !draft.storyState.storyGenerated
    || !normalizeSceneProofPlan(next)) throw new Error("Save and confirm the current project before preparing scene images.");
  if (generationScopeSha256(draft.storyState.sceneProofPlan ?? null) !== generationScopeSha256(expected ?? null)
    || next.contextSha256 !== sceneProofContextSha256({ projectId, project, treatment,
      storyBeats: draft.storyState.storyBeats, references: draft.referenceAssets ?? [] })) throw new Error("The scene direction, story or references changed before saving. Continue from the current scene.");
  return { ...draft, storyState: { ...draft.storyState, sceneProofPlan: next } };
}
