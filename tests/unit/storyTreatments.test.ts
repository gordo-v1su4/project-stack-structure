import { reviewedEvidence } from "../helpers/storyEvidence";
import { describe, expect, test } from "bun:test";

import type { MusicVideoProject, VideoMoment } from "@/components/studio/musicVideoProject";
import { normalizePersistedStoryState } from "@/components/studio/projectPersistence";
import {
  buildStoryCaptionClusters,
  storyValidationFeedback,
  applyTreatmentCoverageToProject,
  buildStoryContentSignature,
  hydrateTreatmentCoverage,
  isStoryPlanConfirmable,
  parseGeneratedTreatments,
  parseGeneratedTreatment,
  parseStoryTreatmentRequest,
  sampleCaptionClustersForStory,
  STORY_CAPTION_CLUSTER_LIMIT,
} from "@/components/studio/storyTreatments";

const storyVisuals = [
  "A stranger descends through a wet tunnel toward the hidden underground dance complex.",
  "Two dancers move independently through a crowded room without noticing one another.",
  "They search separate corridors after realizing their missed connection mattered.",
  "They reunite and dance as the central arena floor splits and collapses.",
];

const generated = {
  treatments: ["faithful", "bold", "wildcard"].map((kind, treatmentIndex) => ({
    id: `${kind}-story`,
    kind,
    title: `${kind} title`,
    logline: `${kind} treatment follows two strangers through a dangerous underground dance labyrinth ${treatmentIndex}.`,
    synopsis: `A visually specific sequence of rooms creates a complete cinematic progression for the ${kind} version, with movement remaining the primary spectacle and a distinct ending.`,
    visualThesis: "Bodies move through hard pools of light while architecture fractures around them.",
    endingHook: `${kind} ending lands on a different final decision.`,
    expectedReusePercent: 75,
    expectedGenerationPercent: 25,
    anchors: Array.from({ length: 4 }, (_, anchorIndex) => ({
      id: `${kind}-anchor-${anchorIndex + 1}`,
      title: ["Tunnel arrival", "Crowded dance room", "Search through the maze", "Collapsing arena"][anchorIndex],
      description: storyVisuals[anchorIndex],
      requirements: [{ id: `${kind}-requirement-${anchorIndex + 1}`, momentId: `${kind}-anchor-${anchorIndex + 1}`, description: storyVisuals[anchorIndex], constraints: { subjects: [] } }],
      purpose: "Advance the physical search and make the underground geography legible.",
      generationPrompt: "Cinematic wide shot of dancers moving through an underground industrial chamber.",
    })),
  })),
};

const moments: VideoMoment[] = [
  {
    id: "dance-room",
    sourceClipId: 0,
    label: "Crowded dance room",
    start: 1,
    end: 4,
    duration: 3,
    caption: "Two dancers perform in a crowded underground room under orange lights.",
    mediaEvidence: reviewedEvidence({ actions: ["dancing"], focalSubjectCount: 2, location: "underground room", physicalState: ["intact"] }, 1, 4),
  },
  {
    id: "collapse",
    sourceClipId: 1,
    label: "Arena collapse",
    start: 5,
    end: 8,
    duration: 3,
    caption: "The central dance floor fractures and collapses while the crowd keeps dancing.",
    mediaEvidence: reviewedEvidence({ actions: ["dancing"], location: "arena dance floor", physicalState: ["fractured", "collapsing"] }, 5, 8),
  },
];

