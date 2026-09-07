import { describe, expect, test } from "bun:test";
import { assessStoryMatch, deriveShotRequirementConstraints } from "@/components/studio/storyMatchAssessment";
import { createMediaEvidence } from "@/components/studio/mediaEvidence";
import { rankMomentsForSection, scoreMomentForSection } from "@/components/studio/semanticEditPlanner";
import sixVideoReview from "../fixtures/story-evidence/six-video-review.json";

const pair = { id: "pair", sourceClipId: 0, label: "club", start: 0, end: 5, duration: 5,
  caption: "Diego and Valentina dancing together in the Underground Latin Club." };
const assess = (text: string, moment = pair) => assessStoryMatch({ requirementId: "opening", requirementText: text, moment });

describe("story evidence eligibility", () => {
  test("generic subjects and shot-title adjectives do not invent character identities", () => {
    for (const text of ["Two dancers move together through a crowded room", "Crowded dance room", "Wide dancing shot", "A couple walks together", "The woman dances alone"]) {
      expect(deriveShotRequirementConstraints(text).subjects).toBe(undefined);
    }
    expect(deriveShotRequirementConstraints("Diego and Valentina dance together")).toMatchObject({ subjects: ["Diego", "Valentina"], focalSubjectCount: 2, actions: ["dancing"] });
    expect(deriveShotRequirementConstraints("Diego walks alone")).toMatchObject({ subjects: ["Diego"], focalSubjectCount: 1, actions: ["walking"] });
    expect(deriveShotRequirementConstraints("Two dancers dance together")).toMatchObject({ focalSubjectCount: 2, actions: ["dancing"] });
  });
  test("undefined and malformed explicit fields cannot erase solo walking requirements from prose", () => {
    const requirementText = "Diego walking alone in an intact club";
    const mediaEvidence = createMediaEvidence({ sourceId: "source", sceneId: "pair", sourceStart: 0, sourceEnd: 5, rawCaption: pair.caption,
      input: { kind: "ordered-frames", sampleTimes: [0, 4], urls: [] }, observation: { subjects: [{ name: "Diego", role: "focal", confidence: "supported" }, { name: "Valentina", role: "focal", confidence: "supported" }], focalSubjectCount: 2, actions: ["dancing"], physicalState: ["fractured"], location: "club" } });
    const missing = assessStoryMatch({ requirementId: "opening", requirementText, constraints: { subjects: undefined, actions: undefined, focalSubjectCount: undefined, physicalStates: undefined }, moment: { ...pair, mediaEvidence } });
    expect(missing.eligibility).toBe("ineligible");
    expect(missing.contradicted).toContain("Focal subjects: requires 1, observes 2");
    expect(missing.contradicted).toContain("Action: requires walking, observes dancing");
    expect(missing.contradicted).toContain("Physical state contradicts intact");
    const malformed = assessStoryMatch({ requirementId: "opening", requirementText, constraints: { actions: { unexpected: true } } as never, moment: { ...pair, mediaEvidence } });
    expect(malformed.eligibility).toBe("ineligible");
    expect(malformed.unknown).toContain("Invalid shot constraint requires review: actions");
    expect(malformed.contradicted).toContain("Action: requires walking, observes dancing");
  });
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
    const caption = "Diego and Valentina running together through a collapsing club.";
    const mediaEvidence = createMediaEvidence({ sourceId: "source", sceneId: "pair", sourceStart: 0, sourceEnd: 5,
      rawCaption: caption, input: { kind: "ordered-frames", sampleTimes: [0, 4], urls: [] },
      observation: { subjects: ["Diego", "Valentina"].map(name => ({ name, role: "focal", confidence: "supported" })), focalSubjectCount: 2, actions: ["running"], physicalState: ["collapsing"], location: "club" } });
    const moment = { ...pair, caption, mediaEvidence };
    expect(assess("Cold open: Diego and Valentina running together through a collapsing club", moment).eligibility).toBe("eligible");
    expect(assess("Final climax: Diego and Valentina running together through a collapsing club", moment).eligibility).toBe("eligible");
    expect(assess("Diego entering the intact club alone", moment).eligibility).toBe("ineligible");
  });

  test("the actual mislabeled handstand caption remains a suggestion rather than verified coverage", () => {
    const scene = sixVideoReview.scenes.find(scene => scene.sourceIndex === 1 && scene.sceneId === 3)!;
    const moment = { ...pair, caption: scene.originalCaption };
    const assessment = assessStoryMatch({ requirementId: "acrobat", requirementText: "Diego performs a handstand", constraints: { subjects: ["Diego"], actions: ["handstand"] }, moment });
    expect(assessment.eligibility).toBe("uncertain");
    expect(assessment.unknown).toContain("Legacy caption only: subject and action evidence requires review.");
    expect(moment.caption).toBe(scene.originalCaption);
    const section = { id: "intro", label: "Intro", prompt: "Diego performs a handstand", start: 0, end: 5 };
    expect(rankMomentsForSection({ section, moments: [moment] })).toHaveLength(1);
  });

  test("mixed dance and singer shots cannot assign the singer's action to Diego", () => {
    const mediaEvidence = createMediaEvidence({ sourceId: "S1", sceneId: "6", sourceStart: 8.67, sourceEnd: 12.83,
      rawCaption: "Pair dancing followed by a separate singer", input: { kind: "ordered-frames", sampleTimes: [8.72, 10.75, 12.78], urls: [] },
      observation: { subjects: ["Diego", "Valentina"].map(name => ({ name, confidence: "supported", role: "focal" })), focalSubjectCount: null,
        actions: ["dancing", "singing"], transitions: ["Pair dance cuts to a separate female singer"], unknowns: ["Who sings is unknown"] } });
    const input = { requirementId: "singer", requirementText: "Diego singing", constraints: { subjects: ["Diego"], actions: ["singing"] }, moment: { ...pair, mediaEvidence } };
    const before = structuredClone(mediaEvidence);
    const assessment = assessStoryMatch(input);
    expect(assessment.eligibility).toBe("uncertain");
    expect(assessment.unknown).toContain("Source evidence requires review: Who sings is unknown");
    expect(assessment.unknown.some(reason => reason.startsWith("Actor/action association"))).toBe(true);
    // Omission of an uncertainty string cannot make the flattened actor/action cross-product valid.
    expect(assessStoryMatch({ ...input, moment: { ...input.moment, mediaEvidence: { ...mediaEvidence, unknowns: [] } } }).eligibility).toBe("uncertain");
    expect(mediaEvidence).toEqual(before);
  });

  test("a reviewed single actor and action remains eligible without rewriting source decisions", () => {
    const mediaEvidence = createMediaEvidence({ sourceId: "source", sceneId: "solo", sourceStart: 0, sourceEnd: 5,
      rawCaption: "Diego walks", input: { kind: "ordered-frames", sampleTimes: [0, 4], urls: [] },
      observation: { subjects: [{ name: "Diego", confidence: "supported", role: "focal" }], focalSubjectCount: 1, actions: ["walking"] } });
    mediaEvidence.provenance.origin = "manual";
    const moment = { ...pair, mediaEvidence, selectedCandidateId: "user-choice" };
    expect(assessStoryMatch({ requirementId: "walk", requirementText: "Diego walking alone", moment }).eligibility).toBe("eligible");
    expect(moment.selectedCandidateId).toBe("user-choice");
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
