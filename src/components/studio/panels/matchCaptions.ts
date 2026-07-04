import type { VideoMoment } from "../musicVideoProject";

export function getDisplayCaption(moment?: VideoMoment) {
  if (!moment) return "";
  const text = moment.captionMeta?.caption ?? moment.caption ?? "";
  const parsed = parseCaptionObject(text) ?? extractCaptionField(text);
  return parsed?.caption ?? text;
}

function parseCaptionObject(text: string) {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed) as { caption?: unknown };
    return typeof parsed.caption === "string" ? { caption: parsed.caption } : null;
  } catch {
    return null;
  }
}

function extractCaptionField(text: string) {
  const match = /"caption"\s*:\s*"((?:\\.|[^"\\])*)"/i.exec(text.trim());
  if (!match) return null;
  try {
    return { caption: JSON.parse(`"${match[1]}"`) as string };
  } catch {
    return { caption: match[1].replace(/\\"/g, '"') };
  }
}
