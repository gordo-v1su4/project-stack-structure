import {
  STORY_TREATMENT_MODEL,
  storyValidationFeedback,
  hydrateTreatmentCoverage,
  parseGeneratedTreatments,
  type StoryTreatmentGenerationResult,
  type StoryTreatmentRequest,
  type StoryTreatment,
} from "@/components/studio/storyTreatments";
import { getStoryTreatmentGatewayConfig } from "@/lib/storyTreatmentGateway";
import { assertStoryLoglineReview, isStoryReviewDeploymentError } from "@/lib/storyLoglineReview";
import {
  triggerStoryTreatment,
  waitForTriggerRunResult,
  type StoryTreatmentTriggerResult,
  type StoryTreatmentDispatchIntent,
} from "@/lib/triggerOrchestration";

type GenerateStoryTreatmentsOptions = {
  requestIntentId?: string;
  now?: () => Date;
  trigger?: (payload: {
    operation?: "generate" | "revise";
    instructions: string;
    input: string;
    model: string;
    maxTokens?: number;
    reviewContext: { brief: string; constraints: string[] };
  }, intent: StoryTreatmentDispatchIntent) => Promise<{ id: string }>;
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
    reviewContext: {
      brief: request.brief ?? "",
      constraints: [...(request.constraints ?? []), ...(request.revision ? [request.revision.instruction] : [])],
    },
  }, { requestIntentId: options.requestIntentId ?? crypto.randomUUID(), validationAttempt: attempt });
  return { runId: handle.id, model };
}

export function materializeStoryTreatmentResult(
  result: StoryTreatmentTriggerResult,
  options: { now?: () => Date; model?: string } = {},
): StoryTreatmentGenerationResult {
  assertStoryLoglineReview(result.loglineReview);
  const parsed = parseGeneratedTreatments(result.output);
  const model = result.model || options.model || STORY_TREATMENT_MODEL;
  return {
    loglineReview: result.loglineReview,
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
  let validationFeedback: string | undefined;
  const requestIntentId = options.requestIntentId ?? crypto.randomUUID();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const queued = await queueStoryTreatmentGeneration(
        { ...request, validationAttempt: attempt, validationFeedback: validationFeedback ?? request.validationFeedback },
        { ...options, requestIntentId },
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
      if (isStoryReviewDeploymentError(error)) throw error;
      lastError = error;
      validationFeedback = storyValidationFeedback(error);
    }
  }

  const message = lastError instanceof Error ? lastError.message : "Story treatment generation failed.";
  throw new Error(`Story treatment generation failed after validation retry: ${message}`);
}

const AUTHORING_CONTRACT = `Each treatment includes id, kind, title, logline, loglineElements, synopsis, visualThesis, endingHook, structure, expectedReusePercent, expectedGenerationPercent, and anchors.
loglineElements is an object with incident, protagonist, goal, opposition, stakes. Write a concise one-sentence logline expressing those five facts: When [incident], [protagonist] must [goal] despite [opposition], or [stakes]. Use only the story's actual stakes and conflict, never invent danger merely to satisfy the formula. Keep the ending out of the pitch.
Synopsis is exactly three short sentences: situation, complication/response, central dilemma/escalation. Count three sentences before returning; do not add a fourth ending sentence. It must agree with the ordered story moments.
Structure is visual-arc, performance, or concept. Use a compact visual arc by default: opening image/world, introduction/connection, development, turn, response/climax, closing image. Adapt or omit roles for performance/concept. Do not force a disaster, a rigid music-section pattern, or fifteen screenplay beats.
Anchors are ordered narrative moments, two to fifteen as needed, generally six. Each has id, title, description, purpose, generationPrompt, role, causalDependencies (other moment IDs), optional (boolean), requirements (array). Keep each description filmable and short. A location-only establishing shot is valid. Presentation order may include a cold open or flashback; causal dependencies describe what logically precedes an event, not array order.
Each requirement has id, momentId (the anchor ID), description, optional, constraints. Constraints may include subjects (names), focalSubjectCount (foreground leads, not background crowd), actions (visible actions), setting, physicalStates, intent (story interpretation, never assert it is visible footage evidence). Leave unspecified constraints out. Requirements describe what this story needs, including missing shots.
Optional songWindow {start,end} is an explicit desired interval in song seconds; only include it when the user's timing instruction specifies one. Music labels and story moments are separate.
All names and IDs must be stable and internally consistent. Every anchor MUST include a nonempty requirements array, even for a missing shot. Do not omit requirements to save tokens. Keep prose, moments, and requirements in agreement. Keep fields concise.`;

export const STORY_DIRECTOR_INSTRUCTIONS = `You are the story director for a music-video editor.
Return JSON {"treatments":[...]} with exactly three distinct treatments: faithful, bold, wildcard.
All three options preserve explicit user constraints, including the opening, chronology, character actions, and ending. Faithful follows the requested approach closely. Bold varies the dramatic emphasis and visual development within those constraints. Wildcard varies presentation or point of view only where the user leaves room; never change a locked premise, chronology, or outcome to manufacture diversity. Do not force architecture-as-antagonist or a late betrayal on unrelated stories.
Different treatments may share the same specified ending. Distinguish their loglines by the chosen dramatic emphasis while retaining the same required facts; show that distinction in the synopsis and filmable moments. Changing only a title, kind label, adjectives, or camera style does not create a different treatment.
Use footage.captionClusters only as evidence of available visible material. The story may require unfilmed shots; preserve those as explicit requirements instead of rewriting the story to fit a convenient clip. Do not claim footage exists for unsupported actions.
Footage describes what is visible; the chosen story determines where, when, and why it belongs. A collapse can be an opening or climax depending on this story. A dancing pair cannot supply a solo arrival.
Honor an explicit opening or establishing request. Do not infer search, arrival, relationship history, or intent from a face or pose alone.
Default to a light visual spine with room for performance and movement. Give the user genuinely different choices with clear goals and visual geography.
${AUTHORING_CONTRACT}`;

