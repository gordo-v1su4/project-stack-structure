import { describe, expect, test } from "bun:test";

import { STORY_TREATMENT_MODEL, type StoryTreatmentRequest } from "@/components/studio/storyTreatments";
import { generateStoryTreatments, queueStoryTreatmentGeneration } from "@/lib/storyTreatmentServer";

const request: StoryTreatmentRequest = {
  brief: "Two strangers cross paths in an underground maze and reunite in a collapsing dance arena.",
  song: { title: "Love Me Tonight", sections: [{ label: "Intro", start: 0, end: 8 }] },
  footage: { captionClusters: ["crowd dancing on cracked floor"], sourceCount: 21, momentCount: 42 },
};

describe("story treatment Qwen service", () => {
  test("queues Trigger without blocking on the run result", async () => {
    const queued = await queueStoryTreatmentGeneration(request, {
      gatewayModel: STORY_TREATMENT_MODEL,
      trigger: async () => ({ id: "run-story-queue" }),
    });
    expect(queued).toEqual({ runId: "run-story-queue", model: STORY_TREATMENT_MODEL });
  });

  test("dispatches Trigger, waits for the run, and retries malformed output once", async () => {
    const calls: Array<{ instructions: string; input: string }> = [];
    const valid = buildValidPayload();
    let attempt = 0;
    const result = await generateStoryTreatments(request, {
      now: () => new Date("2026-09-02T12:00:00.000Z"),
      gatewayModel: STORY_TREATMENT_MODEL,
      trigger: async (payload) => {
        calls.push({ instructions: payload.instructions, input: payload.input });
        attempt += 1;
        return { id: `run-story-${attempt}` };
      },
      waitForRun: async <T,>(_runId: string) => {
        if (attempt === 1) throw new Error("Story response must contain exactly three treatments.");
        return {
          ok: true,
          model: STORY_TREATMENT_MODEL,
          output: valid,
          usage: { prompt_tokens: 100, completion_tokens: 200 },
        } as T;
      },
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]?.instructions).toContain("captionClusters");
    expect(result.treatments).toHaveLength(3);
    expect(result.meta).toEqual({
      model: STORY_TREATMENT_MODEL,
      generatedAt: "2026-09-02T12:00:00.000Z",
      inputTokens: 100,
      outputTokens: 200,
    });
  });

  test("fails after one validation retry", async () => {
    await expect(generateStoryTreatments(request, {
      trigger: async () => ({ id: "run-story-fail" }),
      waitForRun: async <T,>() => ({
        ok: true,
        model: STORY_TREATMENT_MODEL,
        output: { treatments: [] },
      } as T),
    })).rejects.toThrow(/after validation retry/i);
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
