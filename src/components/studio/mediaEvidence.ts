import type { SceneCaptionSettings, UploadedVideoSource } from "./types";

/** Factual source observations, independent of any treatment or story position. */
export const MEDIA_EVIDENCE_VERSION = 1 as const;
export const SCENE_EVIDENCE_PROMPT_VERSION = "visible-evidence-v1";
export type EvidenceConfidence = "supported" | "uncertain" | "unknown";
export type MediaObservation = {
  subjects: { name: string | null; confidence: EvidenceConfidence; role: "focal" | "background" | "unknown" }[];
  focalSubjectCount: number | null;
  actions: string[];
  transitions: string[];
  interaction: string | null;
  shotScale: string | null;
  location: string | null;
  physicalState: string[];
  unknowns: string[];
};
export type MediaEvidence = MediaObservation & {
  version: typeof MEDIA_EVIDENCE_VERSION;
  sourceId: string;
  sceneId: string;
  sourceStart: number;
  sourceEnd: number;
  input: { kind: "single-frame" | "ordered-frames" | "unknown"; sampleTimes: number[]; urls: string[]; storage?: { bucket: string; objectKey: string } };
  provenance: { model: string | null; promptVersion: string; origin: "model" | "legacy" | "manual"; rawCaption: string; referenceKeys: string[] };
};

export function normalizeMediaObservation(value: unknown): MediaObservation | undefined {
  if (!isRecord(value)) return undefined;
  return {
    subjects: Array.isArray(value.subjects) ? value.subjects.filter(isRecord).map((subject) => ({
      name: string(subject.name),
      confidence: subject.confidence === "supported" || subject.confidence === "uncertain" ? subject.confidence : "unknown",
      role: subject.role === "focal" || subject.role === "background" ? subject.role : "unknown",
    })) : [],
    focalSubjectCount: typeof value.focalSubjectCount === "number" && Number.isInteger(value.focalSubjectCount) && value.focalSubjectCount >= 0 ? value.focalSubjectCount : null,
    actions: strings(value.actions), transitions: strings(value.transitions),
    interaction: string(value.interaction), shotScale: string(value.shotScale), location: string(value.location),
    physicalState: strings(value.physicalState), unknowns: strings(value.unknowns),
  };
}

export function createMediaEvidence(args: {
  observation?: unknown; sourceId: string; sceneId: string; sourceStart: number; sourceEnd: number;
  input: MediaEvidence["input"]; model?: string; rawCaption: string; referenceKeys?: string[];
}): MediaEvidence {
  const observation = normalizeMediaObservation(args.observation);
  const temporal = args.input.kind === "ordered-frames" && args.input.sampleTimes.length >= 2 && args.input.sampleTimes.every((time, index, times) => Number.isFinite(time) && time >= args.sourceStart && time <= args.sourceEnd && (index === 0 || time > times[index - 1]!));
  return {
    version: MEDIA_EVIDENCE_VERSION, sourceId: args.sourceId, sceneId: args.sceneId,
    sourceStart: args.sourceStart, sourceEnd: args.sourceEnd, input: args.input,
    subjects: observation?.subjects ?? [], focalSubjectCount: observation?.focalSubjectCount ?? null,
    actions: observation?.actions ?? [], transitions: temporal ? observation?.transitions ?? [] : [],
    interaction: observation?.interaction ?? null, shotScale: observation?.shotScale ?? null,
    location: observation?.location ?? null, physicalState: observation?.physicalState ?? [],
    unknowns: [...new Set([
      ...(observation?.unknowns ?? []),
      ...(!observation ? ["Structured visual evidence has not been reviewed; legacy caption only."] : []),
      ...(!temporal ? ["Temporal change is unverified: ordered source frames were not supplied."] : []),
    ])],
    provenance: { model: args.model ?? null, promptVersion: observation ? SCENE_EVIDENCE_PROMPT_VERSION : "legacy",
      origin: observation ? "model" : "legacy", rawCaption: args.rawCaption, referenceKeys: args.referenceKeys ?? [] },
  };
}

