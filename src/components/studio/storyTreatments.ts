import { assessStoryMatch, type MatchAssessment } from "./storyMatchAssessment";
import type { StoryPlanDraft, VideoMoment } from "./musicVideoProject";

export const STORY_TREATMENT_MODEL = "Qwen/Qwen3-VL-4B-Instruct-GGUF:Q4_K_M";
export const STORY_TREATMENT_KINDS = ["faithful", "bold", "wildcard"] as const;
export const COVERAGE_STRONG_THRESHOLD = 0.45;
export const COVERAGE_WEAK_THRESHOLD = 0.2;

export type StoryTreatmentKind = (typeof STORY_TREATMENT_KINDS)[number];
export type StoryCoverageState = "covered" | "weak" | "missing";
export type CoverageResolution = "source" | "generate" | "omit" | null;

export type StoryBrief = {
  text: string;
};

export type StoryAnchorCandidate = {
  momentId: string;
  label: string;
  sourceClipId: number;
  start: number;
  end: number;
  score: number;
  reason: string;
  assessment?: MatchAssessment;
};

export type StoryLoglineElements = {
  incident: string;
  protagonist: string;
  goal: string;
  opposition: string;
  stakes: string;
};

export type StoryShotRequirement = {
  id: string;
  momentId: string;
  description: string;
  optional?: boolean;
  durationSeconds?: number;
  constraints: import("./storyMatchAssessment").ShotRequirementConstraints;
  /** Undefined inherits a legacy moment decision; explicit null is an unresolved gap. */
  resolution?: CoverageResolution;
  selectedCandidateId?: string | null;
  coverage?: StoryCoverageState;
  candidates?: StoryAnchorCandidate[];
};

export type StoryAnchor = {
  id: string;
  title: string;
  description: string;
  purpose: string;
  generationPrompt: string;
  role?: string;
  causalDependencies?: string[];
  optional?: boolean;
  requirements?: StoryShotRequirement[];
  songWindow?: { start: number; end: number };
  coverage: StoryCoverageState;
  candidates: StoryAnchorCandidate[];
  selectedCandidateId: string | null;
  resolution: CoverageResolution;
};

export type StoryTreatment = {
  id: string;
  kind: StoryTreatmentKind;
  title: string;
  logline: string;
  synopsis: string;
  visualThesis: string;
  endingHook: string;
  expectedReusePercent: number;
  expectedGenerationPercent: number;
  anchors: StoryAnchor[];
  revision?: number;
  loglineElements?: StoryLoglineElements;
  structure?: "visual-arc" | "performance" | "concept";
  reconciliation?: { status: "current" | "pending" | "legacy"; note?: string };
  /** Optional editorial overrides; missing entries use the suggested distribution. */
  sectionAnchorIds?: Record<string, string>;
};

export type StoryGenerationMeta = {
  model: string;
  generatedAt: string;
  inputTokens?: number;
  outputTokens?: number;
};

export type StoryTreatmentState = {
  brief: StoryBrief;
  treatments: StoryTreatment[];
  selectedTreatmentId: string | null;
  confirmedTreatmentId: string | null;
  confirmedTreatmentSnapshot: StoryTreatment | null;
  generationMeta: StoryGenerationMeta | null;
  storyContentSignature: string | null;
  confirmedSourceContextSignature?: string | null;
};

export type StoryTreatmentGenerationResult = {
  treatments: StoryTreatment[];
  meta: StoryGenerationMeta;
  loglineReview?: { version: 1; status: "passed" };
};

type GeneratedAnchor = Omit<StoryAnchor, "coverage" | "candidates" | "selectedCandidateId" | "resolution">;
type GeneratedTreatment = Omit<StoryTreatment, "anchors"> & { anchors: GeneratedAnchor[] };

export type StoryTreatmentRequest = {
  brief: string;
  song: {
    title?: string;
    duration?: number;
    sections: Array<{ label: string; start: number; end: number; energy?: number }>;
    lyricSummary?: string;
    lyricExcerpt?: string;
  };
  footage: {
    captionClusters: string[];
    sourceCount: number;
    momentCount: number;
  };
  constraints?: string[];
  /** Internal retry hint when Qwen returns schema-invalid JSON. */
  validationAttempt?: number;
  validationFeedback?: string;
  revision?: { treatment: StoryTreatment; instruction: string };
};

