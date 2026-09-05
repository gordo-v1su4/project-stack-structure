import type { MusicVideoProject, SemanticClipMatch, StoryPlanDraft, VideoMoment } from "./musicVideoProject";

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
};

export type StoryAnchor = {
  id: string;
  title: string;
  description: string;
  purpose: string;
  generationPrompt: string;
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
};

export type StoryTreatmentGenerationResult = {
  treatments: StoryTreatment[];
  meta: StoryGenerationMeta;
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
          synopsis: { type: "string", minLength: 60, maxLength: 900 },
          visualThesis: { type: "string", minLength: 20, maxLength: 400 },
          endingHook: { type: "string", minLength: 10, maxLength: 320 },
          expectedReusePercent: { type: "number", minimum: 0, maximum: 100 },
          expectedGenerationPercent: { type: "number", minimum: 0, maximum: 100 },
          anchors: {
            type: "array",
            minItems: 4,
            maxItems: 6,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "title", "description", "purpose", "generationPrompt"],
              properties: {
                id: { type: "string", minLength: 1, maxLength: 80 },
                title: { type: "string", minLength: 2, maxLength: 100 },
                description: { type: "string", minLength: 20, maxLength: 500 },
                purpose: { type: "string", minLength: 10, maxLength: 240 },
                generationPrompt: { type: "string", minLength: 20, maxLength: 600 },
              },
            },
          },
        },
      },
    },
  },
} as const;

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
    ? footage.captionClusters.map((item) => limitedString(item, 500, "")).filter(Boolean).slice(0, 80)
    : [];
  return {
    brief: limitedString(record.brief, 4_000, ""),
    song: {
      title: optionalString(song.title, 180),
      duration: Number.isFinite(song.duration) ? clamp(Number(song.duration), 0, 60 * 60) : undefined,
      sections,
      lyricSummary: optionalString(song.lyricSummary, 2_000),
      lyricExcerpt: optionalString(song.lyricExcerpt, 4_000),
    },
    footage: {
      captionClusters,
      sourceCount: Math.round(clamp(finiteNumber(footage.sourceCount, 0), 0, 10_000)),
      momentCount: Math.round(clamp(finiteNumber(footage.momentCount, captionClusters.length), 0, 100_000)),
    },
    constraints: Array.isArray(record.constraints)
      ? record.constraints.map((item) => limitedString(item, 300, "")).filter(Boolean).slice(0, 20)
      : undefined,
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
  if (new Set(treatments.map((treatment) => normalizeForComparison(treatment.endingHook))).size !== 3) {
    throw new Error("Story treatment endings must be meaningfully distinct.");
  }
  return treatments;
}

export function hydrateTreatmentCoverage(treatments: GeneratedTreatment[] | StoryTreatment[], moments: VideoMoment[]): StoryTreatment[] {
  return treatments.map((treatment) => ({
    ...treatment,
    anchors: treatment.anchors.map((anchor) => rankAnchorCoverage(anchor, moments)),
  }));
}

export function rerankAnchorCoverage(anchor: StoryAnchor, moments: VideoMoment[]): StoryAnchor {
  const ranked = rankAnchorCoverage(anchor, moments);
  if (anchor.resolution === "generate" || anchor.resolution === "omit") {
    return { ...ranked, resolution: anchor.resolution, selectedCandidateId: null };
  }
  return ranked;
}

export function isStoryPlanConfirmable(treatment: StoryTreatment | null | undefined) {
  return Boolean(treatment?.anchors.length && treatment.anchors.every((anchor) => {
    if (anchor.resolution === "source") return Boolean(anchor.selectedCandidateId);
    return anchor.resolution === "generate" || anchor.resolution === "omit";
  }));
}

