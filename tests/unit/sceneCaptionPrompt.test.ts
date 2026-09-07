import { describe, expect, test } from "bun:test";

import {
  buildSceneCaptionPrompt,
  serializeSceneCaptionContext,
  serializeSceneCaptionReferences,
  serializeFactualSceneCaptionContext,
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
    locations: [{ name: "The Ember Ballroom" }],
  },
  referenceImages: [
    {
      name: "Diego",
      role: "primary",
      bucket: "stack-structure",
      objectKey: "reference-assets/character-1/diego.png",
    },
    {
      name: "The Ember Ballroom",
      role: "environment",
      bucket: "stack-structure",
      objectKey: "reference-assets/environment/ember-ballroom.png",
    },
  ],
};

describe("detailed Qwen scene caption profile", () => {
  test("asks for detailed cinematic visual facts and exact known character names", () => {
    const prompt = buildSceneCaptionPrompt(settings);
    expect(prompt).toContain("30-60 word sentence");
    expect(prompt).toContain("shot size and composition");
    expect(prompt).toContain("exact character name");
    expect(prompt).toContain("identify them by name only");
    expect(prompt).toContain("reference image is authoritative");
    expect(prompt).toContain("Do not assign a listed name");
    expect(prompt).toContain("exact location name");
    expect(prompt).toContain("close-up or detail shot");
  });

  test("serializes project identity context separately from durable reference images", () => {
    expect(JSON.parse(serializeSceneCaptionContext(settings))).toMatchObject({
      projectContext: {
        captionStyle: "detailed-cinematic",
        characters: [{ name: "Diego" }, { name: "Valentina" }],
        locations: [{ name: "The Ember Ballroom" }],
      },
    });
    expect(JSON.parse(serializeSceneCaptionReferences(settings))).toEqual(settings.referenceImages);
  });

  test("story and lyric edits cannot alter factual caption context or leak through legacy fields", () => {
    const scene = { sourceId: "2", sceneId: 0, sceneStart: 0, sceneEnd: 1.833, input: { kind: "ordered-frames", sampleTimes: [0.05, 0.916, 1.783], urls: ["https://media.example/strip.jpg"] } };
    const narrative = { storySummary: "The club collapses", storyPrompts: ["Diego and Valentina dance together"], lyricExcerpt: "Run away", projectIntent: "Escape ending", songTitle: "Escape", vocalStemName: "Run" };
    const clean = serializeSceneCaptionContext(settings, scene);
    const contaminated = serializeSceneCaptionContext({ ...settings, context: { ...settings.context, ...narrative } }, { ...scene, ...narrative });
    expect(contaminated).toBe(clean);
    expect(JSON.parse(contaminated)).toMatchObject({ ...scene, projectContext: { characters: settings.context!.characters, locations: settings.context!.locations } });
    expect(serializeFactualSceneCaptionContext(JSON.stringify({ ...scene, ...narrative, projectContext: { ...settings.context, ...narrative } }))).toBe(clean);
    expect(serializeFactualSceneCaptionContext("Diego must escape in the intro")).not.toContain("escape");
    for (const field of ["storySummary", "storyPrompts", "lyricExcerpt", "projectIntent", "songTitle", "vocalStemName"]) expect(contaminated).not.toContain(field);
  });
});
