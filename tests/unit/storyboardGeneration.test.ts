import { acceptedFreshFrame } from "../helpers/storyboardFrame";
import { describe, expect, test } from "bun:test";
import { runStoryboardChecks } from "@/components/studio/storyboardChecks";
import { bindStoryboardJobToSequence, storyboardJobMatchesSequence, buildStoryboardSequences, buildSequenceGridPrompt, buildFreshFramePrompt, referenceContract, resolveSequenceGridDirection, type StoryboardReference } from "@/components/studio/storyboardGeneration";

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


describe("section story directions", () => {
  test("distinct story actions survive into the image prompt", () => {
    const intro = "Diego and Valentina face each other in the club, leaning close.";
    const chorus = "Diego and Valentina sprint through the red-lit corridor.";
    const introPrompt = buildSequenceGridPrompt(references, resolveSequenceGridDirection(intro));
    const chorusPrompt = buildSequenceGridPrompt(references, resolveSequenceGridDirection(chorus));
    expect(introPrompt).toContain(intro);
    expect(chorusPrompt).toContain(chorus);
    expect(chorusPrompt).not.toContain(intro);
  });
  test("manual direction edits take precedence and clearing stays empty for validation", () => {
    expect(resolveSequenceGridDirection("Run through the corridor.", "Dance near the doorway.")).toBe("Dance near the doorway.");
    expect(resolveSequenceGridDirection("Run through the corridor.", " ")).toBe("");
  });
  test("missing story action remains missing instead of inventing generic direction", () => {
    expect(resolveSequenceGridDirection()).toBe("");
    expect(resolveSequenceGridDirection("Describe the visual idea for this song section")).toBe("");
  });
});


describe("story requirement sequence boundaries", () => {
  test("two different story moments in one music section retain separate generation directions", () => {
    const cuts = [
      { sectionId: "intro", videoUrl: "", kind: "gap", musicStart: 0, musicEnd: 3, startTime: 0, endTime: 3, label: "Opening", requirementId: "establish", storyDirection: "Wide jungle cave exterior" },
      { sectionId: "intro", videoUrl: "clip.mp4", kind: "source", musicStart: 3, musicEnd: 8, startTime: 0, endTime: 5, label: "Arrival", requirementId: "arrival", storyDirection: "Diego enters alone" },
    ] as import("@/components/studio/musicVideoProject").EditPlanPreviewSegment[];
    const groups = buildStoryboardSequences(cuts);
    expect(groups.length).toBe(2);
    expect(groups[0]!.direction).toBe("Wide jungle cave exterior");
    expect(groups[1]!.direction).toBe("Diego enters alone");
  });
});


describe("storyboard placement revision binding", () => {
  test("same-window changed story and legacy frames need explicit review before becoming current", () => {
    const job = acceptedFreshFrame().storyboard!;
    const sequence = buildStoryboardSequences([{ sectionId: "verse", videoUrl: "", kind: "gap", musicStart: 20, musicEnd: 30, startTime: 0, endTime: 10, label: "Solo arrival", planSignature: "edited-story", requirementId: "arrival", storyDirection: "Diego enters alone" }])[0]!;
    expect(storyboardJobMatchesSequence(job, sequence)).toBe(false);
    const legacy = { ...job, planSignature: undefined, requirementId: undefined };
    expect(storyboardJobMatchesSequence(legacy, sequence)).toBe(false);
    const explicitlyReviewed = bindStoryboardJobToSequence(legacy, sequence);
    expect(storyboardJobMatchesSequence(explicitlyReviewed, sequence)).toBe(true);
    expect(explicitlyReviewed.requirementId).toBe("arrival");
    expect(legacy.planSignature).toBe(undefined);
    expect(explicitlyReviewed.sourceGridId).toBe(job.sourceGridId);
    expect(() => bindStoryboardJobToSequence(job, { ...sequence, planSignature: undefined })).toThrow("Confirm the current story");
  });
});
