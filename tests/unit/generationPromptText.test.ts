import { describe, expect, test } from "bun:test";

import { getGenerationMomentCaption } from "@/components/studio/panels/GenerateTab";
import type { VideoMoment } from "@/components/studio/musicVideoProject";

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
});