export const STORY_TREATMENTS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["treatments"],
  properties: {
    treatments: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "kind",
          "title",
          "logline",
          "loglineElements",
          "structure",
          "synopsis",
          "visualThesis",
          "endingHook",
          "expectedReusePercent",
          "expectedGenerationPercent",
          "anchors",
        ],
        properties: {
          id: { type: "string", minLength: 1, maxLength: 80 },
          kind: { type: "string", enum: [...STORY_TREATMENT_KINDS] },
          title: { type: "string", minLength: 2, maxLength: 100 },
          logline: { type: "string", minLength: 20, maxLength: 320 },
          loglineElements: { type: "object", additionalProperties: false, required: ["incident", "protagonist", "goal", "opposition", "stakes"], properties: Object.fromEntries(["incident", "protagonist", "goal", "opposition", "stakes"].map(key => [key, { type: "string", minLength: 1, maxLength: 240 }])) },
          structure: { type: "string", enum: ["visual-arc", "performance", "concept"] },
          synopsis: { type: "string", minLength: 60, maxLength: 900 },
          visualThesis: { type: "string", minLength: 20, maxLength: 400 },
          endingHook: { type: "string", minLength: 10, maxLength: 320 },
          expectedReusePercent: { type: "number", minimum: 0, maximum: 100 },
          expectedGenerationPercent: { type: "number", minimum: 0, maximum: 100 },
          anchors: {
            type: "array",
            minItems: 2,
            maxItems: 15,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "title", "description", "purpose", "generationPrompt", "role", "causalDependencies", "optional", "requirements"],
              properties: {
                id: { type: "string", minLength: 1, maxLength: 80 },
                title: { type: "string", minLength: 2, maxLength: 100 },
                description: { type: "string", minLength: 20, maxLength: 500 },
                purpose: { type: "string", minLength: 10, maxLength: 240 },
                generationPrompt: { type: "string", minLength: 20, maxLength: 600 },
                role: { type: "string", minLength: 1, maxLength: 100 },
                causalDependencies: { type: "array", items: { type: "string" } },
                optional: { type: "boolean" },
                requirements: { type: "array", minItems: 1, maxItems: 12, items: {
                  type: "object", required: ["id", "momentId", "description", "constraints"], properties: {
                    id: { type: "string" }, momentId: { type: "string" }, description: { type: "string", minLength: 1 }, optional: { type: "boolean" }, durationSeconds: { type: "number", minimum: 0.1 },
                    constraints: { type: "object", properties: {
                      subjects: { type: "array", items: { type: "string" } }, actions: { type: "array", items: { type: "string" } }, physicalStates: { type: "array", items: { type: "string" } }, focalSubjectCount: { type: "integer", minimum: 0 }, setting: { type: "string" }, intent: { type: "string" },
                    } },
                  },
                } },
                songWindow: { type: "object", required: ["start", "end"], properties: { start: { type: "number", minimum: 0 }, end: { type: "number", minimum: 0 } } },
              },
            },
          },
        },
      },
    },
  },
} as const;

export const STORY_CAPTION_CLUSTER_LIMIT = 28;
export const STORY_CAPTION_CLUSTER_MAX_CHARS = 220;
export const STORY_LYRIC_EXCERPT_MAX_CHARS = 1_200;

/** Fixed corrective messages prevent provider errors or credentials entering retry prompts. */
export function storyValidationFeedback(error: unknown): string | undefined {
  const message = error instanceof Error ? error.message : "";
  if (/Story logline review failed/i.test(message)) return "Rewrite the logline sentence so it expresses the inciting incident, specific protagonist, concrete goal, central opposition, and stakes, all supported by the story. Do not reveal the resolution, include spoilers, or invent facts.";
  if (/Treatment \d+ logline must be at most 320 characters/i.test(message)) return "Keep each complete logline within 320 characters while expressing its incident, protagonist, goal, opposition, and stakes. Do not cut off the sentence or invent facts.";
  if (/loglines must be meaningfully distinct/i.test(message)) return "The previous response duplicated treatment loglines. Return three substantively different options within the user's constraints; do not copy an option and change only its title.";
  if (/narrative purpose and explicit shot requirements/i.test(message)) return "The previous response omitted narrative roles or shot requirements. Every anchor must include role and a nonempty requirements array with id, momentId, description, and constraints.";
  if (/three short sentences/i.test(message)) return "The previous synopsis had the wrong sentence count. Each synopsis must have exactly three sentences: situation, complication and response, then escalation or dilemma.";
  if (/five logline elements|Logline (incident|protagonist|goal|opposition|stakes)/i.test(message)) return "Include all five nonempty loglineElements: incident, protagonist, goal, opposition, stakes. Use only facts from the chosen story.";
  if (/exactly three treatments|faithful, bold, and wildcard/i.test(message)) return "Return exactly three complete treatment objects, one each of kind faithful, bold, and wildcard.";
  if (/causal|dependency|moment IDs|requirement IDs/i.test(message)) return "Use unique stable IDs. Every requirement momentId must match its anchor and every causal dependency must reference an existing moment without cycles.";
  return undefined;
}