/** Reject untrusted persisted records; keep source provenance out of model-authored observations. */
export function normalizeMediaEvidence(value: unknown): MediaEvidence | undefined {
  if (!isRecord(value) || value.version !== MEDIA_EVIDENCE_VERSION || !isRecord(value.input) || !isRecord(value.provenance)) return undefined;
  if (typeof value.sourceId !== "string" || typeof value.sceneId !== "string" || typeof value.sourceStart !== "number" || typeof value.sourceEnd !== "number" || !Number.isFinite(value.sourceStart) || !Number.isFinite(value.sourceEnd) || value.sourceEnd <= value.sourceStart) return undefined;
  const observation = normalizeMediaObservation(value)!;
  const sampleTimes = Array.isArray(value.input.sampleTimes) ? value.input.sampleTimes.filter((t): t is number => typeof t === "number" && Number.isFinite(t) && t >= (value.sourceStart as number) && t <= (value.sourceEnd as number)) : [];
  const ordered = sampleTimes.length >= 2 && sampleTimes.every((time, index) => index === 0 || time > sampleTimes[index - 1]!);
  const kind = value.input.kind === "ordered-frames" && ordered ? "ordered-frames" : value.input.kind === "single-frame" ? "single-frame" : "unknown";
  return {
    ...observation,
    transitions: kind === "ordered-frames" ? observation.transitions : [],
    version: MEDIA_EVIDENCE_VERSION, sourceId: value.sourceId, sceneId: value.sceneId,
    sourceStart: value.sourceStart, sourceEnd: value.sourceEnd,
    input: {
      kind,
      sampleTimes,
      urls: strings(value.input.urls),
      ...(isRecord(value.input.storage) && typeof value.input.storage.bucket === "string" && typeof value.input.storage.objectKey === "string" ? { storage: { bucket: value.input.storage.bucket, objectKey: value.input.storage.objectKey } } : {}),
    },
    provenance: {
      model: string(value.provenance.model), promptVersion: string(value.provenance.promptVersion) ?? "legacy",
      origin: value.provenance.origin === "model" || value.provenance.origin === "manual" ? value.provenance.origin : "legacy",
      rawCaption: string(value.provenance.rawCaption) ?? "", referenceKeys: strings(value.provenance.referenceKeys),
    },
  };
}
export function sceneEvidenceInput(scene: { start: number; end: number; storyboardUrl?: string; firstFrameUrl?: string; middleFrameUrl?: string; lastFrameUrl?: string; sampleTimes?: { first?: number; middle?: number; last?: number } }, sampleTime: number): MediaEvidence["input"] {
  const sampleTimes = [scene.sampleTimes?.first, scene.sampleTimes?.middle, scene.sampleTimes?.last]
    .filter((time): time is number => typeof time === "number" && Number.isFinite(time) && time >= scene.start && time <= scene.end);
  const ordered = sampleTimes.length === 3 && sampleTimes[0]! < sampleTimes[1]! && sampleTimes[1]! < sampleTimes[2]!;
  return { kind: scene.storyboardUrl ? ordered ? "ordered-frames" : "unknown" : "single-frame",
    sampleTimes: scene.storyboardUrl ? sampleTimes : [sampleTime],
    urls: scene.storyboardUrl ? [scene.storyboardUrl] : [],
  };
}
function string(value: unknown) { return typeof value === "string" && value.trim() && !/^(unknown|null|none)$/i.test(value.trim()) ? value.trim() : null; }
function strings(value: unknown) { return Array.isArray(value) ? value.map(string).filter((item): item is string => item !== null) : []; }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }

/** Stable visual-input revision; story prose does not change source observations. */
export function buildCaptionRevisionKey(source: UploadedVideoSource, settings: SceneCaptionSettings): string {
  return JSON.stringify({
    source: [source.id, source.storageBucket, source.storagePath, source.name, source.size, source.duration],
    scenes: source.scenes?.map((scene) => [scene.id, scene.start, scene.end, scene.contentHash, scene.captionSource === "manual" ? scene.caption : null]),
    mode: settings.mode, characters: settings.context?.characters, locations: settings.context?.locations,
    references: settings.referenceImages, promptVersion: SCENE_EVIDENCE_PROMPT_VERSION,
  });
}

/** Allows this run's own detection updates without accepting unrelated input revisions. */
export function createCaptionRevisionGuard(
  source: UploadedVideoSource,
  settings: SceneCaptionSettings,
  getCurrentSource: () => UploadedVideoSource | undefined,
  getCurrentSettings: () => SceneCaptionSettings | null | undefined,
) {
  const accepted = new Set([buildCaptionRevisionKey(source, settings)]);
  let valid = true;
  const isCurrent = () => {
    const current = getCurrentSource();
    const currentSettings = getCurrentSettings();
    if (!current || !currentSettings || !accepted.has(buildCaptionRevisionKey(current, currentSettings))) valid = false;
    return valid;
  };
  return {
    isCurrent,
    acceptUpdate(next: UploadedVideoSource) {
      if (!isCurrent()) return false;
      accepted.add(buildCaptionRevisionKey(next, settings));
      return true;
    },
  };
}
