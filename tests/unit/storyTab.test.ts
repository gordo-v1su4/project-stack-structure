import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { createDefaultStoryTabState, prepareStoryTabPlacements, StoryTab } from "@/components/studio/panels/StoryTab";

import { createMusicVideoProject, isPlacementPlanCurrent } from "@/components/studio/musicVideoProject";

describe("StoryTab section map", () => {
  test("binds confirmed evidence before hashing placements, and later evidence changes invalidate them", () => {
    const project = createMusicVideoProject({ analysis: null, duration: 8, lyricChunks: [], storyDrafts: [{ id: "opening", label: "Opening", prompt: "Establish the jungle entrance", start: 0, end: 8 }], videoSources: [], segmentPreviews: [] });
    const prepared = prepareStoryTabPlacements({ project, videoSources: [] }, "approved-reference-revision");
    expect(prepared.sourceContextSignature).toBe("approved-reference-revision");
    expect(isPlacementPlanCurrent(prepared)).toBe(true);
    expect(isPlacementPlanCurrent({ ...prepared, sourceContextSignature: "recaptioned-revision" })).toBe(false);
  });
  test("renders one compact aligned table instead of oversized placeholder cards", () => {
    const state = {
      ...createDefaultStoryTabState(),
      storyGenerated: true,
      storyBeats: [
        { id: "verse-1", label: "Verse 1", prompt: "Diego enters the ballroom", start: 0, end: 4, timingSource: "manual" as const },
        { id: "chorus-1", label: "Chorus 1", prompt: "The dancers converge", start: 4, end: 8, timingSource: "manual" as const },
      ],
      activeBeatId: "verse-1",
      transcriptSummary: {
        provider: "deepgram" as const,
        model: "nova-3",
        duration: 8,
        confidence: 0.9,
        transcript: "Meet me in the fire",
        wordCount: 5,
        chunks: [{ index: 1, start: 0, end: 4, text: "Meet me in the fire" }],
        srt: "",
        summary: "",
        topics: [],
        intents: [],
        sentiments: null,
        averageSentiment: null,
        entities: [],
        warnings: [],
      },
    };
    const markup = renderToStaticMarkup(createElement(StoryTab, {
      analysis: null,
      audioStatus: "Ready",
      videoSources: [],
      segmentPreviews: [],
      state,
      onStateChange: () => {},
    }));

    expect(markup).toContain("<table");
    expect(markup).toContain("Lyrics in window");
    expect(markup).toContain("Story intent");
    expect(markup).toContain("Matched source");
    expect(markup).toContain("No matched source");
    expect(markup).toContain("Review song sections · rename or adjust timing");
    expect(markup).not.toContain('role="slider"');
    expect(markup).not.toContain("Image prompt");
    expect(markup).not.toContain("Stitch slot");
    expect(markup).not.toContain("Live edit density");
    expect(markup).not.toContain("Song-role palette");
    expect(markup).not.toContain("aspect-video");
  });

  test("renders three inspectable story choices with truthful footage gaps", () => {
    const base = createDefaultStoryTabState();
    const treatments = (["faithful", "bold", "wildcard"] as const).map((kind, treatmentIndex) => ({
      id: `${kind}-test`,
      kind,
      title: `${kind} maze`,
      logline: `${kind} story follows two strangers through a collapsing underground dance maze ${treatmentIndex}.`,
      synopsis: "A concrete two-to-three sentence treatment follows the missed encounter, escalating search, reunion, and collapse while performance remains dominant.",
      visualThesis: "Separate rooms become one dangerous visual rhythm.",
      endingHook: "The last image reframes the dance as a survival test.",
      expectedReusePercent: 75,
      expectedGenerationPercent: 25,
      anchors: Array.from({ length: 4 }, (_, anchorIndex) => ({
        id: `${kind}-${anchorIndex}`,
        title: `Anchor ${anchorIndex + 1}`,
        description: "A filmable action advances the strangers through the underground maze.",
        purpose: "Advance the search.",
        generationPrompt: "Cinematic underground dance chamber.",
        coverage: "missing" as const,
        candidates: [],
        selectedCandidateId: null,
        resolution: anchorIndex === 0 ? "generate" as const : null,
      })),
    }));
    const markup = renderToStaticMarkup(createElement(StoryTab, {
      analysis: { sourceLabel: "Love Me Tonight.wav", audioUrl: "", waveform: [], energy: [], beats: [], onsets: [], sections: [], duration: 8 },
      audioStatus: "Ready",
      videoSources: [],
      segmentPreviews: [],
      state: { ...base, treatments, selectedTreatmentId: treatments[0].id },
      onStateChange: () => {},
    }));

    expect(markup).toContain("Faithful");
    expect(markup).toContain("Bold");
    expect(markup).toContain("Wildcard");
    expect(markup).toContain("Read story: faithful maze");
    expect(markup).toContain("4 moments need footage");
    expect(markup).not.toContain("auto-resolved");
    expect(markup).not.toContain("75%");
    expect(markup).toContain("Missing shots remain visible as gaps");
  });
});
