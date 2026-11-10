export type AnimaticMotionBinding = { shotId: string; bindingSha256: string; reviewBindingSha256: string; imageSha256: string };

/** Missing metadata cannot match a new reviewed target; legacy pairs stay equal. */
export function sameAnimaticMotionBinding(a?: AnimaticMotionBinding, b?: AnimaticMotionBinding) {
  return a === undefined || b === undefined ? a === b : a.shotId === b.shotId && a.bindingSha256 === b.bindingSha256
    && a.reviewBindingSha256 === b.reviewBindingSha256 && a.imageSha256 === b.imageSha256;
}
