import { describe, expect, test } from "bun:test";

import { buildSemanticEditPlan, keywordSemanticScore, rankMomentsForSection } from "@/components/studio/semanticEditPlanner";
import { makeMotionDescriptor } from "../helpers/studioFixtures";

describe("semantic edit planner", () => {
  test("matches lyric and prompt language to captioned scene moments", () => {
    const plan = buildSemanticEditPlan({
      sections: [
        { id: "verse", label: "Verse", prompt: "lonely neon street", start: 0, end: 4, lyricTexts: ["love me tonight under neon rain"] },
        { id: "chorus", label: "Chorus", prompt: "dance performance energy", start: 4, end: 8, lyricTexts: ["hold me while we dance"] },
      ],
      videoMoments: [
        { id: "rain", sourceClipId: 0, label: "rain street", start: 0, end: 5, duration: 5, caption: "a lonely person walking through neon rain on a city street", subjects: ["person"], action: "walking", setting: "city street" },
        { id: "dance", sourceClipId: 1, label: "club dance", start: 0, end: 4, duration: 4, caption: "people dancing in a warm club with energetic movement", subjects: ["people"], action: "dancing", setting: "club" },
      ],
    });

    expect(plan.assignments).toHaveLength(2);
    expect(plan.assignments[0]?.momentId).toBe("rain");
    expect(plan.assignments[1]?.momentId).toBe("dance");
    expect(plan.assignments[0]?.reasons.some((reason) => reason.includes("caption"))).toBe(true);
  });

  test("penalizes immediate repetition when another reasonable semantic match exists", () => {
    const ranked = rankMomentsForSection({
      section: { id: "hook", label: "Hook", prompt: "neon dance", start: 0, end: 3, lyricTexts: ["dance tonight"] },
      previous: { id: "a", sourceClipId: 0, label: "neon dance", start: 0, end: 3, duration: 3, caption: "neon dance floor" },
      useCounts: new Map([["a", 1]]),
      moments: [
        { id: "a", sourceClipId: 0, label: "neon dance", start: 0, end: 3, duration: 3, caption: "neon dance floor" },
        { id: "b", sourceClipId: 1, label: "dance club", start: 0, end: 3, duration: 3, caption: "club dancers under neon lights" },
      ],
    });

    expect(ranked[0]?.momentId).toBe("b");
    expect((ranked.find((item) => item.momentId === "a")?.repetitionPenalty ?? 0)).toBeGreaterThan(0);
  });

  test("keeps fuzzy caption search dependency-free for client and tests", () => {
    expect(keywordSemanticScore("rain dance", "dancers moving in rainy neon streets")).toBeGreaterThan(0.35);
    expect(keywordSemanticScore("ocean", "indoor kitchen close up")).toBe(0);
  });

  test("expands lyric intent so romantic lyrics can match non-literal couple imagery", () => {
    const ranked = rankMomentsForSection({
      section: { id: "verse", label: "Verse", prompt: "intimate night portrait", start: 0, end: 4, lyricTexts: ["love me tonight"] },
      moments: [
        { id: "literal-night", sourceClipId: 0, label: "night building", start: 0, end: 4, duration: 4, caption: "empty dark building exterior at night" },
        { id: "couple", sourceClipId: 1, label: "close couple", start: 0, end: 4, duration: 4, caption: "romantic couple in a tender close embrace", subjects: ["couple"], action: "embrace", shotType: "close-up" },
      ],
    });

    expect(ranked[0]?.momentId).toBe("couple");
    expect(ranked[0]?.actionIntentScore).toBeGreaterThan(0.35);
    expect(ranked[0]?.reasons).toContain("action/intent match");
  });

  test("uses section energy and motion descriptors to favor high-motion clips for choruses", () => {
    const ranked = rankMomentsForSection({
      section: { id: "chorus", label: "Chorus", prompt: "performance hook", start: 0, end: 5, energy: 0.95, lyricTexts: ["move with me"] },
      moments: [
        {
          id: "static",
          sourceClipId: 0,
          label: "static performance",
          start: 0,
          end: 5,
          duration: 5,
          caption: "singer standing still on stage",
          motionDescriptor: makeMotionDescriptor({
            id: "static",
            dominantMagnitude: 0.08,
            motionCoherence: 0.2,
            cameraMotionType: "static",
            cameraMotionStrength: 0.08,
            residualMotionStrength: 0.08,
          }),
        },
        {
          id: "moving",
          sourceClipId: 1,
          label: "dynamic performance",
          start: 0,
          end: 5,
          duration: 5,
          caption: "dancers moving fast through a performance hook",
          action: "dancing",
          motionDescriptor: makeMotionDescriptor({
            id: "moving",
            dominantMagnitude: 0.9,
            motionCoherence: 0.85,
            cameraMotionType: "pan",
            cameraMotionStrength: 0.9,
            residualMotionStrength: 0.8,
          }),
        },
      ],
    });

    expect(ranked[0]?.momentId).toBe("moving");
    expect(ranked[0]?.motionEnergyScore).toBeGreaterThan(ranked[1]?.motionEnergyScore ?? 1);
    expect(ranked[0]?.reasons).toContain("music/motion energy fit");
  });
});
