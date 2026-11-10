import { generationScopeSha256 } from "./generationScope";
import { animaticImage, animaticShotBinding, normalizeStillAnimaticPlan, type StillAnimaticPlan } from "./stillAnimatic";

/** Review the exact completed pictures and timing, independently of receipt saves. */
export function animaticReviewBinding(plan: StillAnimaticPlan, context: string): string | null {
  if (context !== plan.contextSha256 || !normalizeStillAnimaticPlan(plan)) return null;
  const shots = plan.shots.map(shot => {
    const image = animaticImage(plan, shot, context);
    return image ? { binding: animaticShotBinding(plan, shot), image,
      proof: shot.proof ? { jobId: shot.proof.jobId, descriptorSha256: shot.proof.descriptorSha256,
        artifactSha256: shot.proof.result.artifactSha256 } : undefined } : null;
  });
  return shots.every(Boolean) ? generationScopeSha256({ version: 1, projectId: plan.projectId, context, shots }) : null;
}

export function reviewAnimatic(plan: StillAnimaticPlan, context: string, expectedBinding: string,
  status: "approved" | "revise", note: string, reviewedAt = new Date().toISOString()): StillAnimaticPlan {
  const bindingSha256 = animaticReviewBinding(plan, context);
  if (!bindingSha256 || bindingSha256 !== expectedBinding) throw new Error("The animatic changed or still has missing images. Review the current complete animatic.");
  if (!["approved", "revise"].includes(status) || typeof note !== "string" || note.length > 2000
    || !Number.isFinite(Date.parse(reviewedAt))) throw new Error("A valid animatic review is required.");
  return { ...plan, review: { status, bindingSha256, note: note.trim(), reviewedAt } };
}