export function buildStoryCaptionClusters(moments: VideoMoment[]): string[] {
  return moments.map(moment => [...new Set([moment.label, moment.caption, moment.captionMeta?.caption, moment.captionMeta?.action, moment.captionMeta?.setting, ...(moment.captionMeta?.subjects ?? [])].filter((value): value is string => Boolean(value)))].join(" · ")).filter(Boolean);
}

export function sampleCaptionClustersForStory(clusters: string[]): string[] {
  const trimmed = clusters
    .map((item) => limitedString(item, STORY_CAPTION_CLUSTER_MAX_CHARS, ""))
    .filter(Boolean);
  if (trimmed.length <= STORY_CAPTION_CLUSTER_LIMIT) return trimmed;
  const step = (trimmed.length - 1) / (STORY_CAPTION_CLUSTER_LIMIT - 1);
  return Array.from({ length: STORY_CAPTION_CLUSTER_LIMIT }, (_, index) => (
    trimmed[Math.min(trimmed.length - 1, Math.round(index * step))]
  ));
}

export function parseStoryTreatmentRequest(value: unknown): StoryTreatmentRequest {
  const record = asRecord(value, "Story treatment request must be a JSON object.");
  const song = asRecord(record.song, "Song context is required.");
  const footage = asRecord(record.footage, "Footage context is required.");
  const rawSections = Array.isArray(song.sections) ? song.sections : [];
  const sections = rawSections.slice(0, 40).map((value, index) => {
    const section = asRecord(value, `Song section ${index + 1} is invalid.`);
    const start = finiteNumber(section.start, 0);
    const end = finiteNumber(section.end, start);
    if (end <= start) throw new Error(`Song section ${index + 1} must end after it starts.`);
    return {
      label: limitedString(section.label, 80, `Section ${index + 1}`),
      start,
      end,
      energy: Number.isFinite(section.energy) ? clamp(Number(section.energy), 0, 1) : undefined,
    };
  });
  const captionClusters = Array.isArray(footage.captionClusters)
    ? sampleCaptionClustersForStory(footage.captionClusters.map((item) => String(item)))
    : [];
  return {
    brief: limitedString(record.brief, 4_000, ""),
    song: {
      title: optionalString(song.title, 180),
      duration: Number.isFinite(song.duration) ? clamp(Number(song.duration), 0, 60 * 60) : undefined,
      sections,
      lyricSummary: optionalString(song.lyricSummary, 2_000),
      lyricExcerpt: optionalString(song.lyricExcerpt, STORY_LYRIC_EXCERPT_MAX_CHARS),
    },
    footage: {
      captionClusters,
      sourceCount: Math.round(clamp(finiteNumber(footage.sourceCount, 0), 0, 10_000)),
      momentCount: Math.round(clamp(finiteNumber(footage.momentCount, captionClusters.length), 0, 100_000)),
    },
    constraints: Array.isArray(record.constraints)
      ? record.constraints.map((item) => limitedString(item, 300, "")).filter(Boolean).slice(0, 20)
      : undefined,
    revision: record.revision ? parseRevisionRequest(record.revision) : undefined,
    validationFeedback: optionalString(record.validationFeedback, 500),
    validationAttempt: Number.isFinite(record.validationAttempt)
      ? Math.round(clamp(Number(record.validationAttempt), 0, 1))
      : undefined,
  };
}

