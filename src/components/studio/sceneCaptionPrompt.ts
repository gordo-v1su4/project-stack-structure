import { LFM_SCENE_CAPTION_PROMPT } from "@/review/lib/analysis/scene-caption-format";

import type { SceneCaptionSettings } from "./types";

export const SMART_SCENE_CAPTION_PROFILE = "detailed-cinematic" as const;

export function buildSceneCaptionPrompt(settings: SceneCaptionSettings) {
  if (settings.mode === "fast") return LFM_SCENE_CAPTION_PROMPT;

  return `${LFM_SCENE_CAPTION_PROMPT}

Additional detailed-cinematic rules:
- Write the caption as one specific 30-60 word sentence suitable for searching and editing a music video.
- Describe the visible subject identity, performance or action, body position, shot size and composition, setting depth, lighting, color, atmosphere, and emotional tone when visible.
- If project context lists named characters, use the exact character name whenever that corresponding recurring character is visible; do not reduce a known character to generic terms such as man, woman, person, performer, or subject.
- Do not assign a listed name to an unrelated or visually ambiguous person.
- Describe visible video truth first. Song lyrics and story context may disambiguate meaning but must never replace visual evidence.
- Use concrete nouns and active verbs; avoid vague filler such as cinematic, dramatic, or atmospheric unless the visible details explain why.`;
}

export function serializeSceneCaptionContext(
  settings: SceneCaptionSettings,
  sceneContext: Record<string, unknown> = {},
) {
  return JSON.stringify({
    ...sceneContext,
    projectContext: settings.context ?? {},
  });
}

export function serializeSceneCaptionReferences(settings: SceneCaptionSettings) {
  return JSON.stringify((settings.referenceImages ?? []).slice(0, 2));
}
