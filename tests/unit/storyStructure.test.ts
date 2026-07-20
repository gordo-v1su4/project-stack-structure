import { describe, expect, test } from "bun:test";

import {
  insertStoryTemplateInSongOrder,
  moveStorySectionBoundary,
  removeTimedStorySection,
  splitStorySectionWithTemplate,
} from "@/components/studio/storyStructure";
import type { StoryPlanDraft } from "@/components/studio/musicVideoProject";

const detectedPlan: StoryPlanDraft[] = [
  { id: "verse-1", label: "Verse", prompt: "Verse imagery", start: 0, end: 8, timingSource: "analysis" },
  { id: "outro", label: "Outro", prompt: "Outro imagery", start: 8, end: 12, timingSource: "analysis" },
];

describe("editable story structure", () => {
  test("splits the selected section at its nearest musical cue when adding a template", () => {
    const result = splitStorySectionWithTemplate({
      drafts: detectedPlan,
      activeId: "verse-1",
      template: { id: "chorus-1", label: "Chorus", prompt: "Hook imagery" },
      cueTimes: [1, 3.75, 7],
    });

    expect(result.map((draft) => [draft.id, draft.start, draft.end, draft.timingSource])).toEqual([
      ["verse-1", 0, 3.75, "manual"],
      ["chorus-1", 3.75, 8, "manual"],
      ["outro", 8, 12, "analysis"],
    ]);
  });

  test("adds a familiar song role in canonical order instead of splitting the selected card", () => {
    const result = insertStoryTemplateInSongOrder({
      drafts: [
        { id: "intro", label: "Intro", prompt: "Intro", start: 0, end: 4, timingSource: "analysis" },
        { id: "verse-1", label: "Verse", prompt: "Verse", start: 4, end: 12, timingSource: "analysis" },
        { id: "chorus-1", label: "Chorus", prompt: "Chorus", start: 12, end: 20, timingSource: "analysis" },
        { id: "bridge", label: "Bridge", prompt: "Bridge", start: 20, end: 28, timingSource: "analysis" },
        { id: "outro", label: "Outro", prompt: "Outro", start: 28, end: 32, timingSource: "analysis" },
      ],
      template: { id: "pre-chorus-1", label: "Pre-Chorus", prompt: "Build" },
      cueTimes: [2, 6, 9, 12, 16, 24, 30],
    });

    expect(result.map((draft) => [draft.id, draft.start, draft.end])).toEqual([
      ["intro", 0, 4],
      ["verse-1", 4, 9],
      ["pre-chorus-1", 9, 12],
      ["chorus-1", 12, 20],
      ["bridge", 20, 28],
      ["outro", 28, 32],
    ]);
  });

  test("places an intro before leading neutral parts", () => {
    const result = insertStoryTemplateInSongOrder({
      drafts: [
        { id: "part-1", label: "Part A", prompt: "Unknown opening", start: 0, end: 4, timingSource: "analysis" },
        { id: "verse-1", label: "Verse", prompt: "Verse", start: 4, end: 8, timingSource: "analysis" },
      ],
      template: { id: "intro", label: "Intro", prompt: "Opening" },
      cueTimes: [2, 6],
    });

    expect(result.map((draft) => [draft.id, draft.start, draft.end])).toEqual([
      ["intro", 0, 2],
      ["part-1", 2, 4],
      ["verse-1", 4, 8],
    ]);
  });

  test("moves a shared boundary without creating a gap or overlap", () => {
    const result = moveStorySectionBoundary({ drafts: detectedPlan, boundaryIndex: 0, time: 6 });

    expect(result.map((draft) => [draft.start, draft.end, draft.timingSource])).toEqual([
      [0, 6, "manual"],
      [6, 12, "manual"],
    ]);
  });

  test("removes a section while preserving complete timeline coverage", () => {
    const splitPlan: StoryPlanDraft[] = [
      { id: "intro", label: "Intro", prompt: "Intro imagery", start: 0, end: 2, timingSource: "analysis" },
      { id: "verse", label: "Verse", prompt: "Verse imagery", start: 2, end: 8, timingSource: "analysis" },
      { id: "outro", label: "Outro", prompt: "Outro imagery", start: 8, end: 12, timingSource: "analysis" },
    ];

    const result = removeTimedStorySection(splitPlan, "verse");

    expect(result.map((draft) => [draft.id, draft.start, draft.end])).toEqual([
      ["intro", 0, 8],
      ["outro", 8, 12],
    ]);
  });
});
