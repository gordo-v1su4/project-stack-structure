import { animaticReviewBinding } from "./animaticReview";
import { animaticContextSha256, animaticShotBinding, stillAnimaticShotRequest,
  type AnimaticContext, type AnimaticShot, type StillAnimaticPlan } from "./stillAnimatic";
import type { H3GenerationRequest } from "./h3Generation";

/** Prepare one independent motion intent; this never queues or approves footage. */
export function animaticMotionRequest(input: AnimaticContext, plan: StillAnimaticPlan, shot: AnimaticShot,
  audioUrl: string, motionPrompt: string): H3GenerationRequest {
  const context = animaticContextSha256(input), reviewBindingSha256 = animaticReviewBinding(plan, context, audioUrl);
  if (!reviewBindingSha256 || plan.review?.status !== "approved" || plan.review.bindingSha256 !== reviewBindingSha256
    || !shot.proof || !motionPrompt.trim()) throw new Error("Review the current complete animatic before preparing motion.");
  return { ...stillAnimaticShotRequest(input, plan, shot), prompt: motionPrompt.trim(),
    animaticMotion: { ...animaticShotBinding(plan, shot), reviewBindingSha256, imageSha256: shot.proof.result.master.sha256 } };
}
