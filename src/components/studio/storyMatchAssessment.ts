import type { MediaEvidence } from "./mediaEvidence";

/** Visible requirements are independent of where a shot appears in the story. */
export interface ShotRequirementConstraints {
  subjects?: string[];
  focalSubjectCount?: number;
  actions?: string[];
  excludedActions?: string[];
  actionSequence?: string[];
  setting?: string;
  physicalStates?: string[];
  intent?: string;
}

export interface MatchAssessment {
  version: 1;
  requirementId: string;
  sourceId: string;
  eligibility: "eligible" | "uncertain" | "ineligible";
  /** Factual fit is advisory in music-video editing; unusable data is still rejected. */
  usableInEdit?: boolean;
  satisfied: string[];
  unknown: string[];
  contradicted: string[];
  reasons: string[];
  evidenceReferences: string[];
}

export function isUsableStoryMatch(assessment: MatchAssessment | undefined): boolean {
  return Boolean(assessment && (assessment.usableInEdit ?? assessment.eligibility === "eligible"));
}

export interface MatchEvidenceInput {
  id: string;
  mediaEvidence?: MediaEvidence;
  caption?: string;
  subjects?: string[];
  action?: string;
  setting?: string;
  shotType?: string;
  firstFrameUrl?: string;
  middleFrameUrl?: string;
  lastFrameUrl?: string;
}

const ACTIONS: Record<string, RegExp> = {
  walking: /\b(walk(?:s|ing|ed)?)\b/i,
  dancing: /\b(danc(?:e|es|ing|er|ers))\b/i,
  running: /\b(run(?:s|ning)?|sprint(?:s|ing)?)\b/i,
  entering: /\b(enter(?:s|ing|ed)?|arriv(?:e|es|ing|al))\b/i,
  leaving: /\b(leav(?:e|es|ing)|exit(?:s|ing|ed)?|escap(?:e|es|ing))\b/i,
  jumping: /\b(jump(?:s|ing|ed)?|leap(?:s|ing|ed)?)\b/i,
  embracing: /\b(embrac(?:e|es|ing)|hug(?:s|ging)?)\b/i,
  shooting: /\b(shoot(?:s|ing)?|fir(?:e|es|ing) a (?:gun|weapon))\b/i,
};
function assertedMatches(pattern: RegExp, text: string, negative = false): boolean {
  return [...text.matchAll(new RegExp(pattern.source, "gi"))].some((match) => {
    const prefix = text.slice(Math.max(0, match.index! - 40), match.index);
    const negated = /\b(?:not|never|without|no longer)(?:\s+\w+){0,2}\s*$/i.test(prefix);
    return negated === negative;
  });
}
function actionOrder(text: string): string[] {
  if (!/\bthen\b/i.test(text)) return [];
  return Object.entries(ACTIONS).flatMap(([action, pattern]) => {
    const match = pattern.exec(text);
    return match && assertedMatches(pattern, text) ? [{ action, index: match.index }] : [];
  }).sort((a, b) => a.index - b.index).map(({ action }) => action);
}
const STATES: Record<string, RegExp> = {
  damaged: /\b(collaps(?:e|es|ing)|crumbl(?:e|es|ing)|earthquake|rubble|fractur(?:e|es|ed|ing)|crack(?:s|ed|ing)?|falling apart|destroyed)\b/i,
  intact: /\b(intact|undamaged|before (?:the )?(?:collapse|earthquake|disaster))\b/i,
};
const SETTING_WORDS = /\b(jungle|forest|cave|club|street|beach|ocean|kitchen|desert|stage)\b/gi;
const NON_CHARACTER_SUBJECTS = new Set([
  "the", "a", "an", "they", "he", "she", "other", "camera", "one", "two", "three", "both", "each", "some", "several", "many",
  "man", "woman", "boy", "girl", "person", "people", "dancer", "dancers", "performer", "performers", "singer", "singers", "pair", "couple", "crowd",
  "crowded", "wide", "medium", "close", "tight", "extreme", "establishing", "interior", "exterior", "overhead", "aerial", "low", "high", "static", "slow", "dynamic", "cinematic", "solo",
]);
const words = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
const hasName = (text: string, name: string) => {
  const source = ` ${words(text).join(" ")} `;
  return source.includes(` ${words(name).join(" ")} `);
};

