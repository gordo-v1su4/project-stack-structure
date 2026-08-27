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
    expect(markup).toContain('role="slider"');
    expect(markup).toContain("Drag an orange divider");
    expect(markup).not.toContain("Image prompt");
    expect(markup).not.toContain("Stitch slot");
    expect(markup).not.toContain("Live edit density");
    expect(markup).not.toContain("Song-role palette");
    expect(markup).not.toContain("aspect-video");
  });
});
