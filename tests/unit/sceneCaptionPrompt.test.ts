import { describe, expect, test } from "bun:test";

import {
  buildSceneCaptionPrompt,
  serializeSceneCaptionContext,
  serializeSceneCaptionReferences,
} from "@/components/studio/sceneCaptionPrompt";
import type { SceneCaptionSettings } from "@/components/studio/types";

const settings: SceneCaptionSettings = {
  mode: "smart",
  context: {
    captionStyle: "detailed-cinematic",
    characters: [
      { name: "Diego", role: "primary" },
      { name: "Valentina", role: "secondary" },
    ],
  },
  referenceImages: [{
    name: "Diego",
    role: "primary",
    bucket: "stack-structure",
    objectKey: "reference-assets/character-1/diego.png",
  }],
};

describe("detailed Qwen scene caption profile", () => {
  test("asks for detailed cinematic visual facts and exact known character names", () => {
    const prompt = buildSceneCaptionPrompt(settings);
    expect(prompt).toContain("30-60 word sentence");
    expect(prompt).toContain("shot size and composition");
    expect(prompt).toContain("exact character name");
    expect(prompt).toContain("Do not assign a listed name");
  });

  test("serializes project identity context separately from durable reference images", () => {
    expect(JSON.parse(serializeSceneCaptionContext(settings))).toMatchObject({
      projectContext: {
        captionStyle: "detailed-cinematic",
        characters: [{ name: "Diego" }, { name: "Valentina" }],
      },
    });
    expect(JSON.parse(serializeSceneCaptionReferences(settings))).toEqual(settings.referenceImages);
  });
});
