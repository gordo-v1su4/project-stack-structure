import type { SceneCaptionData, SceneCaptionSource } from "./types";

export type ServerCaptionAvailability = {
  configured: boolean;
  provider?: string;
  model?: string;
  captionSource?: SceneCaptionSource;
};

export type ServerCaptionResult = {
  text: string;
  meta?: SceneCaptionData;
  captionSource: SceneCaptionSource;
  model?: string;
};

export function normalizeServerCaptionPayload(payload: unknown): ServerCaptionResult {
  if (!isRecord(payload)) throw new Error("Server caption response was not an object.");
  if (payload.ok === false) throw new Error(readString(payload.error) || "Server captioning failed.");

  const text = readString(payload.text) || readString(payload.caption);
  if (!text) throw new Error("Server caption response did not include caption text.");

  const meta = isRecord(payload.meta)
    ? normalizeSceneCaptionData(payload.meta)
    : isRecord(payload.sceneData)
      ? normalizeSceneCaptionData(payload.sceneData)
      : undefined;

  return {
    text,
    meta,
    captionSource: readCaptionSource(payload.captionSource) ?? "qwen3-vl-server",
    model: readString(payload.model),
  };
}

export function normalizeServerCaptionAvailability(payload: unknown): ServerCaptionAvailability {
  if (!isRecord(payload)) return { configured: false };
  return {
    configured: payload.configured === true,
    provider: readString(payload.provider),
    model: readString(payload.model),
    captionSource: readCaptionSource(payload.captionSource),
  };
}

function readCaptionSource(value: unknown): SceneCaptionSource | undefined {
  return value === "lfm-webgpu" ||
    value === "lfm-server" ||
    value === "qwen3-vl-server" ||
    value === "manual" ||
    value === "imported"
    ? value
    : undefined;
}

function normalizeSceneCaptionData(record: Record<string, unknown>): SceneCaptionData {
  return {
    caption: readString(record.caption),
    shotType: readString(record.shotType ?? record.shot_type),
    subjects: Array.isArray(record.subjects)
      ? record.subjects.map(readString).filter((value): value is string => Boolean(value))
      : undefined,
    action: readString(record.action),
    setting: readString(record.setting),
    lighting: readString(record.lighting),
    timeOfDay: readString(record.timeOfDay ?? record.time_of_day),
    weather: readString(record.weather),
  };
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
