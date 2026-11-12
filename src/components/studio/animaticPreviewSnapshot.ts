import type { StillAnimaticPlan } from "./stillAnimatic";
import type { EditPlanPreviewSegment } from "./musicVideoProject";
import type { ReplacementTarget } from "./replacementReview";

export type PreviewReviewCut = { segments: EditPlanPreviewSegment[]; targets?: ReplacementTarget[]; fingerprint: string;
  availableVideoCount: number; selectedVideoCount: number };

export type AnimaticPreviewSnapshot = {
  projectId: string; name: string; revision: string; songLabel: string; audioUrl: string;
  contextSha256: string; plan: StillAnimaticPlan | null;
  analysis?: import("./types").BeatJoinAnalysis;
  /** Older deployed snapshot routes may not include the motion projection yet. */
  cut?: PreviewReviewCut;
  reviewSources?: import("./reviewBackfill").ReviewBackfillInput[];
};