export const STORY_REVISION_INSTRUCTIONS = `Revise only the supplied selected treatment. Return JSON {"treatment":{...}}.
The revision instruction is authoritative. Reconcile the edited prose, ordered moments, requirements and causal dependencies as one coherent story. Preserve unaffected facts, stable IDs, moments and timing. Add or remove moments only when needed. Do not return or regenerate the other treatment options.
When requested visuals or required-shot descriptions have been edited, regenerate their stale constraints and generationPrompt to agree with those edits. Do not restore obsolete details. Requirements constrain visible actions; put narrative meaning in the moment's purpose, and use an intent constraint only when an unobservable condition is itself essential to the requested shot.
When the user edits only the opening, preserve the later story unless continuity requires a change. Keep unsupported requirements visible; never invent footage coverage. Never infer a source's permanent narrative phase from its action.
${AUTHORING_CONTRACT}`;

const STORY_RESPONSE_SHAPE = {
  id: "option-id", kind: "faithful", title: "Short title",
  logline: "When an incident happens, a protagonist must reach a goal despite opposition, or face the stated stakes.",
  loglineElements: { incident: "Actual incident", protagonist: "Named protagonist", goal: "Concrete goal", opposition: "Actual obstacle", stakes: "Actual consequence" },
  synopsis: "First sentence sets the situation. Second sentence develops the complication and response. Third sentence presents the escalation or dilemma.",
  visualThesis: "This option's distinctive filmable approach.", endingHook: "The ending requested by the user.", structure: "visual-arc",
  expectedReusePercent: 0, expectedGenerationPercent: 0,
  anchors: [{ id: "moment-1", title: "Opening image", description: "A specific visible action or location.", purpose: "Establish the world.", role: "opening image", generationPrompt: "The same filmable visual.", causalDependencies: [], optional: false,
    requirements: [{ id: "shot-1", momentId: "moment-1", description: "The precise shot this moment needs.", optional: false, constraints: { setting: "The requested location" } }],
  }],
};

export function buildStoryInput(request: StoryTreatmentRequest, attempt: number) {
  const context = {
    userBrief: request.brief || "No user brief supplied. Propose a visual story from song and available footage, keeping unfilmed requirements explicit.",
    song: request.song,
    // Revision reconciles authored meaning. Repeating the full caption library
    // encouraged the model to copy convenient source details into corrected shots.
    footage: request.revision
      ? { sourceCount: request.footage.sourceCount, momentCount: request.footage.momentCount,
        note: "Footage coverage is assessed separately after this revision. Preserve unfilmed requirements from the brief and edited story." }
      : request.footage,
    constraints: request.constraints ?? [],
    ...(request.revision ? { selectedTreatment: storyAuthoringContext(request.revision.treatment), revisionInstruction: request.revision.instruction } : {}),
  };
  return [
    request.revision ? "Propose a coherent revision of this one story for review." : "Develop three distinct treatments from this project context.",
    "Required object shape follows. Replace every placeholder with the user's story. Expand anchors to the complete ordered story (normally six moments); every anchor needs its own requirements array and matching momentId. A requirement specifies a needed shot, not a claim that footage exists. Keep all fields; shorten their text instead of dropping fields.",
    JSON.stringify(STORY_RESPONSE_SHAPE),
    request.revision ? 'Return this shape inside {"treatment":...} for the one selected option.' : 'Return three complete objects of this shape inside {"treatments":[...]}, with kind faithful, bold, wildcard. Before returning, check: three different developed options, three-sentence synopsis each, requirements present on EVERY anchor. Do not copy an option and merely change its title.',
    "Legacy expectedReusePercent/expectedGenerationPercent fields are compatibility fields only; use 0 for both. Coverage is measured separately from footage evidence.",
    attempt > 0 ? "Validation retry: return only complete JSON matching all required authoring fields. Make each logline and developed treatment distinct in emphasis or progression within the user constraints. Do not return duplicate options or change the required ending merely to make options different." : "",
    attempt > 0 && request.validationFeedback ? `Correct this validation failure: ${request.validationFeedback.slice(0, 500)}` : "",
    JSON.stringify(context),
  ].filter(Boolean).join("\n\n");
}

/** Matching output is recalculated locally; it is not input evidence for authoring. */
function storyAuthoringContext(treatment: StoryTreatment) {
  return {
    id: treatment.id, kind: treatment.kind, title: treatment.title,
    logline: treatment.logline, loglineElements: treatment.loglineElements,
    synopsis: treatment.synopsis, visualThesis: treatment.visualThesis,
    endingHook: treatment.endingHook, structure: treatment.structure,
    sectionAnchorIds: treatment.sectionAnchorIds,
    anchors: treatment.anchors.map(anchor => ({
      id: anchor.id, title: anchor.title, description: anchor.description,
      purpose: anchor.purpose, generationPrompt: anchor.generationPrompt,
      role: anchor.role, causalDependencies: anchor.causalDependencies,
      optional: anchor.optional, songWindow: anchor.songWindow,
      requirements: anchor.requirements?.map(requirement => ({
        id: requirement.id, momentId: requirement.momentId,
        description: requirement.description, optional: requirement.optional,
        durationSeconds: requirement.durationSeconds, constraints: requirement.constraints,
      })),
    })),
  };
}
