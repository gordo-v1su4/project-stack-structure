/**
 * Caption prompt + response parser for the LFM-2.5-VL scene captioner.
 * Compact port of FreeCut's scene-caption-format.ts — extracts a structured
 * SceneCaptionData object from the model's JSON-ish output and produces a
 * clean single-sentence caption.
 */

import type { SceneCaptionData } from "../store/types";

export const CANONICAL_SHOT_SIZES = [
  "extreme wide shot",
  "wide shot",
  "medium-wide shot",
  "medium shot",
  "medium close-up",
  "close-up",
  "extreme close-up",
] as const;

export const LFM_SCENE_CAPTION_PROMPT =
  "Analyze this single video frame and return a valid JSON object only.\n\n" +
  "Use this exact schema:\n" +
  "{" +
  '"caption": string, ' +
  '"shotType": string | null, ' +
  '"subjects": string[], ' +
  '"action": string | null, ' +
  '"setting": string | null, ' +
  '"lighting": string | null, ' +
  '"timeOfDay": string | null, ' +
  '"weather": string | null' +
  "}\n\n" +
  "Rules:\n" +
  '- "caption" must be one detailed natural sentence.\n' +
  "- Describe the visible subject, action, setting, lighting, time of day, and weather when clearly visible.\n" +
  `- "shotType" is optional and must be one of: ${CANONICAL_SHOT_SIZES.join(", ")}.\n` +
  "- If shot size is not unmistakable, use null.\n" +
  "- Use null for missing scalar fields and [] for missing subjects.\n" +
  "- The first character of the response must be { and the last character must be }.\n" +
  "- Use double quotes around every key and every string value.\n" +
  "- Do not mention camera motion, editing, or uncertainty.\n" +
  "- Do not wrap the JSON in markdown fences or prose.";

const EMPTY = /^(?:null|none|n\/a|unknown|unclear|not visible|not obvious)$/i;

function clean(text: string): string {
  return text.replace(/\s+/g, " ").replace(/^[`"']+|[`"']+$/g, "").trim();
}

function scalar(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const v = clean(value);
  return v.length === 0 || EMPTY.test(v) ? undefined : v;
}

function subjects(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = value.map(scalar).filter((s): s is string => Boolean(s));
  return list.length > 0 ? list : undefined;
}

function shotType(value: unknown): string | undefined {
  const s = scalar(value)?.toLowerCase().replace(/[.!?]+$/, "");
  if (!s) return undefined;
  return CANONICAL_SHOT_SIZES.find((shot) => shot === s);
}

function extractJson(raw: string): Record<string, unknown> | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced?.[1] ?? raw;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(body.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function upperFirst(t: string): string {
  return t.length ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

/** Build a single readable sentence from structured fields. */
function compose(data: SceneCaptionData): string {
  if (data.caption) {
    const c = clean(data.caption).replace(/[.!?]+$/, "");
    return c ? `${upperFirst(c)}.` : "";
  }
  const subjectText = data.subjects?.join(", ");
  let body = "";
  if (subjectText && data.action) body = `${subjectText} ${data.action}`;
  else if (subjectText) body = subjectText;
  else if (data.action) body = data.action;
  else if (data.setting) body = `scene in ${data.setting}`;
  if (data.setting && body && !body.toLowerCase().includes(data.setting.toLowerCase())) {
    body = `${body} in ${data.setting}`;
  }
  if (data.timeOfDay) body = body ? `${body} at ${data.timeOfDay}` : data.timeOfDay;
  if (!body) return "";
  if (data.shotType) body = `${data.shotType} of ${body}`;
  return `${upperFirst(clean(body).replace(/[.!?]+$/, ""))}.`;
}

export function parseSceneCaptionResponse(raw: string): {
  text: string;
  meta?: SceneCaptionData;
} {
  const obj = extractJson(raw);
  if (!obj) {
    const text = clean(raw).replace(/[.!?]+$/, "");
    return { text: text ? `${upperFirst(text)}.` : "" };
  }
  const meta: SceneCaptionData = {
    caption: scalar(obj.caption),
    shotType: shotType(obj.shotType ?? obj.shot_type),
    subjects: subjects(obj.subjects),
    action: scalar(obj.action),
    setting: scalar(obj.setting),
    lighting: scalar(obj.lighting),
    timeOfDay: scalar(obj.timeOfDay ?? obj.time_of_day),
    weather: scalar(obj.weather),
  };
  return { text: compose(meta), meta };
}
