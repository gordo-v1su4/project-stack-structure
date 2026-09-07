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
    operation?: "generate" | "revise";
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
    operation: request.revision ? "revise" : "generate",
    instructions: request.revision ? STORY_REVISION_INSTRUCTIONS : STORY_DIRECTOR_INSTRUCTIONS,
    input: buildStoryInput(request, attempt),
    model,
    maxTokens: request.revision ? 4_000 : 7_000,
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

const AUTHORING_CONTRACT = `Each treatment includes id, kind, title, logline, loglineElements, synopsis, visualThesis, endingHook, structure, expectedReusePercent, expectedGenerationPercent, and anchors.
loglineElements is an object with incident, protagonist, goal, opposition, stakes. Write a concise one-sentence logline expressing those five facts: When [incident], [protagonist] must [goal] despite [opposition], or [stakes]. Use only the story's actual stakes and conflict, never invent danger merely to satisfy the formula. Keep the ending out of the pitch.
Synopsis is exactly three short sentences: situation, complication/response, central dilemma/escalation. It must agree with the ordered story moments.
Structure is visual-arc, performance, or concept. Use a compact visual arc by default: opening image/world, introduction/connection, development, turn, response/climax, closing image. Adapt or omit roles for performance/concept. Do not force a disaster, a rigid music-section pattern, or fifteen screenplay beats.
Anchors are ordered narrative moments, two to fifteen as needed, generally six. Each has id, title, description, purpose, generationPrompt, role, causalDependencies (other moment IDs), optional (boolean), requirements (array). Keep each description filmable and short. A location-only establishing shot is valid. Presentation order may include a cold open or flashback; causal dependencies describe what logically precedes an event, not array order.
Each requirement has id, momentId (the anchor ID), description, optional, constraints. Constraints may include subjects (names), focalSubjectCount (foreground leads, not background crowd), actions (visible actions), setting, physicalStates, intent (story interpretation, never assert it is visible footage evidence). Leave unspecified constraints out. Requirements describe what this story needs, including missing shots.
Optional songWindow {start,end} is an explicit desired interval in song seconds; only include it when the user's timing instruction specifies one. Music labels and story moments are separate.
All names and IDs must be stable and internally consistent. Keep prose, moments, and requirements in agreement. Keep fields concise.`;

export const STORY_DIRECTOR_INSTRUCTIONS = `You are the story director for a music-video editor.
Return JSON {"treatments":[...]} with exactly three distinct treatments: faithful, bold, wildcard.
The faithful option preserves every user-story fact. Bold changes the dramatic approach; wildcard changes the premise or presentation meaningfully. Do not force architecture-as-antagonist or a late betrayal on unrelated stories.
Use footage.captionClusters only as evidence of available visible material. The story may require unfilmed shots; preserve those as explicit requirements instead of rewriting the story to fit a convenient clip. Do not claim footage exists for unsupported actions.
Footage describes what is visible; the chosen story determines where, when, and why it belongs. A collapse can be an opening or climax depending on this story. A dancing pair cannot supply a solo arrival.
Honor an explicit opening or establishing request. Do not infer search, arrival, relationship history, or intent from a face or pose alone.
Default to a light visual spine with room for performance and movement. Give the user genuinely different choices with clear goals and visual geography.
${AUTHORING_CONTRACT}`;

export const STORY_REVISION_INSTRUCTIONS = `Revise only the supplied selected treatment. Return JSON {"treatment":{...}}.
The revision instruction is authoritative. Reconcile the edited prose, ordered moments, requirements and causal dependencies as one coherent story. Preserve unaffected facts, stable IDs, moments and timing. Add or remove moments only when needed. Do not return or regenerate the other treatment options.
When the user edits only the opening, preserve the later story unless continuity requires a change. Keep unsupported requirements visible; never invent footage coverage. Never infer a source's permanent narrative phase from its action.
${AUTHORING_CONTRACT}`;

export function buildStoryInput(request: StoryTreatmentRequest, attempt: number) {
  const context = {
    userBrief: request.brief || "No user brief supplied. Propose a visual story from song and available footage, keeping unfilmed requirements explicit.",
    song: request.song,
    footage: request.footage,
    constraints: request.constraints ?? [],
    ...(request.revision ? { selectedTreatment: request.revision.treatment, revisionInstruction: request.revision.instruction } : {}),
  };
  return [
    request.revision ? "Propose a coherent revision of this one story for review." : "Develop three distinct treatments from this project context.",
    "Legacy expectedReusePercent/expectedGenerationPercent fields are compatibility fields only; use 0 for both. Coverage is measured separately from footage evidence.",
    attempt > 0 ? "Validation retry: return only complete JSON matching all required authoring fields." : "",
    JSON.stringify(context, null, 2),
  ].filter(Boolean).join("\n\n");
}
