import { scoreMotionContinuity } from "./motionRanking";
import type { MotionDescriptor } from "./types";

export interface SemanticSectionInput {
  id: string;
  label: string;
  prompt?: string;
  start: number;
  end: number;
  energy?: number;
  lyricTexts?: string[];
}

export interface SemanticVideoMomentInput {
  id: string;
  sourceClipId: number;
  label: string;
  start: number;
  end: number;
  duration: number;
  caption?: string;
  subjects?: string[];
  action?: string;
  setting?: string;
  shotType?: string;
  motionDescriptor?: MotionDescriptor | null;
}

export interface SemanticMomentScore {
  momentId: string;
  sectionId: string;
  score: number;
  semanticScore: number;
  lyricCaptionScore: number;
  actionIntentScore: number;
  durationFitScore: number;
  motionContinuityScore: number;
  motionEnergyScore: number;
  repetitionPenalty: number;
  reasons: string[];
}

export interface SemanticEditAssignment extends SemanticMomentScore {
  moment: SemanticVideoMomentInput;
}

export interface SemanticEditPlanResult {
  assignments: SemanticEditAssignment[];
  findings: Array<{ code: string; severity: "info" | "warning"; message: string; sectionId?: string }>;
}

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from", "i", "in", "into", "is", "it", "me", "my", "of", "on", "or", "our", "the", "to", "we", "with", "you", "your",
]);

const INTENT_SYNONYMS: Record<string, string[]> = {
  alone: ["lonely", "isolated", "solitary", "empty"],
  blue: ["neon", "cool", "night", "moody"],
  city: ["street", "urban", "downtown", "neon"],
  dance: ["dancer", "dancers", "dancing", "move", "moving", "movement", "club", "performance", "body"],
  drop: ["burst", "impact", "flash", "glitch", "fast", "chaos"],
  energy: ["fast", "motion", "movement", "dynamic", "performance"],
  fast: ["motion", "speed", "quick", "rush", "movement"],
  hold: ["embrace", "close", "touch", "couple", "tender", "intimate"],
  intimate: ["romantic", "couple", "tender", "close", "embrace"],
  hook: ["chorus", "performance", "dance", "repeat", "energy"],
  kiss: ["romantic", "couple", "intimate", "close"],
  love: ["romantic", "couple", "embrace", "tender", "intimate", "close", "heart"],
  me: ["person", "face", "close", "portrait"],
  night: ["tonight", "dark", "evening", "neon", "club", "street"],
  portrait: ["face", "close", "closeup", "close-up", "person", "intimate"],
  rain: ["wet", "storm", "rainy", "streets", "night", "water"],
  tonight: ["night", "evening", "dark", "neon", "club", "street"],
};

export function buildSemanticEditPlan(params: {
  sections: SemanticSectionInput[];
  videoMoments: SemanticVideoMomentInput[];
}): SemanticEditPlanResult {
  const findings: SemanticEditPlanResult["findings"] = [];
  const assignments: SemanticEditAssignment[] = [];
  const useCounts = new Map<string, number>();
  let previous: SemanticVideoMomentInput | null = null;

  if (!params.videoMoments.length) {
    return {
      assignments,
      findings: [{ code: "semantic-edit-no-video-moments", severity: "warning", message: "No captioned or segmented source moments are available for semantic editing." }],
    };
  }

  const reservations = reserveSectionMoments({ sections: params.sections, moments: params.videoMoments });

  for (const section of params.sections) {
    const ranked = promoteReservedMoment(
      rankMomentsForSection({ section, moments: params.videoMoments, previous, useCounts }),
      reservations.get(section.id),
    );
    const best = ranked[0];
    if (!best) {
      findings.push({ code: "semantic-edit-no-match", severity: "warning", message: `No source moment matched ${section.label}.`, sectionId: section.id });
      continue;
    }

    assignments.push(best);
    useCounts.set(best.moment.id, (useCounts.get(best.moment.id) ?? 0) + 1);
    previous = best.moment;

    if (best.semanticScore < 0.2 && best.lyricCaptionScore < 0.2) {
      findings.push({ code: "semantic-edit-weak-match", severity: "info", message: `${section.label} used a weak semantic match; caption coverage may be thin.`, sectionId: section.id });
    }
  }

  return { assignments, findings };
}