describe("story treatment contract", () => {
  test("accepts exactly one faithful, bold, and wildcard treatment", () => {
    const parsed = parseGeneratedTreatments(generated);
    expect(parsed.map((treatment) => treatment.kind)).toEqual(["faithful", "bold", "wildcard"]);
    expect(parsed.every((treatment) => treatment.anchors.length === 4)).toBe(true);
  });

  test("rejects overlong generated loglines without silently cutting their ending", () => {
    const response = structuredClone(generated);
    const completeLogline = `${"A".repeat(310)} or lose the only way home.`;
    response.treatments[0].logline = completeLogline;
    expect(() => parseGeneratedTreatments(response)).toThrow("Treatment 1 logline must be at most 320 characters.");
    expect(response.treatments[0].logline).toBe(completeLogline);
    response.treatments[0].logline = `  ${"A".repeat(319)}.  `;
    expect(parseGeneratedTreatments(response)[0].logline).toBe(`${"A".repeat(319)}.`);
  });

  test("retains overlong saved legacy prose intact while requiring story review", () => {
    const treatment = hydrateTreatmentCoverage(parseGeneratedTreatments(generated), moments)[0];
    const originalLogline = `${"Saved user wording. ".repeat(20)}The complete original ending.`;
    treatment.logline = originalLogline;
    const state = normalizePersistedStoryState({
      vocalStemName: "", transcriptSummary: null, storyBeats: [], activeBeatId: "", storyGenerated: true,
      treatments: [treatment], confirmedTreatmentSnapshot: treatment, confirmedTreatmentId: treatment.id,
      storyContentSignature: "saved-signature",
    }, true);
    expect(state.treatments?.[0].logline).toBe(originalLogline);
    expect(state.treatments?.[0].reconciliation?.status).toBe("legacy");
    expect(state.storyGenerated).toBe(false);
    expect(treatment.logline).toBe(originalLogline);
  });

  test("refinement accepts complete long saved prose but does not relax generated reply limits", () => {
    const treatment = hydrateTreatmentCoverage(parseGeneratedTreatments(generated), moments)[0];
    const originalLogline = `${"Saved story detail. ".repeat(40)}Diego must find the exit before the floor gives way.`;
    treatment.logline = originalLogline;
    treatment.anchors[0].resolution = "source";
    treatment.anchors[0].selectedCandidateId = "untrusted-coverage";
    const request = { brief: "", song: { sections: [] }, footage: {}, revision: { treatment, instruction: "Shorten the logline without changing the story." } };
    const parsed = parseStoryTreatmentRequest(request);
    expect(parsed.revision?.treatment.logline).toBe(originalLogline);
    expect(parsed.revision?.treatment.anchors[0].selectedCandidateId).toBe(null);
    expect(() => parseGeneratedTreatment(parsed.revision!.treatment)).toThrow("Treatment 1 logline must be at most 320 characters.");
    expect(parseGeneratedTreatment({ ...parsed.revision!.treatment, logline: generated.treatments[0].logline }).logline).toBe(generated.treatments[0].logline);
    treatment.logline = "x".repeat(2001);
    expect(() => parseStoryTreatmentRequest(request)).toThrow("Treatment 1 logline must be at most 2000 characters.");
    expect(treatment.logline).toHaveLength(2001);
  });

  test("rejects three cosmetic copies of the same logline", () => {
    const duplicate = structuredClone(generated);
    duplicate.treatments.forEach((treatment) => {
      treatment.logline = "The exact same story follows two dancers through a collapsing underground room.";
    });
    expect(() => parseGeneratedTreatments(duplicate)).toThrow(/distinct/i);
  });

  test("rejects duplicate developed options even when their titles differ", () => {
    const duplicate = structuredClone(generated);
    duplicate.treatments[2] = { ...structuredClone(duplicate.treatments[1]), id: "wildcard-story", kind: "wildcard", title: "A different title" };
    expect(() => parseGeneratedTreatments(duplicate)).toThrow(/distinct/i);
  });

  test("allows the same requested ending across distinct treatment pitches", () => {
    const sharedEnding = structuredClone(generated);
    sharedEnding.treatments.forEach(treatment => { treatment.endingHook = "Diego and Valentina escape together and remain together."; });
    expect(parseGeneratedTreatments(sharedEnding)).toHaveLength(3);
  });

  test("validates and bounds derived request context", () => {
    const parsed = parseStoryTreatmentRequest({
      brief: "Two strangers meet in a maze.",
      song: { title: "Love Me Tonight", sections: [{ label: "Intro", start: 0, end: 8 }] },
      footage: { captionClusters: ["dancers in a room"], sourceCount: 21, momentCount: 42 },
    });
    expect(parsed.song.title).toBe("Love Me Tonight");
    expect(parsed.footage.sourceCount).toBe(21);
  });

  test("samples large caption cluster lists for model context limits", () => {
    const clusters = Array.from({ length: 120 }, (_, index) => `caption cluster ${index}`);
    const sampled = sampleCaptionClustersForStory(clusters);
    expect(sampled.length).toBe(STORY_CAPTION_CLUSTER_LIMIT);
    expect(sampled[0]).toBe("caption cluster 0");
    expect(sampled[sampled.length - 1]).toBe("caption cluster 119");
  });

  test("ignores malformed trailing anchors from Qwen output", () => {
    const noisy = structuredClone(generated);
    noisy.treatments[0].anchors.push(null as never);
    const parsed = parseGeneratedTreatments(noisy);
    expect(parsed[0].anchors).toHaveLength(4);
  });

  test("coerces string anchors from Qwen into full anchor objects", () => {
    const stringAnchors = structuredClone(generated);
    stringAnchors.treatments[0].anchors = [
      "Diego and Valentina pass in a dim corridor with red haze and wet concrete walls.",
      "They dance in the main chamber under amber cage lamps while the crowd presses in.",
      "They move together on a wet floor as red smoke and industrial light wrap the room.",
      "The floor splits beneath them while dancers keep moving through the wreckage.",
    ] as unknown as typeof stringAnchors.treatments[0]["anchors"];
    const parsed = parseGeneratedTreatments(stringAnchors);
    expect(parsed[0].anchors).toHaveLength(4);
    expect(parsed[0].anchors[0].description).toContain("dim corridor");
    expect(parsed[0].anchors[0].generationPrompt).toContain("Cinematic shot");
    expect(parsed[0].anchors[0].purpose.length).toBeGreaterThan(10);
  });

  test("classifies honest coverage and allows a coherent story with visible gaps", () => {
    const treatment = hydrateTreatmentCoverage(parseGeneratedTreatments(generated), moments)[0];
    expect(treatment.anchors.some((anchor) => anchor.coverage === "covered")).toBe(true);
    expect(treatment.anchors.some((anchor) => anchor.coverage === "missing")).toBe(true);
    expect(isStoryPlanConfirmable(treatment)).toBe(true);
    const resolved = {
      ...treatment,
      anchors: treatment.anchors.map((anchor) => anchor.resolution ? anchor : { ...anchor, resolution: "generate" as const }),
    };
    expect(isStoryPlanConfirmable(resolved)).toBe(true);
  });

  test("carries source choices and generated gaps into the edit plan", () => {
    const treatment = hydrateTreatmentCoverage(parseGeneratedTreatments(generated), moments)[0];
    const decided = {
      ...treatment,
      anchors: treatment.anchors.map((anchor, index) => index === 0
        ? { ...anchor, resolution: "generate" as const, selectedCandidateId: null,
          requirements: anchor.requirements?.map(requirement => ({ ...requirement, resolution: "generate" as const, selectedCandidateId: null })) }
        : { ...anchor, resolution: "source" as const, selectedCandidateId: anchor.candidates[0]?.momentId ?? "dance-room",
          requirements: anchor.requirements?.map(requirement => ({ ...requirement, resolution: "source" as const, selectedCandidateId: requirement.candidates?.find(candidate => candidate.assessment?.eligibility === "eligible")?.momentId ?? null })) }),
    };
    const project = projectFixture();
    const applied = applyTreatmentCoverageToProject(project, decided);
    expect(applied.editPlan.timelineItems[0]?.videoMomentId).toBeNull();
    expect(applied.editPlan.timelineItems[1]?.videoMomentId).toBeTruthy();
  });

  test("content signatures change with anchor decisions", () => {
    const treatment = hydrateTreatmentCoverage(parseGeneratedTreatments(generated), moments)[0];
    const beats = [{ id: "intro", label: "Intro", prompt: "Open", start: 0, end: 4 }];
    const before = buildStoryContentSignature(treatment, beats);
    const after = buildStoryContentSignature({
      ...treatment,
      anchors: treatment.anchors.map((anchor, index) => index === 0 ? { ...anchor, resolution: "omit" } : anchor),
    }, beats);
    expect(after).not.toBe(before);
  });
});

