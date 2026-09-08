import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { getCutMapRailWidth, SplitTab } from "@/components/studio/panels/SplitTab";
import { buildSceneSplitSegments, buildSourceClipSpans } from "@/components/studio/sourceTimeline";
import { makeVideoSources } from "../helpers/studioFixtures";

describe("SplitTab simplified workflow", () => {
  test("keeps a readable source duration scale", () => {
    expect(getCutMapRailWidth(357)).toBe(2856);
    expect(getCutMapRailWidth(20)).toBe(960);
  });

  test("reviews detected scenes without asking for another subdivision", () => {
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
      videoSources: sources,
      videoStatus: "Ready",
      videoError: null,
      isPreparingVideos: false,
      sourceClips,
      segments,
      activeClip: 0,
      onVideoUpload: () => {},
      onActiveClip: () => {},
    }));

    expect(markup).toContain("Review detected scenes");
    expect(markup).not.toContain("Create source cut windows");
    expect(markup).not.toContain("Scene + Rhythm");
    expect(markup).toContain("Scene captions");
    expect(markup).toContain("Detected scenes · source time");
    expect(markup).toContain("Original clips stay intact.");
    expect(markup).toContain("S1 · 0:00–0:04");
    expect(markup).not.toContain("Scene + Beat");
    expect(markup).not.toContain("Cut thumbnails + caption readiness");
    expect(markup).not.toContain("events/cut");
  });
});