export function deriveShotRequirementConstraints(text: string): ShotRequirementConstraints {
  const actions = Object.entries(ACTIONS).filter(([, pattern]) => assertedMatches(pattern, text)).map(([action]) => action);
  const excludedActions = Object.entries(ACTIONS).filter(([, pattern]) => assertedMatches(pattern, text, true)).map(([action]) => action);
  const actionSequence = actionOrder(text);
  const physicalStates = STATES.intact!.test(text) ? ["intact"] : STATES.damaged!.test(text) ? ["damaged"] : [];
  const focalSubjectCount = /\b(alone|solo|by (?:himself|herself|themself))\b/i.test(text) ? 1
    : /\b(pair|couple|together|each other)\b/i.test(text) ? 2 : undefined;
  const intent = /\b(search(?:es|ing)? for|look(?:s|ing)? for|trying to find|reunit(?:e|es|ing)|first (?:meet|meeting))\b/i.exec(text)?.[0];
  const subjects = [...text.matchAll(/\b([A-Z][a-z]+)(?: and ([A-Z][a-z]+))?\s+(?:(?:is|are|alone|solo|quietly|slowly|quickly)\s+)*(?:walk|danc|run|enter|arriv|leav|exit|escap|jump|leap|embrac|hug|shoot|search|look|scan|stand|sit|meet|face)/g)]
    .flatMap((match) => [match[1], match[2]]).filter((name): name is string => Boolean(name) && !NON_CHARACTER_SUBJECTS.has(name!.toLowerCase()));
  const setting = /\b(jungle|forest|cave|beach|ocean|kitchen|desert)\b/i.exec(text)?.[0];
  return {
    ...(subjects.length ? { subjects: [...new Set(subjects)] } : {}),
    ...(setting ? { setting } : {}),
    ...(actions.length ? { actions } : {}),
    ...(excludedActions.length ? { excludedActions } : {}),
    ...(actionSequence.length > 1 ? { actionSequence } : {}),
    ...(physicalStates.length ? { physicalStates } : {}),
    ...(focalSubjectCount ? { focalSubjectCount } : {}),
    ...(intent ? { intent } : {}),
  };
}

/**
 * Conservative legacy-caption assessment. Unknown is not a negative observation.
 * This never assigns a source a permanent intro/climax/ending label.
 */
