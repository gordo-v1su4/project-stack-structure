import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { createDefaultStoryTabState, StoryTab } from "@/components/studio/panels/StoryTab";

describe("StoryTab section map", () => {
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
    expect(markup).toContain("Timing &amp; Song Structure · advanced");
    expect(markup).not.toContain('role="slider"');
    expect(markup).not.toContain("Image prompt");
    expect(markup).not.toContain("Stitch slot");
    expect(markup).not.toContain("Live edit density");
    expect(markup).not.toContain("Song-role palette");
    expect(markup).not.toContain("aspect-video");
  });

  test("renders three treatment choices and the required anchor review", () => {
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
    expect(markup).toContain("Architecture as antagonist");
    expect(markup).toContain("Late reversal");
    expect(markup).toContain("Anchor review");
    expect(markup).toContain("Plan generation");
    expect(markup).toContain("Confirm story plan");
    expect(markup).toContain("Timing &amp; Song Structure");
  });
});