export function parseGeneratedTreatments(value: unknown): GeneratedTreatment[] {
  const record = asRecord(value, "Story response must be an object.");
  if (!Array.isArray(record.treatments) || record.treatments.length !== 3) {
    throw new Error("Story response must contain exactly three treatments.");
  }
  const treatments = record.treatments.map((value, index) => parseGeneratedTreatment(value, index));
  const kinds = new Set(treatments.map((treatment) => treatment.kind));
  if (kinds.size !== STORY_TREATMENT_KINDS.length || STORY_TREATMENT_KINDS.some((kind) => !kinds.has(kind))) {
    throw new Error("Story response must include faithful, bold, and wildcard treatments.");
  }
  if (new Set(treatments.map((treatment) => normalizeForComparison(treatment.logline))).size !== 3) {
    throw new Error("Story treatment loglines must be meaningfully distinct.");
  }
  return treatments;
}

export function hydrateTreatmentCoverage(treatments: GeneratedTreatment[] | StoryTreatment[], moments: VideoMoment[]): StoryTreatment[] {
  return treatments.map((treatment) => ({
    ...treatment,
    anchors: treatment.anchors.map((anchor) => rankStoryMomentCoverage(anchor, moments)),
  }));
}

export function rerankAnchorCoverage(anchor: StoryAnchor, moments: VideoMoment[]): StoryAnchor {
  const ranked = rankStoryMomentCoverage(anchor, moments);
  if (anchor.resolution === "generate" || anchor.resolution === "omit") {
    return { ...ranked, resolution: anchor.resolution, selectedCandidateId: null };
  }
  return ranked;
}

export function isStoryPlanConfirmable(treatment: StoryTreatment | null | undefined) {
  return Boolean(treatment?.reconciliation?.status !== "pending" && treatment?.anchors.length && treatment.anchors.every((anchor) => {
    if (!anchor.title.trim() || !anchor.description.trim()) return false;
    const requirementsWithDecisions = anchor.requirements?.filter(requirement => requirement.resolution !== undefined) ?? [];
    if (requirementsWithDecisions.length) return requirementsWithDecisions.every(requirement => requirement.resolution !== "source" || Boolean(requirement.selectedCandidateId && requirement.candidates?.some(candidate => candidate.momentId === requirement.selectedCandidateId && candidate.assessment?.eligibility === "eligible")));
    if (anchor.resolution === "source") return Boolean(anchor.selectedCandidateId && anchor.candidates.some(candidate => candidate.momentId === anchor.selectedCandidateId && candidate.assessment?.eligibility !== "ineligible" && candidate.assessment?.eligibility !== "uncertain"));
    return anchor.resolution === null || anchor.resolution === "generate" || anchor.resolution === "omit";
  }));
}

