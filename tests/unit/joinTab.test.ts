import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { JoinTab } from "@/components/studio/panels/JoinTab";
import type { EditPlanPreviewSegment } from "@/components/studio/musicVideoProject";

describe("JoinTab whole-song rough cut", () => {
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
      onActiveClip: () => {}, sectionLabels: {intro: "Intro"}, existingFootage: [],
      onPlayWhole: () => {}, onPlaySelection: () => {}, onFillGap: () => {}, onReviewAlternates: () => {},
      onRemove: () => {}, onSwap: () => {}, proposalSummary: null, editMessage: null, onApplyProposal: () => {},
      onCancelProposal: () => {}, onUndo: () => {}, canUndo: false, busy: false,
    }));

    expect(markup).toContain("Whole-song rough cut");
    expect(markup).toContain("Play whole song");
    expect(markup).toContain("Review replacement");
    expect(markup).toContain("Play selection");
    expect(markup).not.toContain('aria-label="Song sections"');
    expect(markup).toContain("S5 · Scene 01");
    expect(markup).toContain("S13 · Scene 04");
    expect(markup).toContain("Song 0:00.0–0:02.5");
    expect(markup).not.toContain("click to toggle on/off");
    expect(markup).not.toContain("SKIP");
  });
});
