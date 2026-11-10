import type { StillAnimaticPlan } from "./stillAnimatic";

export type AnimaticPreviewSnapshot = {
  projectId: string; name: string; revision: string; songLabel: string; audioUrl: string;
  contextSha256: string; plan: StillAnimaticPlan | null;
};
