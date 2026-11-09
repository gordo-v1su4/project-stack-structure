import { h3ProjectFixture } from "./h3Project";
import { prepareSceneProofPlan, reviewSceneProof, sceneMomentBinding, sceneProofPrompt, sceneProofShot,
  type SceneProofContext, type SceneProofPlan } from "@/components/studio/sceneProofs";
import type { StoryTreatment } from "@/components/studio/storyTreatments";

/** Structural planning evidence only; server admission separately proves owned jobs. */
export function reviewedScenePlanningFixture() {
  const f = h3ProjectFixture(), project = f.saved.draft.musicVideoProject!;
  const placement = project.placementPlan!.placements[0];
  project.placementPlan!.placements = [{ ...placement, id: "first", songEnd: 5, sourceEnd: 5 },
    { ...placement, id: "second", songStart: 5, sourceEnd: 5 }];
  const treatment: StoryTreatment = { id: "story-1", kind: "faithful", title: "Arrival and exit", logline: "Diego crosses CLUB_MAIN.",
    synopsis: "Diego arrives and exits.", visualThesis: "Connected doorways", endingHook: "Diego exits.", expectedReusePercent: 0, expectedGenerationPercent: 100,
    anchors: ["amber", "blue"].map((id, index) => ({ id, title: id, description: `Diego reaches the ${id} doorway in CLUB_MAIN.`,
      purpose: "Reach the doorway", generationPrompt: `Diego reaches the ${id} doorway in CLUB_MAIN.`, songWindow: { start: index * 5, end: (index + 1) * 5 },
      coverage: "missing", candidates: [], selectedCandidateId: null, resolution: "generate" })) };
  f.saved.draft.storyState.confirmedTreatmentSnapshot = treatment;
  const context: SceneProofContext = { projectId: f.saved.project.id, project, treatment, storyBeats: [], references: f.saved.draft.referenceAssets! };
  let plan = prepareSceneProofPlan(context);
  function prove(sceneIndex: number) {
    const scene = plan.scenes[sceneIndex];
    for (const [index, moment] of scene.moments.entries()) {
      const binding = sceneMomentBinding(plan, scene, moment), id = `h3-still-${String(sceneIndex * 3 + index + 1).repeat(64)}`;
      const image = { bucket: "studio", objectKey: `proof/${sceneIndex}-${index}.png`, sha256: "a".repeat(64), byteLength: 100, width: 2048, height: 1152 };
      moment.record = { version: 1, projectId: plan.projectId, context: binding.bindingSha256, jobId: id,
        request: { shot: sceneProofShot(context, plan, scene, moment), creativePrompt: sceneProofPrompt(scene, moment), seed: 42,
          requestIntentId: crypto.randomUUID(), attempt: 0, sceneProof: binding } };
      moment.proof = { jobId: id, descriptorSha256: "b".repeat(64), result: { master: image, native: { ...image, width: 1344, height: 768 },
        artifactId: `h3-frame-${"c".repeat(64)}`, artifactSha256: "d".repeat(64) } };
    }
    plan = reviewSceneProof(plan, scene.id, "approved", "Fixture review", plan.contextSha256);
    f.saved.draft.storyState.sceneProofPlan = plan;
    return plan;
  }
  prove(0); prove(1);
  const source = () => ({ ...context, sceneProofPlan: plan, sceneProofReviewRequired: true as const });
  const planningContext = () => ({ confirmedTreatment: treatment, storyBeats: context.storyBeats, sceneProofPlan: plan, sceneProofReviewRequired: true as const });
  return { ...f, project, context, treatment, source, planningContext, prove, get plan(): SceneProofPlan { return plan; } };
}
