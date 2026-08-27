import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { MatchTab } from "@/components/studio/panels/MatchTab";

describe("MatchTab combined scoring", () => {
  test("presents one automatic multi-signal matcher instead of strategy choices", () => {
    const markup = renderToStaticMarkup(createElement(MatchTab, {
      project: null,
      analysis: null,
      storyGenerated: false,
      onsetDensity: 65,
      lyricCueBlend: 60,
      lyricMergeWindow: 3,
      videoSources: [],
      onOnsetDensity: () => {},
      onLyricCueBlend: () => {},
      onLyricMergeWindow: () => {},
      onSelectStory: () => {},
      onSelectSplit: () => {},
      onSelectCandidate: () => {},
    }));

    expect(markup).toContain("Balanced multi-signal match");
    expect(markup).toContain("Lyrics + captions");
    expect(markup).toContain("Motion edges");
    expect(markup).toContain("Color continuity");
    expect(markup).toContain("Repeat control");
    expect(markup).not.toContain("Match / shuffle strategy");
    expect(markup).not.toContain(">Semantic</button>");
    expect(markup).not.toContain(">Motion</button>");
  });
});
