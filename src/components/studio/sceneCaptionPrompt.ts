import { REFERENCE_LANGUAGE_RULE } from "./referenceLanguage";
import { LFM_SCENE_CAPTION_PROMPT } from "@/review/lib/analysis/scene-caption-format";

import type { SceneCaptionSettings } from "./types";

export const SMART_SCENE_CAPTION_PROFILE = "detailed-cinematic" as const;

export function buildSceneCaptionPrompt(settings: SceneCaptionSettings) {
  if (settings.mode === "fast") return `${LFM_SCENE_CAPTION_PROMPT}\n${REFERENCE_LANGUAGE_RULE}`;

  return `Analyze the supplied source image. It may be an ordered first/middle/last scene strip; use input.kind and input.sampleTimes in context to distinguish it from a single frame. Return JSON only with caption, shotType, subjects, action, setting, lighting, timeOfDay, weather, and evidence.
Put these structured fields inside the top-level "evidence" object, alongside the top-level "caption" sentence: {"evidence":{"subjects":[{"name":string|null,"confidence":"supported"|"uncertain"|"unknown","role":"focal"|"background"|"unknown"}],"focalSubjectCount":number|null,"actions":string[],"transitions":string[],"interaction":string|null,"shotScale":string|null,"location":string|null,"physicalState":string[],"unknowns":string[]}}.
Use null or [] for unknown facts. Count focal people separately from background crowds. Report visible actions (walking, dancing, running), interaction (solo, pair, group), and physical state (intact, fractured, falling debris) only when observed. Identify transitions only from ordered source frames; list what changes between their timestamps. A pose does not establish searching, entering, escaping, relationship history, or intent. Keep missing temporal evidence in unknowns. Never assign permanent intro/climax/ending labels. Ignore story goals and lyrics when recording evidence; they describe desired interpretation, not visible facts.


Additional detailed-cinematic rules:
- ${REFERENCE_LANGUAGE_RULE}
- Write the caption as one specific 30-60 word sentence suitable for searching and editing a music video.
- Describe the visible subject identity, performance or action, body position, shot size and composition, setting depth, lighting, color, atmosphere, and emotional tone when visible.
- If project context lists named characters, use the exact character name whenever that corresponding recurring character is visible; do not reduce a known character to generic terms such as man, woman, person, performer, or subject.
- When a named character has an attached reference image, identify them by name only. Do not restate or infer static clothing, hair, body, age, ethnicity, facial features, or other appearance details in caption text; preserve visible clothing actions such as tearing or removal; the reference image is authoritative for visual identity and wardrobe.
- Do not assign a listed name to an unrelated or visually ambiguous person.
- If project context lists a named location, use that exact location name whenever the scene remains in the referenced environment; do not rename the same place from shot to shot.
- A close-up or detail shot that hides most of the environment does not prove a location. Use null and record uncertainty unless recognizable details support the reference.
- Describe visible video truth first. Do not use song lyrics or story context to infer action, location, identity, or intent.
- Use concrete nouns and active verbs; avoid vague filler such as cinematic, dramatic, or atmospheric unless the visible details explain why.`;
}

export function serializeSceneCaptionContext(
  settings: SceneCaptionSettings,
  sceneContext: Record<string, unknown> = {},
) {
  return serializeFactualSceneCaptionContext({
    ...sceneContext,
    projectContext: settings.context ?? {},
  });
}

/** Keep authored story interpretation out of the visual-observation request. */
export function serializeFactualSceneCaptionContext(value: unknown) {
  let parsed = value;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value); } catch { parsed = {}; }
  }
  const source = contextRecord(parsed);
  const project = contextRecord(source.projectContext ?? source);
  const factual: Record<string, unknown> = {};
  for (const key of ["sourceId", "sourceName", "sourceDuration", "sceneId", "sceneLabel", "sceneStart", "sceneEnd", "sceneDuration"]) {
    const field = source[key];
    if (typeof field === "string" || (typeof field === "number" && Number.isFinite(field))) factual[key] = field;
  }
  const input = contextRecord(source.input);
  if (Object.keys(input).length) {
    factual.input = {
      kind: input.kind === "ordered-frames" || input.kind === "single-frame" ? input.kind : "unknown",
      sampleTimes: Array.isArray(input.sampleTimes) ? input.sampleTimes.filter((time) => typeof time === "number" && Number.isFinite(time)) : [],
      urls: Array.isArray(input.urls) ? input.urls.filter((url) => typeof url === "string") : [],
    };
  }
  factual.projectContext = {
    ...(project.captionStyle === "detailed-cinematic" ? { captionStyle: project.captionStyle } : {}),
    characters: (Array.isArray(project.characters) ? project.characters : []).flatMap((item) => {
      const character = contextRecord(item);
      return typeof character.name === "string" && (character.role === "primary" || character.role === "secondary")
        ? [{ name: character.name, role: character.role }] : [];
    }),
    locations: (Array.isArray(project.locations) ? project.locations : []).flatMap((item) => {
      const location = contextRecord(item);
      return typeof location.name === "string" ? [{ name: location.name }] : [];
    }),
  };
  return JSON.stringify(factual);
}

function contextRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function serializeSceneCaptionReferences(settings: SceneCaptionSettings) {
  return JSON.stringify((settings.referenceImages ?? []).slice(0, 3));
}