export function assessStoryMatch(input: {
  requirementId: string;
  requirementText: string;
  constraints?: ShotRequirementConstraints;
  moment: MatchEvidenceInput;
}): MatchAssessment {
  const { moment } = input;
  const constraints = deriveShotRequirementConstraints(input.requirementText);
  const malformedConstraints: string[] = [];
  // Restored drafts may contain undefined or malformed fields. Neither may erase prose requirements.
  for (const key of ["subjects", "actions", "excludedActions", "actionSequence", "physicalStates"] as const) {
    const value = input.constraints?.[key];
    if (value == null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (Array.isArray(value) && value.every(item => typeof item === "string" && item.trim())) constraints[key] = value;
    else malformedConstraints.push(`Invalid shot constraint requires review: ${key}`);
  }
  for (const key of ["setting", "intent"] as const) {
    const value = input.constraints?.[key];
    if (value == null) continue;
    if (typeof value === "string" && value.trim()) constraints[key] = value;
    else malformedConstraints.push(`Invalid shot constraint requires review: ${key}`);
  }
  const explicitCount = input.constraints?.focalSubjectCount;
  if (explicitCount != null) {
    if (Number.isInteger(explicitCount) && explicitCount >= 0) constraints.focalSubjectCount = explicitCount;
    else malformedConstraints.push("Invalid shot constraint requires review: focalSubjectCount");
  }
  const evidence = moment.mediaEvidence;
  const text = evidence
    ? [...evidence.actions, ...evidence.transitions, evidence.interaction, evidence.location, ...evidence.physicalState, ...evidence.subjects.filter((subject) => subject.confidence === "supported").map((subject) => subject.name)].filter(Boolean).join(" ")
    : [moment.caption, moment.action, moment.shotType, moment.setting, ...(moment.subjects ?? [])].filter(Boolean).join(" ");
  const satisfied: string[] = [];
  const unknown: string[] = [...malformedConstraints];
  const contradicted: string[] = [];
  const requiresSubjectOrAction = Boolean(constraints.subjects?.length || constraints.actions?.length || constraints.excludedActions?.length || constraints.actionSequence?.length || constraints.focalSubjectCount !== undefined);
  if (requiresSubjectOrAction && (!evidence || evidence.provenance.origin === "legacy")) {
    unknown.push("Legacy caption only: subject and action evidence requires review.");
  }
  if (evidence) {
    // Scene-wide observations cannot resolve uncertainties or bind separate actors/actions to one source instant.
    unknown.push(...evidence.unknowns.map((reason) => `Source evidence requires review: ${reason}`));
    const focalSubjects = evidence.subjects.filter((subject) => subject.role === "focal");
    if (constraints.subjects?.length && constraints.actions?.length
      && ((evidence.actions.length > 1 && (focalSubjects.length > 1 || evidence.transitions.length > 0))
        || focalSubjects.length > constraints.subjects.length)) {
      unknown.push("Actor/action association requires review: scene-wide observations do not establish who performs this action throughout the selected interval.");
    }
  }
  for (const name of constraints.subjects ?? []) {
    const knownSubjects = evidence?.subjects.filter((subject) => subject.role === "focal" && subject.confidence === "supported").map((subject) => subject.name).filter((subject): subject is string => Boolean(subject));
    const observed = knownSubjects ? knownSubjects.some((subject) => hasName(subject, name)) : hasName(text, name);
    const explicitlyOtherSolo = !observed && constraints.focalSubjectCount === 1 && evidence?.focalSubjectCount === 1 && knownSubjects?.length === 1;
    (observed ? satisfied : explicitlyOtherSolo ? contradicted : unknown).push(`Subject: ${name}${explicitlyOtherSolo ? `, observes ${knownSubjects[0]}` : ""}`);
  }
  const visibleCount = evidence ? evidence.focalSubjectCount ?? undefined : /\b(alone|solo|by (?:himself|herself|themself))\b/i.test(text) ? 1
    : /\b(pair|couple|together|each other)\b/i.test(text) ? 2 : undefined;
  if (constraints.focalSubjectCount !== undefined) {
    const reason = `Focal subjects: requires ${constraints.focalSubjectCount}${visibleCount ? `, observes ${visibleCount}` : ", not established"}`;
    (visibleCount === undefined ? unknown : visibleCount === constraints.focalSubjectCount ? satisfied : contradicted).push(reason);
  }
  const observedActions = Object.entries(ACTIONS).filter(([, pattern]) => assertedMatches(pattern, text)).map(([action]) => action);
  const exclusiveLocomotion = new Set(["walking", "dancing", "running", "jumping"]);
  for (const action of constraints.actions ?? []) {
    if ((action === "entering" || action === "leaving") && evidence && evidence.input.kind !== "ordered-frames") {
      unknown.push(`Temporal action requires ordered observations: ${action}`);
      continue;
    }
    if (observedActions.includes(action) || (ACTIONS[action] ? assertedMatches(ACTIONS[action]!, text) : hasName(text, action))) satisfied.push(`Action: ${action}`);
    else if (ACTIONS[action] && assertedMatches(ACTIONS[action]!, text, true)) contradicted.push(`Action explicitly absent: ${action}`);
    else if (exclusiveLocomotion.has(action) && observedActions.some((observed) => exclusiveLocomotion.has(observed))) contradicted.push(`Action: requires ${action}, observes ${observedActions.join(", ")}`);
    else if ((action === "entering" && observedActions.includes("leaving")) || (action === "leaving" && observedActions.includes("entering"))) contradicted.push(`Action: requires ${action}, observes ${observedActions.join(", ")}`);
    else unknown.push(`Action not established: ${action}`);
  }
  for (const action of constraints.excludedActions ?? []) {
    if (observedActions.includes(action)) contradicted.push(`Forbidden action is visible: ${action}`);
    else if (ACTIONS[action] && assertedMatches(ACTIONS[action]!, text, true)) satisfied.push(`Forbidden action absent: ${action}`);
    else unknown.push(`Absence not established: ${action}`);
  }
  if ((constraints.actionSequence?.length ?? 0) > 1) {
    const observedOrder = actionOrder(evidence ? evidence.transitions.join(" then ") : text);
    const requiredOrder = constraints.actionSequence!;
    const observedRequired = observedOrder.filter((action) => requiredOrder.includes(action));
    if (observedRequired.length !== requiredOrder.length) unknown.push(`Action order not established: ${requiredOrder.join(" then ")}`);
    else if (observedRequired.some((action, index) => action !== requiredOrder[index])) contradicted.push(`Action order: requires ${requiredOrder.join(" then ")}, observes ${observedRequired.join(" then ")}`);
    else satisfied.push(`Action order: ${requiredOrder.join(" then ")}`);
  }
  for (const state of constraints.physicalStates ?? []) {
    if (STATES[state]?.test(text) ?? hasName(text, state)) satisfied.push(`Physical state: ${state}`);
    else if ((state === "intact" && STATES.damaged!.test(text)) || (state === "damaged" && STATES.intact!.test(text))) contradicted.push(`Physical state contradicts ${state}`);
    else unknown.push(`Physical state not established: ${state}`);
  }
  if (constraints.setting) {
    const requiredLocations = constraints.setting.match(SETTING_WORDS) ?? words(constraints.setting);
    const observedLocations = text.match(SETTING_WORDS) ?? [];
    for (const location of requiredLocations) {
      if (hasName(text, location)) satisfied.push(`Setting: ${location}`);
      else if (observedLocations.length) contradicted.push(`Setting: requires ${location}, observes ${observedLocations.join(", ")}`);
      else unknown.push(`Setting not established: ${location}`);
    }
  }
  // A face or pose and a story-conditioned caption cannot establish motivation.
  if (constraints.intent) unknown.push(`Intent requires review: ${constraints.intent}`);
  if (!text.trim()) unknown.push("No visual evidence is available");
  if (!satisfied.length && !unknown.length && !contradicted.length) {
    const query = words(input.requirementText).filter((word) => word.length > 3 && !["intro", "verse", "chorus", "outro", "scene", "shot", "with", "they", "their", "this", "that"].includes(word));
    const stylisticSupport = (/\b(intimate|portrait)\b/i.test(input.requirementText) && /\b(tender|close|portrait|face)\b/i.test(text))
      || (/\bperformance\b/i.test(input.requirementText) && /\b(singer|singing|dancers|stage)\b/i.test(text));
    if (!query.some((word) => hasName(text, word)) && !stylisticSupport) unknown.push("No visible evidence supports this requested visual");
    else satisfied.push("Caption supports the requested visual; no explicit constraint is contradicted");
  }
  const eligibility = contradicted.length ? "ineligible" : unknown.length ? "uncertain" : "eligible";
  return {
    version: 1, requirementId: input.requirementId, sourceId: moment.id, eligibility,
    usableInEdit: Boolean(text.trim()) && malformedConstraints.length === 0,
    satisfied, unknown, contradicted,
    reasons: [...contradicted, ...unknown, ...satisfied],
    evidenceReferences: [...(evidence?.input.urls ?? []), moment.firstFrameUrl, moment.middleFrameUrl, moment.lastFrameUrl].filter((url): url is string => Boolean(url)),
  };
}
