import { placementInputSignature, toSemanticClipMatch, type MusicVideoProject } from "./musicVideoProject";

/** Remove legacy copies of each candidate's scene without changing editorial decisions. */
export function compactProjectMatches(project: MusicVideoProject): MusicVideoProject {
  const compact = {
    ...project,
    storySections: project.storySections.map(section => ({
      ...section,
      semanticMatch: section.semanticMatch && toSemanticClipMatch(section.semanticMatch),
      candidateMatches: section.candidateMatches?.map(toSemanticClipMatch),
    })),
    editPlan: {
      ...project.editPlan,
      timelineItems: project.editPlan.timelineItems.map(item => ({
        ...item,
        semanticMatch: item.semanticMatch && toSemanticClipMatch(item.semanticMatch),
        candidateMatches: item.candidateMatches?.map(toSemanticClipMatch),
      })),
    },
  };
  // Only migrate a plan proven current against its original inputs. A stale plan
  // must stay stale; compaction cannot approve new evidence or replace manual gaps.
  for (const key of ["placementPlan", "faithfulPlacementPlan"] as const) {
    const plan = project[key];
    if (plan && plan.inputSignature === placementInputSignature(project, plan.settings)) {
      compact[key] = { ...plan, inputSignature: placementInputSignature(compact, plan.settings) };
    }
  }
  return compact;
}
