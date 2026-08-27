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
- When a named character has an attached reference image, identify them by name only. Do not restate or infer their clothing, hair, body, age, ethnicity, facial features, or other appearance details in caption text; the reference image is authoritative for visual identity and wardrobe.
- Do not assign a listed name to an unrelated or visually ambiguous person.
- If project context lists a named location, use that exact location name whenever the scene remains in the referenced environment; do not rename the same place from shot to shot.
- A close-up or detail shot that hides most of the environment is not evidence that the location changed. Keep the named location unless visible details clearly contradict the reference.
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
  return JSON.stringify((settings.referenceImages ?? []).slice(0, 3));
}