function projectFixture(): MusicVideoProject {
  const sections = Array.from({ length: 4 }, (_, index) => ({
    id: `section-${index}`,
    label: `Section ${index}`,
    prompt: `Prompt ${index}`,
    start: index * 2,
    end: index * 2 + 2,
    source: "manual" as const,
    lyricChunkIds: [],
    videoMomentIds: [moments[index % moments.length].id],
  }));
  return {
    id: "story-project",
    song: null,
    duration: 8,
    lyricChunks: [],
    storySections: sections,
    videoMoments: moments,
    editPlan: {
      id: "plan",
      createdAt: "2026-09-02T00:00:00.000Z",
      timelineItems: sections.map((section) => ({
        id: `timeline-${section.id}`,
        sectionId: section.id,
        lyricChunkIds: [],
        videoMomentId: section.videoMomentIds[0],
        start: section.start,
        end: section.end,
        label: section.label,
        prompt: section.prompt,
      })),
    },
    reviewFindings: [],
  };
}


test("bounds retry feedback and excludes raw provider error text", () => {
  const parsed = parseStoryTreatmentRequest({ brief: "", song: { sections: [] }, footage: {}, validationFeedback: "x".repeat(900) });
  expect(parsed.validationFeedback?.length).toBe(500);
  expect(storyValidationFeedback(new Error("Each story moment needs a narrative purpose and explicit shot requirements."))).toContain("nonempty requirements array");
  expect(storyValidationFeedback(new Error("Provider credentials: secret-value"))).toBe(undefined);
  expect(storyValidationFeedback(new Error("Story treatment loglines must be meaningfully distinct. secret-value"))).not.toContain("secret-value");
});

test("semantic logline review retries use fixed corrective guidance without provider details", () => {
  const feedback = storyValidationFeedback(new Error("Story logline review failed: provider credentials secret-value"));
  expect(feedback).toBe("Rewrite the logline sentence so it expresses the inciting incident, specific protagonist, concrete goal, central opposition, and stakes, all supported by the story. Do not reveal the resolution, include spoilers, or invent facts.");
  expect(feedback).not.toContain("secret-value");
  expect(storyValidationFeedback(new Error("Treatment 1 logline must be at most 320 characters."))).toContain("each complete logline within 320 characters");
});

test("caption context deduplicates exact repeated fields without rewriting footage text", () => {
  const caption = "Diego walks alone through the red corridor.";
  const clusters = buildStoryCaptionClusters([{ id: "scene", sourceClipId: 0, label: "Scene 1", start: 0, end: 4, duration: 4, caption, captionMeta: { caption, action: "walking", subjects: ["Diego", "Diego"] } }]);
  expect(clusters).toEqual([`Scene 1 · ${caption} · walking · Diego`]);
});
