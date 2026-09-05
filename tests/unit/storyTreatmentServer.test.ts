import { describe, expect, test } from "bun:test";

import { STORY_TREATMENT_MODEL, type StoryTreatmentRequest } from "@/components/studio/storyTreatments";
import { generateStoryTreatments } from "@/lib/storyTreatmentServer";

const request: StoryTreatmentRequest = {
  brief: "Two strangers cross paths in an underground maze and reunite in a collapsing dance arena.",
  song: { title: "Love Me Tonight", sections: [{ label: "Intro", start: 0, end: 8 }] },
  footage: { captionClusters: ["crowd dancing on cracked floor"], sourceCount: 21, momentCount: 42 },
};

describe("story treatment OpenAI service", () => {
  test("uses GPT-5.4 mini, structured output, store false, and retries malformed output once", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const valid = buildValidPayload();
    const client = {
      responses: {
        create: async (input: Record<string, unknown>) => {
          calls.push(input);
          return calls.length === 1
            ? { output_text: "{not-json", model: STORY_TREATMENT_MODEL, usage: null }
            : { output_text: JSON.stringify(valid), model: STORY_TREATMENT_MODEL, usage: { input_tokens: 100, output_tokens: 200 } };
        },
      },
    };
    const result = await generateStoryTreatments(request, {
      client: client as never,
      now: () => new Date("2026-09-02T12:00:00.000Z"),
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]?.model).toBe(STORY_TREATMENT_MODEL);
    expect(calls[0]?.store).toBe(false);
    expect((calls[0]?.text as { format?: { type?: string } }).format?.type).toBe("json_schema");
    expect(result.treatments).toHaveLength(3);
    expect(result.meta).toEqual({
      model: STORY_TREATMENT_MODEL,
      generatedAt: "2026-09-02T12:00:00.000Z",
      inputTokens: 100,
      outputTokens: 200,
    });
  });

  test("fails after one validation retry", async () => {
    const client = { responses: { create: async () => ({ output_text: "{}", model: STORY_TREATMENT_MODEL, usage: null }) } };
    await expect(generateStoryTreatments(request, { client: client as never })).rejects.toThrow(/after validation retry/i);
  });
});

function buildValidPayload() {
  return {
    treatments: ["faithful", "bold", "wildcard"].map((kind, index) => ({
      id: kind,
      kind,
      title: `${kind} treatment`,
      logline: `${kind} strangers navigate a dangerous dance labyrinth toward a distinct final choice ${index}.`,
      synopsis: `The ${kind} version creates a concrete progression through separate rooms, a missed encounter, a physical search, and a visually distinct finale driven primarily by dance.`,
      visualThesis: "Hard pools of light isolate dancers as the underground architecture fractures.",
      endingHook: `${kind} resolves with its own final image and reversal.`,
      expectedReusePercent: 80,
      expectedGenerationPercent: 20,
      anchors: Array.from({ length: 4 }, (_, anchorIndex) => ({
        id: `${kind}-${anchorIndex}`,
        title: `Anchor ${anchorIndex + 1}`,
        description: `A concrete filmable dance action advances chapter ${anchorIndex + 1} through the underground complex.`,
        purpose: "Advance character movement and spatial geography.",
        generationPrompt: "Cinematic wide shot of dancers in a fractured underground room with practical lighting.",
      })),
    })),
  };
}
