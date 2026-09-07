import { describe, expect, test } from "bun:test";

import { STORY_TREATMENT_MODEL, hydrateTreatmentCoverage, parseGeneratedTreatments, type StoryTreatmentRequest } from "@/components/studio/storyTreatments";
import { generateStoryTreatments, queueStoryTreatmentGeneration, STORY_DIRECTOR_INSTRUCTIONS, buildStoryInput } from "@/lib/storyTreatmentServer";

const request: StoryTreatmentRequest = {
  brief: "Two strangers cross paths in an underground maze and reunite in a collapsing dance arena.",
  song: { title: "Love Me Tonight", sections: [{ label: "Intro", start: 0, end: 8 }] },
  footage: { captionClusters: ["crowd dancing on cracked floor"], sourceCount: 21, momentCount: 42 },
};

describe("story treatment Qwen service", () => {
  test("preserves locked chronology and ending in every option and requests substantive diversity on retry", () => {
    expect(STORY_DIRECTOR_INSTRUCTIONS).toContain("All three options preserve explicit user constraints");
    expect(STORY_DIRECTOR_INSTRUCTIONS).toContain("Different treatments may share the same specified ending");
    expect(STORY_DIRECTOR_INSTRUCTIONS).not.toContain("wildcard changes the premise");
    const retry = buildStoryInput(request, 1);
    expect(retry).toContain("Do not return duplicate options or change the required ending");
    expect(retry).toContain(request.brief);
    expect(buildStoryInput({ ...request, validationFeedback: "Include every shot requirement." }, 1)).toContain("Correct this validation failure: Include every shot requirement.");
    expect(buildStoryInput({ ...request, validationFeedback: "Not applicable" }, 0)).not.toContain("Correct this validation failure");
    expect(retry).toContain('"requirements":[{"id":"shot-1","momentId":"moment-1"');
    expect(retry).toContain("requirements present on EVERY anchor");
    expect(retry).toContain("Do not copy an option and merely change its title");
  });

  test("queues Trigger without blocking on the run result", async () => {
    const queued = await queueStoryTreatmentGeneration(request, {
      gatewayModel: STORY_TREATMENT_MODEL,
      trigger: async payload => {
        expect(payload.operation).toBe("generate");
        expect(payload.reviewContext).toEqual({ brief: request.brief, constraints: [] });
        return { id: "run-story-queue" };
      },
    });
    expect(queued).toEqual({ runId: "run-story-queue", model: STORY_TREATMENT_MODEL });
  });

  test("queues only the selected story for targeted revision", async () => {
    const treatment = hydrateTreatmentCoverage(parseGeneratedTreatments(buildValidPayload()), [])[0];
    const calls: Array<{ operation?: "generate" | "revise"; instructions: string; input: string }> = [];
    await queueStoryTreatmentGeneration({ ...request, revision: { treatment, instruction: "Start outside the cave, preserve the later story." } }, {
      trigger: async payload => {
        expect(payload.reviewContext.constraints).toContain("Start outside the cave, preserve the later story.");
        expect(payload.reviewContext.brief).toBe(request.brief);
        calls.push(payload); return { id: "run-revise-one" };
      },
    });
    expect(calls[0].operation).toBe("revise");
    expect(calls[0].instructions).toContain("Revise only the supplied selected treatment");
    expect(calls[0].input).toContain("Start outside the cave");
    expect(calls[0].input).toContain("selectedTreatment");
    expect(calls[0].instructions).not.toContain("exactly three distinct treatments");
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
          loglineReview: { version: 1, status: "passed" },
          model: STORY_TREATMENT_MODEL,
          output: valid,
          usage: { prompt_tokens: 100, completion_tokens: 200 },
        } as T;
      },
    });

    expect(calls).toHaveLength(2);
    expect(calls[1].input).toContain("Correct this validation failure: Return exactly three complete treatment objects");
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
        loglineReview: { version: 1, status: "passed" },
        model: STORY_TREATMENT_MODEL,
        output: { treatments: [] },
      } as T),
    })).rejects.toThrow(/after validation retry/i);
  });

  test("rejects an old worker's unreviewed output without dispatching a second generation", async () => {
    let dispatches = 0;
    await expect(generateStoryTreatments(request, {
      trigger: async () => { dispatches++; return { id: "old-worker" }; },
      waitForRun: async <T,>() => ({ ok: true, model: STORY_TREATMENT_MODEL, output: buildValidPayload() }) as T,
    })).rejects.toThrow("needs its logline-review update");
    expect(dispatches).toBe(1);
  });

  test("retries rejected semantic review with corrected pitch instructions", async () => {
    const inputs: string[] = [];
    await generateStoryTreatments(request, {
      trigger: async payload => { inputs.push(payload.input); return { id: "review-attempt" }; },
      waitForRun: async <T,>() => {
        if (inputs.length === 1) throw new Error("Story logline review failed: unsupported stakes");
        return { ok: true, loglineReview: { version: 1, status: "passed" }, model: STORY_TREATMENT_MODEL, output: buildValidPayload() } as T;
      },
    });
    expect(inputs).toHaveLength(2);
    expect(inputs[1]).toContain("Rewrite the logline sentence");
    expect(inputs[1]).toContain("all supported by the story");
    expect(inputs[1]).not.toContain("unsupported stakes");
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
