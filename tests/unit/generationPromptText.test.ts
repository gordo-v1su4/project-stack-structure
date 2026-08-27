import { describe, expect, test } from "bun:test";

import { getGenerationMomentCaption, resolveGenerationFrameMoment } from "@/components/studio/panels/GenerateTab";
import type { EditPlanPreviewSegment, VideoMoment } from "@/components/studio/musicVideoProject";

function moment(caption: string): VideoMoment {
  return {
    id: "moment-1",
    sourceClipId: 0,
    label: "Scene 1",
    start: 0,
    end: 2,
    duration: 2,
    caption,
  };
}

describe("generation prompt caption safety", () => {
  test("does not copy a named-character caption into a prompt when that character has a reference sheet", () => {
    expect(getGenerationMomentCaption(
      moment("Diego, in a red plaid shirt, turns toward Valentina on the dance floor."),
      ["Diego", "Valentina"],
    )).toBe(undefined);
  });

  test("keeps source context that does not describe a referenced character", () => {
    expect(getGenerationMomentCaption(
      moment("A red door opens into the Underground Club as the crowd moves toward the stage."),
      ["Diego", "Valentina"],
    )).toContain("Underground Club");
  });

  test("anchors continuation frames to the selected resolved cut instead of a section fallback", () => {
    const sectionFallback = { ...moment("Section fallback"), id: "moment-fallback", sourceRefLabel: "S2 · Scene 07" };
    const selectedMoment = { ...moment("Selected cut"), id: "moment-selected", sourceRefLabel: "S10 · Scene 01", lastFrameUrl: "https://media.example/s10-last.jpg" };
    const selectedSegment: EditPlanPreviewSegment = {
      videoUrl: "https://media.example/s10.mp4",
      startTime: 0,
      endTime: 2.94,
      label: "Chorus 3",
      sectionId: "chorus-3",
      musicStart: 212.06,
      musicEnd: 214.99,
      momentId: selectedMoment.id,
      sourceRefLabel: selectedMoment.sourceRefLabel,
    };

    expect(resolveGenerationFrameMoment({
      videoMoments: [sectionFallback, selectedMoment],
      focusSlot: undefined,
      selectedSegment,
    })).toBe(selectedMoment);
  });
});
