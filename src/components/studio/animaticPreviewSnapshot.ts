import type { StillAnimaticPlan } from "./stillAnimatic";
import type { EditPlanPreviewSegment } from "./musicVideoProject";
import type { ReplacementTarget } from "./replacementReview";

export type PreviewReviewCut = { segments: EditPlanPreviewSegment[]; targets?: ReplacementTarget[]; fingerprint: string;
  coverage?: Array<{ shotId: string; availableTakeIds: string[]; selectedVideoCount: number; approvedTakeCount: number }>;
  availableVideoCount: number; selectedVideoCount: number };

export type AnimaticPreviewSnapshot = {
  projectId: string; name: string; revision: string; songLabel: string; audioUrl: string;
  contextSha256: string; plan: StillAnimaticPlan | null;
  analysis?: import("./types").BeatJoinAnalysis;
  /** Older deployed snapshot routes may not include the motion projection yet. */
  cut?: PreviewReviewCut;
  reviewSources?: import("./reviewBackfill").ReviewBackfillInput[];
};

/** Keep media buffers stable without hiding newly delivered takes or review metadata. */
export function reconcilePreviewSnapshot(current: AnimaticPreviewSnapshot | null, next: AnimaticPreviewSnapshot): AnimaticPreviewSnapshot {
  return next.cut && current?.projectId === next.projectId && current.cut?.fingerprint === next.cut.fingerprint
    ? { ...next, cut: { ...next.cut, segments: current.cut.segments } } : next;
}
