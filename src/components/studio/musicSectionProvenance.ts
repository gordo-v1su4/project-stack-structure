import type { BeatJoinSection } from "./types";

export type MusicSectionProvenance = {
  status: "estimated" | "detected" | "unknown";
  method?: string;
  reason?: string;
};

export function normalizeMusicSectionProvenance(value: unknown): MusicSectionProvenance | undefined {
  if (!isRecord(value) || !["estimated", "detected", "unknown"].includes(String(value.status))) return undefined;
  return {
    status: value.status as MusicSectionProvenance["status"],
    ...(typeof value.method === "string" ? { method: value.method } : {}),
    ...(typeof value.reason === "string" ? { reason: value.reason } : {}),
  };
}

export function reportsMusicSectionFallback(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const provenance = isRecord(value.provenance) ? value.provenance : {};
  return value.fallback === true || value.used_fallback === true ||
    [value.method, value.algorithm, provenance.method].some((method) => typeof method === "string" && /fallback/i.test(method));
}

/** Recognizes the local service's duration-based fallback, not the song's actual form. */
export function matchesFallbackSectionBoundaries(sections: Pick<BeatJoinSection, "start" | "end">[], duration: number): boolean {
  if (!Number.isFinite(duration) || duration <= 0 || sections.length < 3) return false;
  const boundaries = [0];
  const introEnd = Math.min(duration * 0.1, 15);
  if (introEnd > 5) boundaries.push(introEnd);
  const mainStart = boundaries[boundaries.length - 1];
  const outroStart = duration - Math.min(duration * 0.15, 20);
  const mainDuration = outroStart - mainStart;
  if (mainDuration > 20) {
    const count = Math.max(2, Math.floor(mainDuration / 30));
    for (let index = 1; index < count; index++) boundaries.push(mainStart + index * mainDuration / count);
  }
  if (duration - outroStart > 5) boundaries.push(outroStart);
  boundaries.push(duration);
  return sections.length === boundaries.length - 1 && sections.every((section, index) =>
    Math.abs(section.start - boundaries[index]) < 0.05 && Math.abs(section.end - boundaries[index + 1]) < 0.05);
}

export function annotateMusicSections<T extends Pick<BeatJoinSection, "start" | "end"> & { provenance?: unknown }>(
  sections: T[], duration: number, serviceMetadata?: unknown,
): Array<Omit<T, "provenance"> & { provenance: MusicSectionProvenance }> {
  const metadata = isRecord(serviceMetadata) ? serviceMetadata : {};
  const explicit = normalizeMusicSectionProvenance(metadata.provenance);
  const fallbackReported = reportsMusicSectionFallback(metadata);
  const fallbackPattern = matchesFallbackSectionBoundaries(sections, duration);
  const inferred: MusicSectionProvenance = fallbackReported
    ? { status: "estimated", method: "service-fallback", reason: "The analysis service reported estimated section boundaries. Rename or move them to match the song." }
    : metadata.source === "allin1"
      ? { status: "detected", method: "allin1", reason: "Functional song sections predicted by All-In-One. Review and adjust the model's timing and labels as needed." }
      : fallbackPattern
      ? { status: "estimated", method: "fallback-pattern", reason: "These boundaries match the service's evenly spaced fallback pattern; the service did not confirm how they were made. Review the timing and names." }
      : { status: "estimated", method: "unverified-song-form", reason: "Section names are suggestions from audio analysis, not confirmed verse/chorus structure. Rename or move them to match the song." };
  return sections.map(({ provenance, ...section }) => ({
    ...section, provenance: fallbackReported ? inferred : normalizeMusicSectionProvenance(provenance) ?? explicit ?? inferred,
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
