import OpenAI from "openai";

import {
  STORY_TREATMENT_MODEL,
  STORY_TREATMENTS_JSON_SCHEMA,
  hydrateTreatmentCoverage,
  parseGeneratedTreatments,
  type StoryTreatmentGenerationResult,
  type StoryTreatmentRequest,
} from "@/components/studio/storyTreatments";

type ResponsesClient = Pick<OpenAI, "responses">;

export async function generateStoryTreatments(
  request: StoryTreatmentRequest,
  options: { apiKey?: string; client?: ResponsesClient; now?: () => Date } = {},
): Promise<StoryTreatmentGenerationResult> {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (!options.client && !apiKey) throw new Error("OPENAI_API_KEY is not configured.");
  const client = options.client ?? new OpenAI({ apiKey, timeout: 25_000, maxRetries: 0 });
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await client.responses.create({
        model: STORY_TREATMENT_MODEL,
        store: false,
        reasoning: { effort: "medium" },
        max_output_tokens: 8_000,
        instructions: STORY_DIRECTOR_INSTRUCTIONS,
        input: buildStoryInput(request, attempt),
        text: {
          format: {
            type: "json_schema",
            name: "music_video_story_treatments",
            strict: true,
            schema: STORY_TREATMENTS_JSON_SCHEMA,
          },
        },
      });
      if (!response.output_text?.trim()) throw new Error("OpenAI returned no story treatment text.");
      const parsed = parseGeneratedTreatments(JSON.parse(response.output_text));
      return {
        treatments: hydrateTreatmentCoverage(parsed, []),
        meta: {
          model: response.model || STORY_TREATMENT_MODEL,
          generatedAt: (options.now?.() ?? new Date()).toISOString(),
          inputTokens: response.usage?.input_tokens,
          outputTokens: response.usage?.output_tokens,
        },
      };
    } catch (error) {
      lastError = error;
    }
  }

  const message = lastError instanceof Error ? lastError.message : "Story treatment generation failed.";
  throw new Error(`Story treatment generation failed after validation retry: ${message}`);
}

const STORY_DIRECTOR_INSTRUCTIONS = `You are the story director for a performance-led music video editor.
Return exactly three visually directed treatments: one faithful, one bold, and one wildcard.
The story is a light cinematic spine; dance, performance, movement, and existing footage should occupy roughly 80-90 percent of the finished video.
Treat the user's brief as canon for the faithful option. Never invent a pre-existing relationship when the brief says the leads are strangers.
Make the three causal structures and endings genuinely different, not cosmetic rewrites.
Use the supplied footage captions honestly. If an essential beat is not supported, describe it as a generation-ready anchor instead of pretending footage exists.
Keep any simulation, competition, or last-one-standing reveal late unless the brief explicitly requests an early reveal.
Write in concrete, filmable images with clear geography, movement, escalation, and an ending hook. Avoid generic romance language and abstract mood-board filler.
Each treatment needs four to six chronological anchors. Each anchor's generationPrompt must be a standalone, filmable shot description without provider syntax.`;

function buildStoryInput(request: StoryTreatmentRequest, attempt: number) {
  const context = {
    userBrief: request.brief || "No user brief supplied. Infer a performance-led story from the song and footage evidence.",
    song: request.song,
    footage: request.footage,
    constraints: request.constraints ?? [],
  };
  return [
    "Develop three director-level music-video treatments from this derived project context.",
    "The faithful treatment must preserve every explicit user-story fact. The bold treatment may make the location or visual system an active antagonist. The wildcard treatment may introduce a late reveal or reversal.",
    "Coverage percentages are editorial estimates based only on the caption evidence; they must add to 100 for each treatment.",
    attempt > 0 ? "This is a validation retry. Correct the prior shape and return only schema-valid, distinct treatments." : "",
    JSON.stringify(context, null, 2),
  ].filter(Boolean).join("\n\n");
}
