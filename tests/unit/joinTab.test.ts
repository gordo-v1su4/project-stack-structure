import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { JoinTab } from "@/components/studio/panels/JoinTab";
import type { EditPlanPreviewSegment } from "@/components/studio/musicVideoProject";

describe("JoinTab resolved edit", () => {
  test("shows the actual Match sequence instead of Split candidates or fake toggles", () => {
    const segments: EditPlanPreviewSegment[] = [
      {
        videoUrl: "blob:first",
        startTime: 1.25,
        endTime: 3.75,
        musicStart: 0,
        musicEnd: 2.5,
        sectionId: "intro",
        sourceClipId: 4,
        sourceRefLabel: "S5 · Scene 01",
        label: "Intro cut",
        thumbnailUrl: "/first.jpg",
      },
      {
        videoUrl: "blob:second",
        startTime: 10.5,
        endTime: 13.1,
        musicStart: 2.5,
        musicEnd: 5.1,
        sectionId: "intro",
        sourceClipId: 12,
        sourceRefLabel: "S13 · Scene 04",
        label: "Intro cut 2",
        thumbnailUrl: "/second.jpg",
      },
    ];

    const markup = renderToStaticMarkup(createElement(JoinTab, {
      previewSegments: segments,
      activeClip: 0,
      onActiveClip: () => {},
    }));

    expect(markup).toContain("Resolved edit locked to preview / export");
    expect(markup).toContain("2 cuts");
    expect(markup).toContain("S5 · Scene 01");
    expect(markup).toContain("S13 · Scene 04");
    expect(markup).toContain("SONG 0:00.00–0:02.50");
    expect(markup).not.toContain("click to toggle on/off");
    expect(markup).not.toContain("SKIP");
  });
});
