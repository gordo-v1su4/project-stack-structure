import type { UploadedVideoSource } from "./types";

export type ClipAudioSettings = { useClipAudio: boolean; overrides: Record<string, boolean> };
export function normalizeClipAudioSettings(value?: unknown): ClipAudioSettings {
  const record = value && typeof value === "object" ? value as Partial<ClipAudioSettings> : {};
  return { useClipAudio: record.useClipAudio === true, overrides: Object.fromEntries(
    Object.entries(record.overrides && typeof record.overrides === "object" ? record.overrides : {})
      .filter(([key, enabled]) => key.length > 0 && key.length < 600 && typeof enabled === "boolean"),
  ) };
}
/** Stable through upload completion and hydration; a replacement upload has its own identity. */
export function clipAudioKey(source: Pick<UploadedVideoSource, "id" | "name">) { return `${source.id}:${source.name}`; }
export function usesClipAudio(settings: ClipAudioSettings, key?: string) {
  return key && Object.hasOwn(settings.overrides, key) ? settings.overrides[key] === true : settings.useClipAudio === true;
}