export function buildStoryContentSignature(treatment: StoryTreatment, storyBeats: StoryPlanDraft[]) {
  const payload = JSON.stringify({
    treatment: {
      id: treatment.id,
      title: treatment.title,
      logline: treatment.logline,
      synopsis: treatment.synopsis,
      anchors: treatment.anchors.map((anchor) => ({
        id: anchor.id,
        title: anchor.title,
        description: anchor.description,
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

export function applyTreatmentAnchorsToStoryBeats(storyBeats: StoryPlanDraft[], treatment: StoryTreatment): StoryPlanDraft[] {
  if (!storyBeats.length || !treatment.anchors.length) return storyBeats;
  let previousAnchorIndex = -1;
  return storyBeats.map((beat, index) => {
    const anchorIndex = Math.min(
      treatment.anchors.length - 1,
      Math.floor((index * treatment.anchors.length) / storyBeats.length),
    );
    const anchor = treatment.anchors[anchorIndex];
    const isAnchorEntry = anchorIndex !== previousAnchorIndex;
    previousAnchorIndex = anchorIndex;
    const prefix = anchor.resolution === "generate" && isAnchorEntry
      ? "[GENERATE GAP] "
      : anchor.resolution === "omit"
        ? "[PERFORMANCE BRIDGE] "
        : "";
    return { ...beat, prompt: `${prefix}${anchor.title}: ${anchor.description}` };
  });
}

export function applyTreatmentCoverageToProject(project: MusicVideoProject, treatment: StoryTreatment | null | undefined): MusicVideoProject {
  if (!treatment?.anchors.length || !project.storySections.length) return project;
  const momentIds = new Set(project.videoMoments.map((moment) => moment.id));
  let previousAnchorIndex = -1;
  const decisions = new Map(project.storySections.map((section, index) => {
    const anchorIndex = Math.min(
      treatment.anchors.length - 1,
      Math.floor((index * treatment.anchors.length) / project.storySections.length),
    );
    const isAnchorEntry = anchorIndex !== previousAnchorIndex;
    previousAnchorIndex = anchorIndex;
    return [section.id, isAnchorEntry ? treatment.anchors[anchorIndex] : null] as const;
  }));
  const storySections = project.storySections.map((section) => {
    const anchor = decisions.get(section.id);
    if (!anchor) return section;
    if (anchor.resolution === "generate") {
      return { ...section, videoMomentIds: [], semanticMatch: undefined };
    }
    if (anchor.resolution === "source" && anchor.selectedCandidateId && momentIds.has(anchor.selectedCandidateId)) {
      const candidate = anchor.candidates.find((item) => item.momentId === anchor.selectedCandidateId);
      const semanticMatch = candidate ? candidateToSemanticMatch(candidate) : section.semanticMatch;
      return {
        ...section,
        videoMomentIds: [anchor.selectedCandidateId, ...section.videoMomentIds.filter((id) => id !== anchor.selectedCandidateId)],
        semanticMatch,
      };
    }
    return section;
  });
  const sectionById = new Map(storySections.map((section) => [section.id, section]));
  return {
    ...project,
    storySections,
    editPlan: {
      ...project.editPlan,
      timelineItems: project.editPlan.timelineItems.map((item) => {
        const section = sectionById.get(item.sectionId);
        if (!section) return item;
        return {
          ...item,
          prompt: section.prompt,
          videoMomentId: section.videoMomentIds[0] ?? null,
          semanticMatch: section.semanticMatch,
        };
      }),
    },
  };
}

export function selectedTreatment(
  treatments: StoryTreatment[],
  treatmentId: string | null | undefined,
) {
  return treatments.find((treatment) => treatment.id === treatmentId) ?? null;
}

function parseGeneratedTreatment(value: unknown, index: number): GeneratedTreatment {
  const record = asRecord(value, `Treatment ${index + 1} is invalid.`);
  const kind = record.kind;
  if (!STORY_TREATMENT_KINDS.includes(kind as StoryTreatmentKind)) {
    throw new Error(`Treatment ${index + 1} has an invalid kind.`);
  }
  if (!Array.isArray(record.anchors) || record.anchors.length < 4 || record.anchors.length > 6) {
    throw new Error(`Treatment ${index + 1} must contain four to six anchors.`);
  }
  const expectedReusePercent = clamp(finiteNumber(record.expectedReusePercent, 0), 0, 100);
  const expectedGenerationPercent = clamp(finiteNumber(record.expectedGenerationPercent, 0), 0, 100);
  if (Math.abs((expectedReusePercent + expectedGenerationPercent) - 100) > 1) {
    throw new Error(`Treatment ${index + 1} coverage estimates must add to 100 percent.`);
  }
  return {
    id: limitedString(record.id, 80, `${kind}-${index + 1}`),
    kind: kind as StoryTreatmentKind,
    title: requiredString(record.title, 100, `Treatment ${index + 1} title`),
    logline: requiredString(record.logline, 320, `Treatment ${index + 1} logline`),
    synopsis: requiredString(record.synopsis, 900, `Treatment ${index + 1} synopsis`),
    visualThesis: requiredString(record.visualThesis, 400, `Treatment ${index + 1} visual thesis`),
    endingHook: requiredString(record.endingHook, 320, `Treatment ${index + 1} ending hook`),
    expectedReusePercent,
    expectedGenerationPercent,
    anchors: record.anchors.map((value, anchorIndex) => {
      const anchor = asRecord(value, `Treatment ${index + 1} anchor ${anchorIndex + 1} is invalid.`);
      return {
        id: limitedString(anchor.id, 80, `${kind}-anchor-${anchorIndex + 1}`),
        title: requiredString(anchor.title, 100, `Anchor ${anchorIndex + 1} title`),
        description: requiredString(anchor.description, 500, `Anchor ${anchorIndex + 1} description`),
        purpose: requiredString(anchor.purpose, 240, `Anchor ${anchorIndex + 1} purpose`),
        generationPrompt: requiredString(anchor.generationPrompt, 600, `Anchor ${anchorIndex + 1} generation prompt`),
      };
    }),
  };
}

function rankAnchorCoverage(anchor: GeneratedAnchor | StoryAnchor, moments: VideoMoment[]): StoryAnchor {
  const query = `${anchor.title} ${anchor.description}`;
  const candidates = moments
    .map((moment) => ({ moment, score: scoreTextSimilarity(query, momentText(moment)) }))
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)
    .map(({ moment, score }) => ({
      momentId: moment.id,
      label: moment.label,
      sourceClipId: moment.sourceClipId,
      start: moment.start,
      end: moment.end,
      score,
      reason: score >= COVERAGE_STRONG_THRESHOLD
        ? "Caption and action strongly overlap this anchor."
        : score >= COVERAGE_WEAK_THRESHOLD
          ? "Related visual material, but the narrative action is incomplete."
          : "Only a loose visual connection.",
    }));
  const topScore = candidates[0]?.score ?? 0;
  const coverage: StoryCoverageState = topScore >= COVERAGE_STRONG_THRESHOLD
    ? "covered"
    : topScore >= COVERAGE_WEAK_THRESHOLD
      ? "weak"
      : "missing";
  const previous = "coverage" in anchor ? anchor : null;
  const priorCandidateStillExists = previous?.selectedCandidateId
    ? candidates.some((candidate) => candidate.momentId === previous.selectedCandidateId)
    : false;
  const selectedCandidateId = priorCandidateStillExists
    ? previous?.selectedCandidateId ?? null
    : coverage === "missing"
      ? null
      : candidates[0]?.momentId ?? null;
  return {
    ...anchor,
    coverage,
    candidates,
    selectedCandidateId,
    resolution: previous?.resolution === "generate" || previous?.resolution === "omit"
      ? previous.resolution
      : selectedCandidateId
        ? "source"
        : null,
  };
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

function candidateToSemanticMatch(candidate: StoryAnchorCandidate): SemanticClipMatch {
  return {
    momentId: candidate.momentId,
    score: candidate.score,
    semanticScore: candidate.score,
    lyricCaptionScore: candidate.score,
    actionIntentScore: candidate.score,
    durationFitScore: 0.5,
    motionContinuityScore: 0.5,
    motionEnergyScore: 0.5,
    repetitionPenalty: 0,
    reasons: [candidate.reason, "Selected during Story anchor review."],
  };
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
