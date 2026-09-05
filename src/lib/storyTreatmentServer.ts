import {
  STORY_TREATMENT_MODEL,
  hydrateTreatmentCoverage,
  parseGeneratedTreatments,
  type StoryTreatmentGenerationResult,
  type StoryTreatmentRequest,
} from "@/components/studio/storyTreatments";
import { getStoryTreatmentGatewayConfig } from "@/lib/storyTreatmentGateway";
import {
  triggerStoryTreatment,
  waitForTriggerRunResult,
  type StoryTreatmentTriggerResult,
} from "@/lib/triggerOrchestration";

type GenerateStoryTreatmentsOptions = {
  now?: () => Date;
  trigger?: (payload: {
    instructions: string;
    input: string;
    model: string;
    maxTokens?: number;
  }) => Promise<{ id: string }>;
  waitForRun?: <T>(runId: string, options: { timeoutMs: number; pollIntervalMs?: number }) => Promise<T>;
  gatewayModel?: string;
};

export async function queueStoryTreatmentGeneration(
  request: StoryTreatmentRequest,
  options: GenerateStoryTreatmentsOptions = {},
) {
  const gateway = getStoryTreatmentGatewayConfig();
  const usingDefaults = !options.trigger;
  if (usingDefaults && !gateway.configured) {
    throw new Error("Story treatment gateway is not configured. Set SCENE_CAPTION_SMART_GATEWAY_URL.");
  }

  const model = options.gatewayModel ?? gateway.model ?? STORY_TREATMENT_MODEL;
  const trigger = options.trigger ?? triggerStoryTreatment;
  const attempt = request.validationAttempt ?? 0;
  const handle = await trigger({
    instructions: STORY_DIRECTOR_INSTRUCTIONS,
    input: buildStoryInput(request, attempt),
    model,
    maxTokens: 1_536,
  });
  return { runId: handle.id, model };
}

export function materializeStoryTreatmentResult(
  result: StoryTreatmentTriggerResult,
  options: { now?: () => Date; model?: string } = {},
): StoryTreatmentGenerationResult {
  const parsed = parseGeneratedTreatments(result.output);
  const model = result.model || options.model || STORY_TREATMENT_MODEL;
  return {
    treatments: hydrateTreatmentCoverage(parsed, []),
    meta: {
      model,
      generatedAt: (options.now?.() ?? new Date()).toISOString(),
      inputTokens: result.usage?.prompt_tokens,
      outputTokens: result.usage?.completion_tokens,
    },
  };
}

export async function generateStoryTreatments(
  request: StoryTreatmentRequest,
  options: GenerateStoryTreatmentsOptions = {},
): Promise<StoryTreatmentGenerationResult> {
  const waitForRun = options.waitForRun ?? waitForTriggerRunResult;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const queued = await queueStoryTreatmentGeneration(
        { ...request, validationAttempt: attempt },
        options,
      );
      const result = await waitForRun<StoryTreatmentTriggerResult>(queued.runId, {
        timeoutMs: 540_000,
        pollIntervalMs: 2_000,
      });
      return materializeStoryTreatmentResult(result, {
        now: options.now,
        model: queued.model,
      });
    } catch (error) {
      lastError = error;
    }
  }

  const message = lastError instanceof Error ? lastError.message : "Story treatment generation failed.";
  throw new Error(`Story treatment generation failed after validation retry: ${message}`);
}

export const STORY_DIRECTOR_INSTRUCTIONS = `You are the story director for a performance-led music video editor.
Return exactly three visually directed treatments in JSON: one faithful, one bold, and one wildcard.
The story is a light cinematic spine; dance, performance, movement, and existing footage should occupy roughly 80-90 percent of the finished video.
Treat the user's brief as canon for the faithful option. Never invent a pre-existing relationship when the brief says the leads are strangers.
Make the three causal structures and endings genuinely different, not cosmetic rewrites.
Use the supplied footage.captionClusters as the only evidence of what was actually shot. Do not introduce settings, disasters, props, or character facts that contradict that caption evidence.
If the captions describe a river, drowning, or water peril, do not rewrite the story around fire unless the captions also support fire imagery.
If an essential beat is not supported by any caption cluster, describe it as a generation-ready anchor instead of pretending footage exists.
Keep any simulation, competition, or last-one-standing reveal late unless the brief explicitly requests an early reveal.
Write in concrete, filmable images with clear geography, movement, escalation, and an ending hook. Avoid generic romance language and abstract mood-board filler.
Each treatment needs four to six chronological anchors. Each anchor's generationPrompt must be a standalone, filmable shot description without provider syntax.
Each treatment must include: id, kind, title, logline, synopsis, visualThesis, endingHook, expectedReusePercent, expectedGenerationPercent, and anchors.`;

export function buildStoryInput(request: StoryTreatmentRequest, attempt: number) {
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
    "Ground every anchor in captionClusters when possible. Mark unsupported beats as generation-only anchors.",
    attempt > 0 ? "This is a validation retry. Correct the prior shape and return only schema-valid, distinct treatments." : "",
    JSON.stringify(context, null, 2),
  ].filter(Boolean).join("\n\n");
}
