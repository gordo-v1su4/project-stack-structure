import { describe, expect, test } from "bun:test";

import type { MusicVideoProject, VideoMoment } from "@/components/studio/musicVideoProject";
import {
  applyTreatmentCoverageToProject,
  buildStoryContentSignature,
  hydrateTreatmentCoverage,
  isStoryPlanConfirmable,
  parseGeneratedTreatments,
  parseStoryTreatmentRequest,
  sampleCaptionClustersForStory,
  STORY_CAPTION_CLUSTER_LIMIT,
} from "@/components/studio/storyTreatments";

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
      description: [
        "A stranger descends through a wet tunnel toward the hidden underground dance complex.",
        "Two dancers move independently through a crowded room without noticing one another.",
        "They search separate corridors after realizing their missed connection mattered.",
        "They reunite and dance as the central arena floor splits and collapses.",
      ][anchorIndex],
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
  },
  {
    id: "collapse",
    sourceClipId: 1,
    label: "Arena collapse",
    start: 5,
    end: 8,
    duration: 3,
    caption: "The central dance floor fractures and collapses while the crowd keeps dancing.",
  },
];

describe("story treatment contract", () => {
  test("accepts exactly one faithful, bold, and wildcard treatment", () => {
    const parsed = parseGeneratedTreatments(generated);
    expect(parsed.map((treatment) => treatment.kind)).toEqual(["faithful", "bold", "wildcard"]);
    expect(parsed.every((treatment) => treatment.anchors.length === 4)).toBe(true);
  });

  test("rejects three cosmetic copies of the same logline", () => {
    const duplicate = structuredClone(generated);
    duplicate.treatments.forEach((treatment) => {
      treatment.logline = "The exact same story follows two dancers through a collapsing underground room.";
    });
    expect(() => parseGeneratedTreatments(duplicate)).toThrow(/distinct/i);
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

  test("classifies honest coverage and requires a resolution for missing anchors", () => {
    const treatment = hydrateTreatmentCoverage(parseGeneratedTreatments(generated), moments)[0];
    expect(treatment.anchors.some((anchor) => anchor.coverage === "covered")).toBe(true);
    expect(treatment.anchors.some((anchor) => anchor.coverage === "missing")).toBe(true);
    expect(isStoryPlanConfirmable(treatment)).toBe(false);
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
        ? { ...anchor, resolution: "generate" as const, selectedCandidateId: null }
        : { ...anchor, resolution: "source" as const, selectedCandidateId: anchor.candidates[0]?.momentId ?? "dance-room" }),
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
