import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMusicVideoProject, type StoryPlanDraft } from "@/components/studio/musicVideoProject";
import { createDefaultStoryTabState, StoryTab } from "@/components/studio/panels/StoryTab";
import { reconcileDetectedStorySongMap } from "@/components/studio/storySongMap";
import type { BeatJoinAnalysis } from "@/components/studio/types";

// Boundary/role sequence from the master-song reanalysis regression: the old
// estimated nine-row map remained saved after sixteen CUDA detections arrived.
const boundaries = [0, 0.21, 14.75, 29.3, 43.84, 60.2, 74.74, 89.29, 103.84, 127.48, 142.02, 156.57, 171.12, 196.57, 211.1, 243.85, 246.69995464852607];
const roles = ["intro", "intro", "verse", "verse", "verse", "chorus", "chorus", "verse", "verse", "chorus", "chorus", "bridge", "bridge", "chorus", "chorus", "section"];
const analysis: BeatJoinAnalysis = {
  sourceLabel: "master.wav", audioUrl: "", waveform: [], energy: [], beats: [], onsets: [], duration: boundaries.at(-1)!,
  sections: roles.map((label, index) => ({ label, start: boundaries[index], end: boundaries[index + 1], provenance: { status: "detected", method: "allin1:harmonix-all", device: "cuda" } })),
};
const oldLabels = ["Intro", "Verse 1", "Verse 2", "Verse 3", "Verse 4", "Chorus 1", "Chorus 2", "Chorus 3", "Outro"];
const oldBounds = [0, 15, 45.243, 75.486, 105.729, 135.971, 166.214, 196.457, 226.7, 246.504];
const staleDrafts: StoryPlanDraft[] = oldLabels.map((label, index) => ({
  id: label.toLowerCase().replaceAll(" ", "-"), label, prompt: `Reviewed intent for ${label}`,
  start: oldBounds[index], end: oldBounds[index + 1], timingSource: "analysis",
}));

describe("detected story song-map reconciliation", () => {
  test("replaces nine stale numeric windows with sixteen current detections and passes those times downstream", () => {
    const next = reconcileDetectedStorySongMap(staleDrafts, analysis, analysis.duration!);
    expect(next).toHaveLength(16);
    expect(next.map(({ start }) => start)).toEqual(boundaries.slice(0, -1));
    expect(next.at(-1)?.end).toBe(246.7);
    expect(next.find(({ id }) => id === "verse-1")?.prompt).toBe("Reviewed intent for Verse 1");
    const project = createMusicVideoProject({ analysis, duration: analysis.duration!, storyDrafts: next });
    expect(project.song?.sections).toEqual(analysis.sections);
    expect(project.storySections.map(({ start, end }) => [start, end])).toEqual(next.map(({ start, end }) => [start, end]));
    expect(project.editPlan.timelineItems.map(({ start, end }) => [start, end])).toEqual(next.map(({ start, end }) => [start, end]));
    expect(reconcileDetectedStorySongMap(next, analysis, analysis.duration!)).toBe(next);
    const restored = JSON.parse(JSON.stringify(next)) as StoryPlanDraft[];
    expect(reconcileDetectedStorySongMap(restored, analysis, analysis.duration!)).toBe(restored);
  });

  test("preserves manually changed boundaries, including a mixed manual/detected map", () => {
    const manual = staleDrafts.map((draft, index) => index === 0 ? { ...draft, end: 12, timingSource: "manual" as const } : draft);
    expect(reconcileDetectedStorySongMap(manual, analysis, analysis.duration!)).toBe(manual);
    const legacyUntyped = staleDrafts.map((draft) => ({ ...draft, timingSource: undefined }));
    expect(reconcileDetectedStorySongMap(legacyUntyped, analysis, analysis.duration!)).toBe(legacyUntyped);
  });

  test("preserves a legacy manually renamed section that still claimed analysis timing", () => {
    const renamed = staleDrafts.map((draft, index) => index === 0 ? { ...draft, label: "Arrival in the jungle" } : draft);
    expect(reconcileDetectedStorySongMap(renamed, analysis, analysis.duration!)).toBe(renamed);
  });

  test("does not erase a map while analysis is unavailable and keeps edited intent on ambiguous parts", () => {
    expect(reconcileDetectedStorySongMap(staleDrafts, null, analysis.duration!)).toBe(staleDrafts);
    expect(reconcileDetectedStorySongMap(staleDrafts, { ...analysis, sections: [] }, analysis.duration!)).toBe(staleDrafts);
    const next = reconcileDetectedStorySongMap(staleDrafts, analysis, analysis.duration!);
    next.at(-1)!.prompt = "Hold the post-escape image";
    expect(reconcileDetectedStorySongMap(next, analysis, analysis.duration!)).toBe(next);
  });

  test("Story renders the new sixteen-row map immediately, before its persistence effect", () => {
    const markup = renderToStaticMarkup(createElement(StoryTab, {
      analysis, audioStatus: "Ready", videoSources: [], segmentPreviews: [],
      state: {
        ...createDefaultStoryTabState(), storyBeats: staleDrafts, storyGenerated: true,
        transcriptSummary: {
          provider: "deepgram", model: "nova-3", duration: 240, confidence: 1,
          transcript: "", wordCount: 0, chunks: [], srt: "", summary: "", topics: [],
          intents: [], sentiments: null, averageSentiment: null, entities: [], warnings: [],
        },
      },
      onStateChange: () => {},
    }));
    const table = markup.slice(markup.lastIndexOf("<table"));
    expect((table.match(/<tr\b/g) ?? []).length).toBe(17); // header + sixteen detected rows
    expect(table).toContain("Chorus 6");
    expect(table).toContain("Bridge 2");
    // A shorter vocal stem must not truncate the master song's final window.
    expect(table).toContain("4:03–4:06");
    expect(table).not.toContain("Reviewed intent for Outro");
    expect(table).toContain("Unconfirmed");
  });
});