/**
 * Resolves contention over source moments across sections before the
 * continuity pass runs. Pure greedy assignment lets an early section take a
 * moment that a later section needs far more, even when the early section has
 * a near-equal alternative. This auction assigns each contested moment to the
 * section with the most to lose (largest score margin over its next available
 * candidate); losers move on to their next-best moment. When a section runs
 * out of un-reserved candidates it falls back to its overall best moment, so
 * projects with fewer moments than sections still get full coverage (reuse is
 * handled downstream by the repetition penalty).
 */
export function reserveSectionMoments(params: {
  sections: SemanticSectionInput[];
  moments: SemanticVideoMomentInput[];
}): Map<string, string> {
  const { sections, moments } = params;
  const reservations = new Map<string, string>();
  if (!sections.length || !moments.length) return reservations;

  const rankings = new Map(sections.map((section) => [section.id, rankMomentsForSection({ section, moments })]));
  const holders = new Map<string, string>();
  const cursors = new Map<string, number>(sections.map((section) => [section.id, 0]));
  const queue = sections.map((section) => section.id);
  let guard = sections.length * (moments.length + 2) * 2;

  const regretAt = (sectionId: string, index: number) => {
    const ranked = rankings.get(sectionId) ?? [];
    const currentScore = ranked[index]?.score ?? 0;
    for (let next = index + 1; next < ranked.length; next += 1) {
      const holder = holders.get(ranked[next]!.momentId);
      if (!holder || holder === sectionId) return currentScore - ranked[next]!.score;
    }
    return currentScore;
  };

  while (queue.length && guard-- > 0) {
    const sectionId = queue.shift()!;
    const ranked = rankings.get(sectionId) ?? [];
    let index = cursors.get(sectionId) ?? 0;

    while (index < ranked.length) {
      const candidate = ranked[index]!;
      const holder = holders.get(candidate.momentId);

      if (!holder || holder === sectionId) {
        holders.set(candidate.momentId, sectionId);
        reservations.set(sectionId, candidate.momentId);
        break;
      }

      const holderRanked = rankings.get(holder) ?? [];
      const holderIndex = holderRanked.findIndex((entry) => entry.momentId === candidate.momentId);
      if (regretAt(sectionId, index) > regretAt(holder, holderIndex) + 1e-9) {
        holders.set(candidate.momentId, sectionId);
        reservations.set(sectionId, candidate.momentId);
        reservations.delete(holder);
        cursors.set(holder, holderIndex + 1);
        queue.push(holder);
        break;
      }

      index += 1;
    }

    cursors.set(sectionId, Math.min(index, ranked.length));
    if (index >= ranked.length && ranked[0]) {
      reservations.set(sectionId, ranked[0].momentId);
    }
  }

  return reservations;
}

export function promoteReservedMoment(ranked: SemanticEditAssignment[], reservedMomentId: string | undefined): SemanticEditAssignment[] {
  if (!reservedMomentId || !ranked.length || ranked[0]!.momentId === reservedMomentId) return ranked;
  const index = ranked.findIndex((entry) => entry.momentId === reservedMomentId);
  if (index <= 0) return ranked;
  return [ranked[index]!, ...ranked.slice(0, index), ...ranked.slice(index + 1)];
}

export function rankMomentsForSection(params: {
  section: SemanticSectionInput;
  moments: SemanticVideoMomentInput[];
  previous?: SemanticVideoMomentInput | null;
  useCounts?: Map<string, number>;
}): SemanticEditAssignment[] {
  return params.moments
    .map((moment) => scoreMomentForSection({
      section: params.section,
      moment,
      previous: params.previous ?? null,
      useCount: params.useCounts?.get(moment.id) ?? 0,
    }))
    .sort((left, right) => right.score - left.score || left.moment.sourceClipId - right.moment.sourceClipId || left.moment.start - right.moment.start);
}

