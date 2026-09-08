import { describe, expect, test } from "bun:test";
import { compactProjectMatches } from "@/components/studio/compactProjectMatches";
import { createMusicVideoProject, DEFAULT_STORY_EDIT_SETTINGS, isPlacementPlanCurrent, placementInputSignature, type MusicVideoProject, type SemanticClipMatch } from "@/components/studio/musicVideoProject";
import { applyStoryCoverage } from "@/components/studio/storyMusicPlacement";
import { createPersistableStudioProjectDraft, hydrateStudioProjectDraft } from "@/components/studio/projectPersistence";
import type { StoryTreatment } from "@/components/studio/storyTreatments";

function legacyProject() {
  const project = createMusicVideoProject({ analysis: null, duration: 8, storyDrafts: [{ id: "intro", label: "Intro", start: 0, end: 8 }] });
  const moment = { id: "shot", sourceClipId: 0, start: 0, end: 4, duration: 4, label: "Dancing", caption: "Dancing ".repeat(20_000) };
  project.videoMoments = [moment];
  const match = { momentId: "shot", score: 0.3, semanticScore: 0.2, lyricCaptionScore: 0, actionIntentScore: 0.2,
    durationFitScore: 1, motionContinuityScore: 0.8, motionEnergyScore: 0.4, repetitionPenalty: 0,
    reasons: ["Low story fit remains advisory"], moment, sectionId: "intro" } satisfies SemanticClipMatch & { moment: typeof moment; sectionId: string };
  project.storySections[0] = { ...project.storySections[0]!, semanticMatch: match, candidateMatches: [match] };
  project.editPlan.timelineItems[0] = { ...project.editPlan.timelineItems[0]!, videoMomentId: "shot", semanticMatch: match, candidateMatches: [match] };
  project.placementPlan = { version: 1, inputSignature: placementInputSignature(project), revision: 7, settings: DEFAULT_STORY_EDIT_SETTINGS, policy: "faithful", placements: [
    { id: "kept", sectionId: "intro", timelineItemId: project.editPlan.timelineItems[0]!.id, momentId: "shot", sourceStart: 1, sourceEnd: 4, songStart: 0, songEnd: 3, label: "Kept shot", kind: "source", origin: "manual-match" },
    { id: "hole", sectionId: "intro", timelineItemId: project.editPlan.timelineItems[0]!.id, momentId: null, sourceStart: 0, sourceEnd: 0, songStart: 3, songEnd: 8, label: "Visible gap", kind: "gap", origin: "manual-match", reason: "Removed from cut" },
  ] };
  project.faithfulPlacementPlan = structuredClone(project.placementPlan);
  return project;
}

describe("compact story project matches", () => {
  test("new story assemblies reference scene evidence instead of duplicating it in every score", () => {
    const project = legacyProject();
    const treatment = { anchors: [{ id: "dance", title: "Dance", description: "Dancing", resolution: "source", selectedCandidateId: "shot" }] } as StoryTreatment;
    const assembled = applyStoryCoverage(project, treatment);
    const selected = assembled.editPlan.timelineItems[0]!;
    expect(selected.videoMomentId).toBe("shot");
    expect("moment" in selected.semanticMatch!).toBe(false);
    expect("moment" in selected.candidateMatches![0]!).toBe(false);
    expect(Boolean(selected.candidateMatches![0]!.assessment)).toBe(true);
    expect(assembled.videoMoments).toEqual(project.videoMoments);
  });

  test("compacts legacy saves while retaining scores, evidence, manual trims, gaps and current signatures", () => {
    const project = legacyProject();
    const before = JSON.stringify(project);
    const compact = compactProjectMatches(project);
    expect(JSON.stringify(compact).length).toBeLessThan(before.length / 2);
    expect(JSON.stringify(project)).toBe(before);
    expect("moment" in compact.editPlan.timelineItems[0]!.candidateMatches![0]!).toBe(false);
    expect(compact.editPlan.timelineItems[0]!.semanticMatch).toMatchObject({ momentId: "shot", score: 0.3, reasons: ["Low story fit remains advisory"] });
    expect(compact.videoMoments).toEqual(project.videoMoments);
    expect(compact.placementPlan!.placements).toEqual(project.placementPlan!.placements);
    expect(compact.placementPlan!.revision).toBe(7);
    expect(isPlacementPlanCurrent(compact)).toBe(true);
    expect(compact.faithfulPlacementPlan!.inputSignature).toBe(placementInputSignature(compact));
    expect(compactProjectMatches(compact)).toEqual(compact);
  });

  test("never makes a stale placement plan current", () => {
    const project = legacyProject();
    project.videoMoments[0]!.end = 2;
    const compact = compactProjectMatches(project);
    expect(isPlacementPlanCurrent(compact)).toBe(false);
    expect(compact.placementPlan!.inputSignature).toBe(project.placementPlan!.inputSignature);
    expect(compact.faithfulPlacementPlan!.inputSignature).toBe(project.faithfulPlacementPlan!.inputSignature);
  });

  test("save and restore migrate legacy matches without losing the approved arrangement", () => {
    const project: MusicVideoProject = legacyProject();
    const draft = createPersistableStudioProjectDraft({ analysis: null, videoSources: [], musicVideoProject: project,
      storyState: { vocalStemName: "", transcriptSummary: null, storyBeats: [], activeBeatId: "intro", storyGenerated: false } });
    const restored = hydrateStudioProjectDraft({ draft: JSON.parse(JSON.stringify(draft)) });
    expect(restored.musicVideoProject!.placementPlan!.placements).toEqual(project.placementPlan!.placements);
    expect(isPlacementPlanCurrent(restored.musicVideoProject!)).toBe(true);
    const legacy = hydrateStudioProjectDraft({ draft: { ...draft, musicVideoProject: project } });
    expect(legacy.musicVideoProject!.placementPlan).toEqual(restored.musicVideoProject!.placementPlan);
    expect(legacy.musicVideoProject!.editPlan.timelineItems[0]!.candidateMatches).toEqual(restored.musicVideoProject!.editPlan.timelineItems[0]!.candidateMatches);
  });
});
