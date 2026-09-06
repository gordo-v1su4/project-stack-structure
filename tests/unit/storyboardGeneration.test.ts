import { describe, expect, test } from "bun:test";
import { runStoryboardChecks } from "@/components/studio/storyboardChecks";
import { buildSequenceGridPrompt, buildFreshFramePrompt, referenceContract, type StoryboardReference } from "@/components/studio/storyboardGeneration";

const references: StoryboardReference[] = [
  { url: "https://fixture.invalid/diego.png", label: "Diego", role: "character-1" },
  { url: "https://fixture.invalid/valentina.png", label: "Valentina", role: "character-2" },
  { url: "https://fixture.invalid/club.png", label: "Underground Latin Club", role: "environment" },
  { url: "https://fixture.invalid/frame.jpg", label: "Intro · 0:00–0:15", role: "composition" },
];

describe("concise image prompts", () => {
  test("keeps the requested action while leaving production metadata out of the prompt", () => {
    const intent = "Diego and Valentina dance together in the crowded Underground Latin Club. Dark red and amber light, a little darker and hazy.";
    const prompt = buildSequenceGridPrompt(references, intent);
    expect(prompt).toContain(intent);
    expect(prompt).toContain("3x3 cinematic anamorphic grid of shots");
    expect(prompt).not.toMatch(/Image_|storyboard|contact sheet|2K|16:9|Intro|\d+:\d+|panel|left-to-right|handles/i);
    expect(prompt.split(/\s+/).length).toBeLessThan(140);
  });

  test("reordering attachments updates the plain-English role numbers", () => {
    const contract = referenceContract([references[2], references[1], references[0], references[3]]);
    expect(contract).toContain("Image 1 is the master location reference for Underground Latin Club.");
    expect(contract).toContain("Image 2 is the character sheet for Valentina.");
    expect(contract).toContain("Image 3 is the character sheet for Diego.");
    expect(contract).toContain("Image 4 guides character blocking and placement in the environment only.");
    expect(contract).toContain("Do not copy texture, image quality or facial detail.");
    expect(contract).not.toMatch(/authoritative|\(|\)|Image_/);
  });

  test("fresh frames retain composition and identity roles without grid or timing instructions", () => {
    const prompt = buildFreshFramePrompt(references);
    expect(prompt).toContain("one new cinematic anamorphic photograph");
    expect(prompt).toContain("Do not upscale the reference.");
    expect(prompt).toContain("exact identity and wardrobe lock");
    expect(prompt).not.toMatch(/3x3|storyboard|contact sheet|2K|16:9|Intro|\d+:\d+/i);
  });
});

describe("storyboard review and whole-shot replacement contracts", () => {
  for (const result of runStoryboardChecks()) {
    test(result.label, () => expect(result.passed).toBe(true));
  }
});
