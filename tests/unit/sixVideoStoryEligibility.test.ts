import { describe, expect, test } from "bun:test";
import reviewed from "../fixtures/story-evidence/six-video-review.json";
import { createMediaEvidence } from "@/components/studio/mediaEvidence";
import { assessStoryMatch } from "@/components/studio/storyMatchAssessment";

const scenes = reviewed.scenes.map((scene) => ({
  id: `s${scene.sourceIndex}:${scene.sceneId}`, caption: scene.originalCaption,
  mediaEvidence: createMediaEvidence({
    sourceId: String(scene.sourceId), sceneId: String(scene.sceneId), sourceStart: scene.sourceStart, sourceEnd: scene.sourceEnd,
    input: { kind: "ordered-frames", sampleTimes: Object.values(scene.sampleTimes), urls: [] }, rawCaption: scene.originalCaption,
    observation: { subjects: scene.focalSubjects.map((name) => ({ name: name.replace("?", ""), role: "focal", confidence: name.includes("?") || name.startsWith("unknown") ? "uncertain" : "supported" })),
      focalSubjectCount: scene.focalSubjectCount, actions: scene.observedActions, location: "Underground Latin Club", physicalState: [scene.physicalState], unknowns: [scene.reviewNotes] },
  }),
}));

describe("six-video visual review regression", () => {
  test("retains the missing jungle cave opening across all 42 reviewed scenes", () => {
    expect(scenes).toHaveLength(42);
    const matches = scenes.map((moment) => assessStoryMatch({ requirementId: "opening", requirementText: "Jungle cave entrance establishing image", constraints: { setting: "jungle cave" }, moment }));
    expect(matches.some((match) => match.eligibility === "eligible")).toBe(false);
  });

  test("S4 fractured dance floor cannot cover an intact club opening even if its original caption omitted damage", () => {
    const moment = scenes.find((scene) => scene.id === "s4:0")!;
    const match = assessStoryMatch({ requirementId: "intact-opening", requirementText: "Opening in the intact Underground Latin Club", moment });
    expect(match.eligibility).toBe("ineligible");
    expect(match.contradicted).toContain("Physical state contradicts intact");
  });

  test("the original misidentified handstand cannot certify Diego as focal subject", () => {
    const moment = scenes.find((scene) => scene.id === "s1:3")!;
    const match = assessStoryMatch({ requirementId: "diego-acrobat", requirementText: "Diego performs a handstand", constraints: { subjects: ["Diego"], actions: ["handstand"] }, moment });
    expect(match.eligibility).not.toBe("eligible");
    expect([...match.unknown, ...match.contradicted].some((reason) => reason.includes("Diego"))).toBe(true);
  });
});