export function buildStoryContentSignature(treatment: StoryTreatment, storyBeats: StoryPlanDraft[]) {
  const payload = JSON.stringify({
    treatment: {
      id: treatment.id,
      title: treatment.title,
      logline: treatment.logline,
      synopsis: treatment.synopsis,
      revision: treatment.revision,
      loglineElements: treatment.loglineElements,
      reconciliation: treatment.reconciliation,
      sectionAnchorIds: treatment.sectionAnchorIds,
      anchors: treatment.anchors.map((anchor) => ({
        id: anchor.id,
        title: anchor.title,
        description: anchor.description,
        requirements: anchor.requirements,
        songWindow: anchor.songWindow,
        role: anchor.role,
        causalDependencies: anchor.causalDependencies,
        optional: anchor.optional,
        resolution: anchor.resolution,
        selectedCandidateId: anchor.selectedCandidateId,
      })),
    },
    timing: storyBeats.map((beat) => [beat.id, beat.label, beat.start, beat.end]),
  });
  let hash = 0x811c9dc5;
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `story-v2-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function anchorForStorySection(treatment: StoryTreatment, sectionId: string, index: number, sectionCount: number): StoryAnchor | undefined {
  const explicit = treatment.sectionAnchorIds?.[sectionId];
  return treatment.anchors.find((anchor) => anchor.id === explicit)
    ?? treatment.anchors[Math.min(treatment.anchors.length - 1, Math.floor(index * treatment.anchors.length / Math.max(1, sectionCount)))];
}

export { applyStoryDirectionToMusic as applyTreatmentAnchorsToStoryBeats, applyStoryCoverage as applyTreatmentCoverageToProject } from "./storyMusicPlacement";

export function selectedTreatment(
  treatments: StoryTreatment[],
  treatmentId: string | null | undefined,
) {
  return treatments.find((treatment) => treatment.id === treatmentId) ?? null;
}

export function parseGeneratedTreatment(value: unknown, index: number = 0): GeneratedTreatment {
  return parseTreatment(value, index, 320);
}

function parseTreatment(value: unknown, index: number, loglineLimit: number): GeneratedTreatment {
  const record = asRecord(value, `Treatment ${index + 1} is invalid.`);
  const kind = normalizeTreatmentKind(record.kind);
  if (!kind) {
    throw new Error(`Treatment ${index + 1} has an invalid kind.`);
  }
  if (!Array.isArray(record.anchors) || record.anchors.length < 2) {
    throw new Error(`Treatment ${index + 1} must contain at least two story moments.`);
  }
  const expectedReusePercent = normalizeCoveragePercent(record.expectedReusePercent, 80);
  const expectedGenerationPercent = 100 - expectedReusePercent;
  return {
    id: limitedString(record.id, 80, `${kind}-${index + 1}`),
    kind,
    title: requiredString(record.title, 100, `Treatment ${index + 1} title`),
    logline: completeLogline(record.logline, index, loglineLimit),
    synopsis: requiredString(record.synopsis, 900, `Treatment ${index + 1} synopsis`),
    visualThesis: requiredString(record.visualThesis, 400, `Treatment ${index + 1} visual thesis`),
    endingHook: requiredString(record.endingHook, 320, `Treatment ${index + 1} ending hook`),
    expectedReusePercent,
    expectedGenerationPercent,
    revision: Math.max(1, Math.round(finiteNumber(record.revision, 1))),
    loglineElements: parseLoglineElements(record.loglineElements),
    structure: record.structure === "performance" || record.structure === "concept" ? record.structure : "visual-arc",
    reconciliation: { status: record.loglineElements ? "current" : "legacy" },
    anchors: parseGeneratedAnchors(record.anchors, index, {
      kind,
      title: requiredString(record.title, 100, `Treatment ${index + 1} title`),
      synopsis: requiredString(record.synopsis, 900, `Treatment ${index + 1} synopsis`),
      visualThesis: requiredString(record.visualThesis, 400, `Treatment ${index + 1} visual thesis`),
      strict: record.loglineElements !== undefined,
    }),
  };
}

type AnchorParseContext = {
  strict?: boolean;
  kind: StoryTreatmentKind;
  title: string;
  synopsis: string;
  visualThesis: string;
};

function parseGeneratedAnchors(rawAnchors: unknown[], treatmentIndex: number, context: AnchorParseContext): GeneratedAnchor[] {
  const parsed: GeneratedAnchor[] = [];
  for (let anchorIndex = 0; anchorIndex < rawAnchors.length && parsed.length < 15; anchorIndex += 1) {
    try {
      const anchor = coerceAnchorRecord(rawAnchors[anchorIndex], parsed.length, context);
      if (!anchor) { if (context.strict) throw new Error("Every generated story moment must be a valid object."); continue; }
      parsed.push({
        id: limitedString(anchor.id, 80, `${context.kind}-anchor-${parsed.length + 1}`),
        title: requiredString(anchor.title, 100, `Anchor ${parsed.length + 1} title`),
        description: requiredString(anchor.description, 500, `Anchor ${parsed.length + 1} description`),
        purpose: requiredString(anchor.purpose, 240, `Anchor ${parsed.length + 1} purpose`),
        generationPrompt: requiredString(anchor.generationPrompt, 600, `Anchor ${parsed.length + 1} generation prompt`),
        role: optionalString(anchor.role, 100),
        optional: anchor.optional === true,
        causalDependencies: Array.isArray(anchor.causalDependencies) ? anchor.causalDependencies.map(String).slice(0, 15) : [],
        requirements: parseShotRequirements(anchor.requirements, limitedString(anchor.id, 80, `${context.kind}-anchor-${parsed.length + 1}`)),
        songWindow: parseSongWindow(anchor.songWindow),
      });
    } catch (error) {
      if (context.strict) throw error;
      // Ignore malformed trailing output while retaining up to fifteen valid moments.
    }
  }
  if (context.strict && parsed.length !== rawAnchors.length) throw new Error("Story response exceeded the supported fifteen moments; none may be silently discarded.");
  if (parsed.length < 2) {
    throw new Error(`Treatment ${treatmentIndex + 1} must contain at least two valid story moments.`);
  }
  if (new Set(parsed.map(anchor => anchor.id)).size !== parsed.length) throw new Error("Story moment IDs must be unique.");
  const ids = new Set(parsed.map(anchor => anchor.id));
  if (parsed.some(anchor => anchor.causalDependencies?.some(id => id === anchor.id || !ids.has(id)))) throw new Error("Story dependencies must reference another moment in this treatment.");
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) throw new Error("Story causal dependencies cannot contain a cycle.");
    if (visited.has(id)) return;
    visiting.add(id);
    parsed.find(anchor => anchor.id === id)?.causalDependencies?.forEach(visit);
    visiting.delete(id); visited.add(id);
  };
  parsed.forEach(anchor => visit(anchor.id));
  return parsed;
}

function coerceAnchorRecord(value: unknown, anchorIndex: number, context: AnchorParseContext): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const description = value.trim();
  const title = inferAnchorTitle(description, anchorIndex);
  return {
    id: `${context.kind}-anchor-${anchorIndex + 1}`,
    title,
    description,
    purpose: `Advance the ${title.toLowerCase()} beat in the ${context.title} treatment.`,
    generationPrompt: `Cinematic shot: ${description} ${context.visualThesis}`.trim(),
  };
}

function inferAnchorTitle(description: string, anchorIndex: number) {
  const clause = description.split(/[,.]/)[0]?.trim() ?? "";
  if (clause.length >= 8 && clause.length <= 100) return clause;
  return `Story moment ${anchorIndex + 1}`;
}

function normalizeTreatmentKind(value: unknown): StoryTreatmentKind | null {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (STORY_TREATMENT_KINDS.includes(text as StoryTreatmentKind)) return text as StoryTreatmentKind;
  if (text.includes("faith")) return "faithful";
  if (text.includes("bold") || text.includes("antagonist")) return "bold";
  if (text.includes("wild") || text.includes("reversal")) return "wildcard";
  return null;
}

function normalizeCoveragePercent(value: unknown, fallback: number) {
  const parsed = clamp(finiteNumber(value, fallback), 0, 100);
  if (!Number.isFinite(Number(value))) return fallback;
  return parsed;
}

export function rankStoryRequirementCoverage(requirement: StoryShotRequirement, moments: VideoMoment[]): StoryShotRequirement {
  const ranked = rankAnchorCoverage({ id: requirement.id, title: requirement.description, description: requirement.description, purpose: "", generationPrompt: "", requirements: [requirement], coverage: requirement.coverage ?? "missing", candidates: requirement.candidates ?? [], selectedCandidateId: requirement.selectedCandidateId ?? null, resolution: requirement.resolution ?? null }, moments);
  const explicitGap = requirement.resolution === null;
  return { ...requirement, coverage: ranked.coverage, candidates: ranked.candidates,
    resolution: requirement.resolution !== undefined ? requirement.resolution : ranked.resolution,
    selectedCandidateId: explicitGap ? null : requirement.resolution === "source" ? requirement.selectedCandidateId ?? null : ranked.selectedCandidateId,
  };
}

function rankStoryMomentCoverage(anchor: GeneratedAnchor | StoryAnchor, moments: VideoMoment[]): StoryAnchor {
  const ranked = rankAnchorCoverage(anchor, moments);
  const requirements = anchor.requirements?.map(requirement => rankStoryRequirementCoverage(requirement, moments));
  if (!requirements?.length) return ranked;
  const required = requirements.filter(requirement => !requirement.optional);
  const coverage: StoryCoverageState = required.every(requirement => requirement.coverage === "covered") ? "covered" : required.some(requirement => requirement.coverage === "weak" || requirement.coverage === "covered") ? "weak" : "missing";
  return { ...ranked, requirements, coverage };
}

function rankAnchorCoverage(anchor: GeneratedAnchor | StoryAnchor, moments: VideoMoment[]): StoryAnchor {
  const query = `${anchor.title} ${anchor.description}`;
  const candidates = moments.map(moment => {
    const requirements = anchor.requirements?.filter(requirement => !requirement.optional) ?? [];
    const assessments = (requirements.length ? requirements : [{ id: anchor.id, description: query, constraints: undefined }]).map(requirement => assessStoryMatch({
      requirementId: requirement.id, requirementText: requirement.description, constraints: requirement.constraints,
      moment: { ...moment, caption: moment.captionMeta?.caption || moment.caption, subjects: moment.captionMeta?.subjects, action: moment.captionMeta?.action, setting: moment.captionMeta?.setting, shotType: moment.captionMeta?.shotType },
    }));
    const worst = assessments.find(item => item.eligibility === "ineligible") ?? assessments.find(item => item.eligibility === "uncertain") ?? assessments[0];
    const assessment = { ...worst, satisfied: assessments.flatMap(item => item.satisfied), unknown: assessments.flatMap(item => item.unknown), contradicted: assessments.flatMap(item => item.contradicted), reasons: assessments.flatMap(item => item.reasons) };
    return { moment, assessment, score: assessment.eligibility === "ineligible" ? 0 : scoreTextSimilarity(query, momentText(moment)) };
  }).filter(item => item.assessment.eligibility !== "ineligible")
    .sort((left, right) => Number(right.assessment.eligibility === "eligible") - Number(left.assessment.eligibility === "eligible") || right.score - left.score)
    .slice(0, 3)
    .map(({ moment, score, assessment }) => ({ momentId: moment.id, label: moment.label, sourceClipId: moment.sourceClipId, start: moment.start, end: moment.end, score, assessment, reason: assessment.reasons.join(" ") || "Visible requirements are supported." }));
  const supported = candidates.find(candidate => candidate.assessment.eligibility === "eligible");
  const coverage: StoryCoverageState = supported ? "covered" : candidates.some(candidate => candidate.score >= COVERAGE_WEAK_THRESHOLD) ? "weak" : "missing";
  const previous = "coverage" in anchor ? anchor : null;
  const previousSupported = candidates.find(candidate => candidate.momentId === previous?.selectedCandidateId && candidate.assessment.eligibility === "eligible");
  const selectedCandidateId = previousSupported?.momentId ?? supported?.momentId ?? null;
  const resolution = previous?.resolution === "generate" || previous?.resolution === "omit" ? previous.resolution : selectedCandidateId ? "source" : null;
  return { ...anchor, coverage, candidates, selectedCandidateId: resolution === "source" ? selectedCandidateId : null, resolution };
}

function scoreTextSimilarity(left: string, right: string) {
  const leftTokens = tokenSet(left);
  const rightTokens = tokenSet(right);
  if (!leftTokens.size || !rightTokens.size) return 0;
  let overlap = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) overlap += 1;
  const raw = overlap / Math.sqrt(leftTokens.size * rightTokens.size);
  const actionBonus = ["dance", "search", "tunnel", "room", "collapse", "floor", "crowd", "back", "arena"]
    .filter((token) => leftTokens.has(token) && rightTokens.has(token)).length * 0.06;
  const distinctiveOverlap = [...leftTokens]
    .filter((token) => !GENERIC_STORY_TOKENS.has(token) && rightTokens.has(token)).length;
  const distinctiveBonus = distinctiveOverlap * 0.08;
  const missesRequiredNarrativeCue = NARRATIVE_CUE_GROUPS.some((group) => {
    const requested = group.some((token) => leftTokens.has(token));
    return requested && !group.some((token) => rightTokens.has(token));
  });
  const score = missesRequiredNarrativeCue || distinctiveOverlap === 0
    ? Math.min(COVERAGE_WEAK_THRESHOLD - 0.01, raw + actionBonus)
    : raw + actionBonus + distinctiveBonus;
  return Math.round(clamp(score, 0, 1) * 100) / 100;
}

function momentText(moment: VideoMoment) {
  return [
    moment.label,
    moment.caption,
    moment.captionMeta?.caption,
    moment.captionMeta?.action,
    moment.captionMeta?.setting,
    moment.captionMeta?.shotType,
  ].filter(Boolean).join(" ");
}

function tokenSet(value: string) {
  return new Set(value.toLowerCase().match(/[a-z0-9]+/g)?.filter((token) => token.length > 2 && !STOP_WORDS.has(token)) ?? []);
}

const STOP_WORDS = new Set(["the", "and", "that", "this", "with", "from", "into", "while", "their", "they", "through", "only", "then", "when", "where"]);
const GENERIC_STORY_TOKENS = new Set(["dance", "dancer", "dancers", "room", "rooms", "underground", "movement", "move", "moving", "stranger", "strangers", "central", "visual", "story"]);
const NARRATIVE_CUE_GROUPS = [
  ["arrival", "arrive", "enter", "entrance", "descend", "descent", "surface", "tunnel", "tunnels", "cave", "woods", "forest", "below"],
  ["pass", "passed", "cross", "crosses", "crossed"],
  ["search", "searches", "searching", "find", "corridor", "corridors"],
  ["reunite", "reunion", "collide", "recognize", "recognized"],
  ["collapse", "collapses", "collapsing", "crack", "cracked", "fracture", "fractures", "floor", "fall", "falling", "void", "ledge"],
] as const;

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, maxLength: number, label: string) {
  const text = limitedString(value, maxLength, "");
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

function completeLogline(value: unknown, index: number, maxLength: number) {
  const text = typeof value === "string" ? value.trim() : "";
  const label = `Treatment ${index + 1} logline`;
  if (!text) throw new Error(`${label} is required.`);
  if (text.length > maxLength) throw new Error(`${label} must be at most ${maxLength} characters.`);
  return text;
}

function optionalString(value: unknown, maxLength: number) {
  const text = limitedString(value, maxLength, "");
  return text || undefined;
}

function limitedString(value: unknown, maxLength: number, fallback: string) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) || fallback : fallback;
}

function finiteNumber(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizeForComparison(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function parseLoglineElements(value: unknown): StoryLoglineElements | undefined {
  if (value === undefined) return undefined;
  const record = asRecord(value, "Logline elements must be an object.");
  return Object.fromEntries(["incident", "protagonist", "goal", "opposition", "stakes"].map(key => [key, requiredString(record[key], 240, `Logline ${key}`)])) as StoryLoglineElements;
}

function parseSongWindow(value: unknown): StoryAnchor["songWindow"] {
  if (!value) return undefined;
  const record = asRecord(value, "Story timing must be an object.");
  const start = finiteNumber(record.start, -1);
  const end = finiteNumber(record.end, -1);
  if (start < 0 || end <= start) throw new Error("Story timing must end after it starts.");
  return { start, end };
}

function parseShotRequirements(value: unknown, momentId: string): StoryShotRequirement[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.slice(0, 12).map((item, index) => {
    const requirement = asRecord(item, "Shot requirement must be an object.");
    const constraints = asRecord(requirement.constraints ?? {}, "Shot constraints must be an object.");
    const list = (key: string) => Array.isArray(constraints[key]) ? (constraints[key] as unknown[]).map(value => limitedString(value, 180, "")).filter(Boolean).slice(0, 12) : undefined;
    return {
      id: limitedString(requirement.id, 120, `${momentId}-shot-${index + 1}`), momentId,
      description: requiredString(requirement.description, 500, "Shot visual"),
      optional: requirement.optional === true,
      durationSeconds: Number.isFinite(requirement.durationSeconds) ? clamp(Number(requirement.durationSeconds), 0.1, 3600) : undefined,
      constraints: {
        subjects: list("subjects"), actions: list("actions"), physicalStates: list("physicalStates"),
        focalSubjectCount: Number.isFinite(constraints.focalSubjectCount) ? Math.round(clamp(Number(constraints.focalSubjectCount), 0, 100)) : undefined,
        setting: optionalString(constraints.setting, 240), intent: optionalString(constraints.intent, 240),
      },
    };
  });
}

function parseRevisionRequest(value: unknown): NonNullable<StoryTreatmentRequest["revision"]> {
  const record = asRecord(value, "Revision must include a treatment and instruction.");
  const draft = asRecord(record.treatment, "Revision must include a story draft.");
  const anchors = Array.isArray(draft.anchors) ? draft.anchors.map((value, index) => {
    const anchor = asRecord(value, `Story moment ${index + 1} is invalid.`);
    const description = requiredString(anchor.description, 500, `Describe story moment ${index + 1} before requesting a revision`);
    return { ...anchor, description, purpose: limitedString(anchor.purpose, 240, "Develop this proposed story moment."), generationPrompt: limitedString(anchor.generationPrompt, 600, description) };
  }) : [];
  // Existing prose may need shortening; the generated reply still uses the strict 320-character parser.
  const generated = parseTreatment({ ...draft, anchors }, 0, 2000);
  return {
    instruction: requiredString(record.instruction, 2000, "Revision instruction"),
    // Only authoring fields are sent to the model. Coverage is recomputed locally.
    treatment: hydrateTreatmentCoverage([generated], [])[0],
  };
}
