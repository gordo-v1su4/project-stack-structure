import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { getCutMapRailWidth, SplitTab } from "@/components/studio/panels/SplitTab";
import { buildSceneSplitSegments, buildSourceClipSpans } from "@/components/studio/sourceTimeline";
import { makeBeatJoinAnalysis, makeVideoSources } from "../helpers/studioFixtures";

describe("SplitTab simplified workflow", () => {
  test("keeps one duration scale when pace changes the candidate count", () => {
    expect(getCutMapRailWidth(357)).toBe(2856);
    expect(getCutMapRailWidth(20)).toBe(960);
  });

  test("presents three understandable strategies and a readable cut table", () => {
    const [source] = makeVideoSources();
    const sources = [{
      ...source!,
      scenes: [
        {
          id: 0,
          sourceClipId: source!.id,
          label: "Scene 1",
          start: 0,
          end: source!.duration,
          duration: source!.duration,
          detector: "pyscenedetect-adaptive" as const,
          caption: "A dancer moves through shallow water.",
        },
      ],
    }];
    const sourceClips = buildSourceClipSpans(sources);
    const segments = buildSceneSplitSegments(sources);
    const markup = renderToStaticMarkup(createElement(SplitTab, {
      playhead: 0.1,
      clipDur: 6,
      mode: "scene",
      analysis: makeBeatJoinAnalysis(),
      videoSources: sources,
      videoStatus: "Ready",
      videoError: null,
      isPreparingVideos: false,
      sourceClips,
      segments,
      activeClip: 0,
      onVideoUpload: () => {},
      onClipDur: () => {},
      onModeChange: () => {},
      onActiveClip: () => {},
    }));

    expect(markup).toContain("Create source cut windows");
    expect(markup).toContain("Scene + Rhythm");
    expect(markup).toContain("Candidate cut table");
    expect(markup).toContain("Cut numbers are candidate windows, not frames");
    expect(markup).toContain("S1 · 0:00–0:04");
    expect(markup).not.toContain("Scene + Beat");
    expect(markup).not.toContain("Cut thumbnails + caption readiness");
    expect(markup).not.toContain("events/cut");
  });
});