export function scoreMomentForSection(params: {
  section: SemanticSectionInput;
  moment: SemanticVideoMomentInput;
  previous?: SemanticVideoMomentInput | null;
  useCount?: number;
}): SemanticEditAssignment {
  const sectionText = buildSectionSearchText(params.section);
  const momentText = buildMomentSearchText(params.moment);
  const semanticScore = keywordSemanticScore(sectionText, momentText);
  const lyricCaptionScore = keywordSemanticScore((params.section.lyricTexts ?? []).join(" "), momentText);
  const actionIntentScore = scoreActionIntent(sectionText, params.moment);
  const sectionDuration = Math.max(0.05, params.section.end - params.section.start);
  const durationFitScore = scoreDurationFit(sectionDuration, params.moment.duration);
  const motionContinuityScore = params.previous
    ? scoreMotionContinuity({ from: params.previous.motionDescriptor ?? null, to: params.moment.motionDescriptor ?? null })
    : 0.5;
  const motionEnergyScore = scoreMotionEnergyFit(params.section, params.moment);
  const repetitionPenalty = Math.min(0.4, (params.useCount ?? 0) * 0.18 + (params.previous?.id === params.moment.id ? 0.22 : 0));

  const score = roundScore(
    semanticScore * 0.3 +
      lyricCaptionScore * 0.14 +
      actionIntentScore * 0.26 +
      durationFitScore * 0.12 +
      motionContinuityScore * 0.1 +
      motionEnergyScore * 0.08 +
      0.04 -
      repetitionPenalty,
  );

  return {
    momentId: params.moment.id,
    sectionId: params.section.id,
    moment: params.moment,
    score,
    semanticScore,
    lyricCaptionScore,
    actionIntentScore,
    durationFitScore,
    motionContinuityScore,
    motionEnergyScore,
    repetitionPenalty,
    reasons: buildReasons({ semanticScore, lyricCaptionScore, actionIntentScore, durationFitScore, motionContinuityScore, motionEnergyScore, repetitionPenalty }),
  };
}

export function keywordSemanticScore(query: string, candidate: string): number {
  const queryTokens = meaningfulTokens(query);
  const candidateTokens = meaningfulTokens(candidate);
  if (!queryTokens.length || !candidateTokens.length) return 0;

  const candidateSet = new Set(candidateTokens);
  let exact = 0;
  let fuzzy = 0;
  for (const token of queryTokens) {
    if (candidateSet.has(token) || candidateTokens.some((candidateToken) => candidateToken.startsWith(token) || token.startsWith(candidateToken))) {
      exact += 1;
      continue;
    }
    if (candidateTokens.some((candidateToken) => tokenSimilarity(token, candidateToken) >= 0.66)) {
      fuzzy += 1;
    }
  }

  const coverage = (exact + fuzzy * 0.72) / queryTokens.length;
  const density = (exact + fuzzy * 0.5) / Math.max(4, candidateTokens.length);
  return roundScore(Math.min(1, coverage * 0.78 + density * 0.22));
}

function buildSectionSearchText(section: SemanticSectionInput) {
  return [section.label, section.prompt, ...(section.lyricTexts ?? [])].filter(Boolean).join(" ");
}

function buildMomentSearchText(moment: SemanticVideoMomentInput) {
  return [moment.label, moment.caption, moment.shotType, moment.action, moment.setting, ...(moment.subjects ?? [])].filter(Boolean).join(" ");
}

function scoreActionIntent(sectionText: string, moment: SemanticVideoMomentInput) {
  const expandedQuery = expandIntentText(sectionText);
  const actionText = [moment.action, moment.shotType, moment.setting, ...(moment.subjects ?? []), moment.caption, moment.label].filter(Boolean).join(" ");
  return roundScore(Math.min(1, Math.max(keywordSemanticScore(expandedQuery, actionText), conceptIntentScore(sectionText, actionText)) + emotionalIntentBoost(sectionText, actionText)));
}

function expandIntentText(value: string) {
  const tokens = meaningfulTokens(value);
  const expanded = new Set(tokens);
  for (const token of tokens) {
    for (const synonym of INTENT_SYNONYMS[token] ?? []) {
      expanded.add(synonym);
    }
  }
  return [...expanded].join(" ");
}

function conceptIntentScore(query: string, candidate: string) {
  const queryTokens = meaningfulTokens(query);
  const candidateTokens = meaningfulTokens(candidate);
  if (!queryTokens.length || !candidateTokens.length) return 0;

  const conceptGroups = queryTokens
    .map((token) => [token, ...(INTENT_SYNONYMS[token] ?? [])])
    .filter((group) => group.length > 1);
  if (!conceptGroups.length) return 0;

  let matches = 0;
  for (const group of conceptGroups) {
    if (group.some((token) => candidateTokens.some((candidateToken) => candidateToken === token || candidateToken.startsWith(token) || token.startsWith(candidateToken)))) {
      matches += 1;
    }
  }

  return roundScore(matches / conceptGroups.length);
}

