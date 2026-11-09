import { generationScopeSha256 } from "./generationScope";
import { normalizeSceneProofPlan, SCENE_PROOF_ROLES, sceneMomentBinding, sceneProofContextSha256,
  sceneProofReviewStatus, sceneReviewSha256, type SceneProofContext, type SceneProofPlan } from "./sceneProofs";

export type SceneProofPlanningSource = SceneProofContext & { sceneProofPlan?: SceneProofPlan; sceneProofReviewRequired?: boolean };
export type SceneProofWindowScope = {
  version: 1; projectId: string; songStart: number; songEnd: number;
  scenes: {
    sceneId: string; anchorId: string; sectionId: string; songStart: number; songEnd: number;
    intersectionStart: number; intersectionEnd: number; direction: string; referenceAssetIds: string[];
    reviewSha256: string;
    moments: { role: typeof SCENE_PROOF_ROLES[number]; prompt: string; bindingSha256: string;
      jobId: string; descriptorSha256: string; artifactSha256: string }[];
  }[];
};
const fail = (): never => { throw new Error("Save and approve the current whole-song scene previews before planning or generating this shot."); };

/** Shared geometry/context authority. Reviews remain scoped to each scene. */
export function currentSceneProofPlanningPlan(source: SceneProofPlanningSource): SceneProofPlan | undefined {
  if (source.sceneProofPlan === undefined && !source.sceneProofReviewRequired) return undefined;
  const plan = normalizeSceneProofPlan(source.sceneProofPlan), duration = source.project.duration;
  if (!plan || plan.projectId !== source.projectId || plan.contextSha256 !== sceneProofContextSha256(source)
    || !Number.isFinite(duration) || duration <= 0 || Math.abs(plan.scenes[0].songStart) > 0.001
    || Math.abs(plan.scenes.at(-1)!.songEnd - duration) > 0.001
    || plan.scenes.some((scene, index) => scene.id.length > 200 || /[\x00-\x1f\x7f]/.test(scene.id)
      || scene.songEnd > duration + 0.001 || !source.treatment.anchors.some(anchor => anchor.id === scene.anchorId)
      || !source.project.storySections.some(section => section.id === scene.sectionId
        && Number.isFinite(section.start) && Number.isFinite(section.end)
        && Math.min(section.end, scene.songEnd) > Math.max(section.start, scene.songStart))
      || index > 0 && Math.abs(scene.songStart - plan.scenes[index - 1].songEnd) > 0.001)) return fail();
  return plan;
}

/** A crossing cut carries both ordered scene intersections, never a nearest-scene guess. */
export function sceneProofWindowScope(plan: SceneProofPlan, window: { songStart: number; songEnd: number }): SceneProofWindowScope {
  if (!Number.isFinite(window.songStart) || !Number.isFinite(window.songEnd) || window.songStart < 0 || window.songEnd <= window.songStart) return fail();
  let cursor = window.songStart;
  const scenes = plan.scenes.flatMap(scene => {
    const intersectionStart = Math.max(scene.songStart, window.songStart), intersectionEnd = Math.min(scene.songEnd, window.songEnd);
    if (intersectionEnd <= intersectionStart) return [];
    if (Math.abs(intersectionStart - cursor) > 0.001 || sceneProofReviewStatus(plan, scene, plan.contextSha256) !== "approved") return fail();
    cursor = intersectionEnd;
    return [{ sceneId: scene.id, anchorId: scene.anchorId, sectionId: scene.sectionId,
      songStart: scene.songStart, songEnd: scene.songEnd, intersectionStart, intersectionEnd, direction: scene.direction,
      referenceAssetIds: [...scene.referenceAssetIds], reviewSha256: sceneReviewSha256(plan, scene),
      moments: SCENE_PROOF_ROLES.map(role => {
        const moment = scene.moments.find(moment => moment.role === role)!;
        return { role, prompt: moment.prompt, bindingSha256: sceneMomentBinding(plan, scene, moment).bindingSha256,
          jobId: moment.proof!.jobId, descriptorSha256: moment.proof!.descriptorSha256, artifactSha256: moment.proof!.result.artifactSha256 };
      }) }];
  });
  if (!scenes.length || Math.abs(cursor - window.songEnd) > 0.001) return fail();
  return { version: 1, projectId: plan.projectId, songStart: window.songStart, songEnd: window.songEnd, scenes };
}

export function sceneProofScopeSha256(source: SceneProofPlanningSource, window: { songStart: number; songEnd: number }): string | undefined {
  const plan = currentSceneProofPlanningPlan(source);
  return plan ? generationScopeSha256(sceneProofWindowScope(plan, window)) : undefined;
}

/** Existing author/reviewer wire schema; the range labels preserve narrative order. */
export function sceneProofPlanningDirection(scopes: SceneProofWindowScope[]): string {
  const seen = new Set<string>();
  return scopes.flatMap(scope => scope.scenes.flatMap(scene => {
    if (seen.has(scene.sceneId)) return [];
    seen.add(scene.sceneId);
    return [`Scene ${scene.sceneId}, song ${scene.songStart}–${scene.songEnd}s.\nApproved scene direction: ${scene.direction}\n${scene.moments.map(moment => `${moment.role}: ${moment.prompt}`).join("\n")}`];
  })).join("\n\n");
}
