import { describe, expect, test } from "bun:test";
import { assessStoryMatch, deriveShotRequirementConstraints } from "@/components/studio/storyMatchAssessment";
import { createMediaEvidence } from "@/components/studio/mediaEvidence";
import { rankMomentsForSection, scoreMomentForSection } from "@/components/studio/semanticEditPlanner";

const pair = { id: "pair", sourceClipId: 0, label: "club", start: 0, end: 5, duration: 5,
  caption: "Diego and Valentina dancing together in the Underground Latin Club." };
const assess = (text: string, moment = pair) => assessStoryMatch({ requirementId: "opening", requirementText: text, moment });

describe("story evidence eligibility", () => {
  test("matching character and location names cannot rescue paired dancing for solo walking", () => {
    const assessment = assess("Diego walking alone in the Underground Latin Club");
    expect(assessment.eligibility).toBe("ineligible");
    expect(assessment.contradicted).toContain("Focal subjects: requires 1, observes 2");
    const section = { id: "intro", label: "Intro", prompt: "Diego walking alone in the Underground Latin Club", start: 0, end: 5 };
    expect(scoreMomentForSection({ section, moment: pair }).score).toBe(0);
    expect(rankMomentsForSection({ section, moments: [pair] })).toEqual([]);
    expect(rankMomentsForSection({ section, moments: [pair], includeIneligible: true })).toHaveLength(1);
  });

  test("walking does not establish searching motivation", () => {
    const moment = { ...pair, caption: "Diego walking alone in the club, scanning the crowd." };
    const assessment = assess("Diego walking alone, looking for Valentina", moment);
    expect(assessment.eligibility).toBe("uncertain");
    expect(assessment.unknown.some((reason) => reason.includes("Intent requires review"))).toBe(true);
  });

  test("missing jungle establishing image cannot be replaced by matching club ambience", () => {
    const assessment = assess("Wide establishing shot of a jungle cave entrance");
    expect(assessment.eligibility).toBe("ineligible");
    expect(assessment.contradicted.some((reason) => reason.includes("jungle"))).toBe(true);
  });

  test("disaster footage is eligible for an intentional cold open or a climax", () => {
    const moment = { ...pair, caption: "Diego and Valentina running together through a collapsing club." };
    expect(assess("Cold open: Diego and Valentina running together through a collapsing club", moment).eligibility).toBe("eligible");
    expect(assess("Final climax: Diego and Valentina running together through a collapsing club", moment).eligibility).toBe("eligible");
    expect(assess("Diego entering the intact club alone", moment).eligibility).toBe("ineligible");
  });

  test("unknown identity and temporal evidence remain unknown despite a confident old caption", () => {
    const mediaEvidence = createMediaEvidence({ sourceId: "source", sceneId: "pair", sourceStart: 0, sourceEnd: 5,
      rawCaption: "Diego entering alone", input: { kind: "single-frame", sampleTimes: [2], urls: ["https://media.test/frame.jpg"] },
      observation: { subjects: [], actions: ["entering"], focalSubjectCount: 1 } });
    const assessment = assessStoryMatch({ requirementId: "arrival", requirementText: "Diego entering alone", moment: { ...pair, mediaEvidence } });
    expect(assessment.eligibility).toBe("uncertain");
    expect(assessment.unknown).toContain("Subject: Diego");
    expect(assessment.unknown.some((reason) => reason.includes("ordered observations"))).toBe(true);
    expect(assessment.evidenceReferences).toEqual(["https://media.test/frame.jpg"]);
  });

  test("wrong focal person is contradicted while background cast does not establish identity", () => {
    const mediaEvidence = createMediaEvidence({ sourceId: "source", sceneId: "pair", sourceStart: 0, sourceEnd: 5,
      rawCaption: "", input: { kind: "ordered-frames", sampleTimes: [0, 4], urls: [] },
      observation: { subjects: [{ name: "Valentina", role: "focal", confidence: "supported" }, { name: "Diego", role: "background", confidence: "supported" }], focalSubjectCount: 1, actions: ["walking"] } });
    expect(assessStoryMatch({ requirementId: "solo", requirementText: "Diego walking alone", moment: { ...pair, mediaEvidence } }).eligibility).toBe("ineligible");
  });

  test("negated action cannot be promoted by matching words", () => {
    const moment = { ...pair, caption: "Diego and Valentina are not dancing; the couple stands in the club." };
    expect(assess("Diego and Valentina dancing together", moment).eligibility).toBe("ineligible");
    const constraints = deriveShotRequirementConstraints("Diego walking alone, not running");
    expect(constraints.actions).toEqual(["walking"]);
    expect(constraints.excludedActions).toEqual(["running"]);
  });

  test("the same actions in reverse order do not satisfy a temporal requirement", () => {
    const moment = { ...pair, caption: "Diego dancing alone, then walking away." };
    const assessment = assess("Diego walking alone, then dancing", moment);
    expect(assessment.eligibility).toBe("ineligible");
    expect(assessment.contradicted.some((reason) => reason.includes("Action order"))).toBe(true);
    expect(assess("Diego walking alone, then dancing", { ...pair, caption: "Diego walking alone and dancing" }).eligibility).toBe("uncertain");
  });

  test("before-disaster wording means intact, not simultaneous damage", () => {
    expect(deriveShotRequirementConstraints("The club before the earthquake").physicalStates).toEqual(["intact"]);
  });
});