function emotionalIntentBoost(query: string, candidate: string) {
  const normalizedQuery = normalizeText(query);
  const normalizedCandidate = normalizeText(candidate);
  const wantsIntimacy = /\b(love|hold|kiss|intimate|tender|romantic|close)\b/.test(normalizedQuery);
  const hasIntimacy = /\b(romantic|couple|embrace|tender|kiss|intimate|close|closeup|face)\b/.test(normalizedCandidate);
  return wantsIntimacy && hasIntimacy ? 0.35 : 0;
}

function meaningfulTokens(value: string) {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

function tokenSimilarity(left: string, right: string) {
  if (left === right) return 1;
  if (left.length < 3 || right.length < 3) return 0;
  const leftTris = trigrams(left);
  const rightTris = trigrams(right);
  let overlap = 0;
  for (const tri of leftTris) {
    if (rightTris.has(tri)) overlap += 1;
  }
  return overlap / Math.max(1, Math.min(leftTris.size, rightTris.size));
}

function trigrams(value: string) {
  const padded = `  ${value}  `;
  const out = new Set<string>();
  for (let index = 0; index < padded.length - 2; index += 1) {
    out.add(padded.slice(index, index + 3));
  }
  return out;
}

function scoreDurationFit(sectionDuration: number, momentDuration: number) {
  const ratio = Math.min(sectionDuration, momentDuration) / Math.max(sectionDuration, momentDuration, 0.05);
  return roundScore(Math.max(0, Math.min(1, ratio)));
}

function scoreMotionEnergyFit(section: SemanticSectionInput, moment: SemanticVideoMomentInput) {
  const targetEnergy = clamp01(section.energy ?? inferSectionEnergy(section));
  const motionEnergy = estimateMomentMotionEnergy(moment);
  return roundScore(1 - Math.abs(targetEnergy - motionEnergy));
}

function inferSectionEnergy(section: SemanticSectionInput) {
  const text = normalizeText(`${section.label} ${section.prompt ?? ""}`);
  if (/\b(drop|chorus|hook|final|rush|fast|dance|energy)\b/.test(text)) return 0.82;
  if (/\b(intro|outro|breakdown|quiet|slow|close|portrait)\b/.test(text)) return 0.34;
  if (/\b(bridge|verse|build|pre chorus)\b/.test(text)) return 0.56;
  return 0.5;
}

function estimateMomentMotionEnergy(moment: SemanticVideoMomentInput) {
  const descriptor = moment.motionDescriptor;
  if (descriptor) {
    const confidence = clamp01(descriptor.confidence.overall);
    const magnitude = descriptor.dominantMagnitude ?? descriptor.magnitudeP90 ?? descriptor.magnitudeP50 ?? 0.4;
    const camera = descriptor.cameraMotionStrength ?? (descriptor.cameraMotionType === "static" ? 0.1 : descriptor.cameraMotionType === "unknown" ? 0.45 : 0.72);
    const residual = descriptor.residualMotionStrength ?? 0.4;
    const coherence = descriptor.motionCoherence ?? 0.5;
    const raw = clamp01(magnitude * 0.34 + camera * 0.28 + residual * 0.22 + coherence * 0.16);
    return roundScore(raw * Math.max(0.35, confidence));
  }

  const text = normalizeText(buildMomentSearchText(moment));
  if (/\b(dance|dancing|dancers|running|fast|quick|motion|moving|movement|rush|spin|jump|chaos|crowd)\b/.test(text)) return 0.78;
  if (/\b(static|still|portrait|close up|close-up|face|sitting|standing|slow|empty)\b/.test(text)) return 0.28;
  return 0.5;
}

function buildReasons(scores: Omit<SemanticMomentScore, "momentId" | "sectionId" | "score" | "reasons">) {
  const reasons: string[] = [];
  if (scores.semanticScore >= 0.45) reasons.push("caption/query match");
  if (scores.lyricCaptionScore >= 0.35) reasons.push("lyric/caption match");
  if (scores.actionIntentScore >= 0.35) reasons.push("action/intent match");
  if (scores.durationFitScore >= 0.7) reasons.push("duration fit");
  if (scores.motionContinuityScore >= 0.65) reasons.push("motion continuity");
  if (scores.motionEnergyScore >= 0.7) reasons.push("music/motion energy fit");
  if (scores.repetitionPenalty > 0) reasons.push("repeat penalty applied");
  return reasons.length ? reasons : ["weighted match"];
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function roundScore(value: number) {
  return Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000;
}
