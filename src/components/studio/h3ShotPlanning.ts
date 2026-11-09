import { effectiveGenerationScope, generationScopeSha256 } from "./generationScope";
import { h3WindowKey } from "./h3DraftPlan";
import { h3FrameCount, H3_FPS, H3_MAX_SHOT_SECONDS } from "./h3Generation";
import type { EditPlanPreviewSegment, MusicVideoProject, StoryEditSettings } from "./musicVideoProject";
import { isPlacementPlanCurrent } from "./musicVideoProject";
import type { ShotRequirementConstraints } from "./storyMatchAssessment";
import type { GeneratedFootageEvidence, SelectedFootageEvidence } from "./selectedFootageEvidence";

export const H3_SHOT_PLANNING_LIMITS = {
  windows: 512, groups: 64, windowsPerGroup: 64, subjectNames: 32,
  directionCharacters: 1600, stateCharacters: 800, inputBytes: 512 * 1024, resultBytes: 2 * 1024 * 1024,
} as const;

export type H3ShotPlanningWindow = {
  key: string; placementId: string; songStart: number; songEnd: number;
  inference: { fps: number; frames: number; durationSeconds: number };
  sourceEvidence?: { momentId: string; caption: string; sourceStart: number; sourceEnd: number };
  generatedEvidence?: GeneratedFootageEvidence;
  generatedEvidenceBindingSha256?: string;
};
export type H3ShotPlanningGroup = {
  id: string; timelineItemId: string; requirementId?: string; narrativeMomentId?: string; sectionId: string;
  approvedDirection: string; constraints: ShotRequirementConstraints; windows: H3ShotPlanningWindow[];
};
export type H3ShotPlanningInput = {
  version: 1; bindingSha256: string; projectId: string; planSignature: string;
  settings: StoryEditSettings; subjectNames: string[]; groups: H3ShotPlanningGroup[];
  coverageSha256?: string;
};
export type H3ShotDirection = {
  windowKey: string; direction: string; entryState: string; exitState: string; actionIndices: number[];
};
export type H3ShotPlanningResult = { version: 1; bindingSha256: string; directions: H3ShotDirection[] };

function text(value: unknown, limit: number, label: string): string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.length > limit
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error(`Invalid shot planning ${label}.`);
  return value;
}

function constraintsSnapshot(value: ShotRequirementConstraints | undefined): ShotRequirementConstraints {
  if (!value) return {};
  const result: ShotRequirementConstraints = {};
  const listKeys = ["subjects", "actions", "excludedActions", "actionSequence", "physicalStates"] as const;
  for (const key of Object.keys(value)) {
    if (![...listKeys, "focalSubjectCount", "setting", "intent"].includes(key)) throw new Error("Unknown approved shot constraint.");
  }
  for (const key of listKeys) if (value[key] !== undefined) {
    const list = value[key];
    if (!Array.isArray(list) || list.length > 12) throw new Error("Approved shot constraint exceeds its bound.");
    result[key] = list.map(item => text(item, 180, "constraint"));
  }
  if (value.focalSubjectCount !== undefined) {
    if (!Number.isInteger(value.focalSubjectCount) || value.focalSubjectCount < 0 || value.focalSubjectCount > 100) throw new Error("Invalid approved subject count.");
    result.focalSubjectCount = value.focalSubjectCount;
  }
  for (const key of ["setting", "intent"] as const) if (value[key] !== undefined) result[key] = text(value[key], 240, key);
  return result;
}

/** Build from confirmed placements, never from inferred prose or model-proposed timing.
 * This is a data/coverage contract. It does not prove semantic compliance,
 * physical plausibility, identity, creative quality or suitability for H3.
 */
export function buildH3ShotPlanningInput(params: {
  project: MusicVideoProject; segments: EditPlanPreviewSegment[]; subjectNames?: string[]; projectId?: string;
  generatedEvidenceByWindowKey?: ReadonlyMap<string, SelectedFootageEvidence>;
  coverageBinding?: unknown;
}): H3ShotPlanningInput {
  const { project, segments } = params;
  const planSignature = effectiveGenerationScope(project);
  if (!planSignature || !project.placementPlan || !isPlacementPlanCurrent(project)) throw new Error("Confirm the current story before planning shots.");
  if (!segments.length || segments.length > H3_SHOT_PLANNING_LIMITS.windows) throw new Error("Shot planning window count exceeds its bound.");
  const subjectNames = (params.subjectNames ?? []).map(name => text(name, 120, "subject name"));
  if (subjectNames.length > H3_SHOT_PLANNING_LIMITS.subjectNames || new Set(subjectNames).size !== subjectNames.length) throw new Error("Choose distinct bounded subject names.");
  const groups: H3ShotPlanningGroup[] = [];
  const seen = new Set<string>();
  let previousEnd = -Infinity;
  for (const segment of segments) {
    const item = project.editPlan.timelineItems.find(item => item.id === segment.timelineItemId);
    const placement = project.placementPlan.placements.find(placement => placement.id === segment.placementId);
    if (!item || !placement || segment.planSignature !== planSignature || segment.sectionId !== item.sectionId
      || segment.requirementId !== item.requirementId || segment.narrativeMomentId !== item.narrativeMomentId
      || placement.timelineItemId !== item.id || placement.sectionId !== item.sectionId
      || !Number.isFinite(segment.musicStart) || !Number.isFinite(segment.musicEnd)
      || segment.musicStart < 0 || segment.musicEnd <= segment.musicStart || segment.musicEnd > project.duration + 0.001
      || segment.musicEnd - segment.musicStart > H3_MAX_SHOT_SECONDS + 0.001
      || segment.musicStart < item.start - 0.001 || segment.musicEnd > item.end + 0.001
      || segment.musicStart < placement.songStart - 0.001 || segment.musicEnd > placement.songEnd + 0.001
      || segment.musicStart < previousEnd - 0.000001) throw new Error("Shot planning window differs from its confirmed placement.");
    const key = h3WindowKey(segment);
    if (seen.has(key)) throw new Error("Shot planning windows must occur exactly once.");
    seen.add(key);
    previousEnd = segment.musicEnd;
    let group = groups.at(-1);
    if (group?.timelineItemId !== item.id) {
      if (groups.some(group => group.timelineItemId === item.id)) throw new Error("A shot requirement cannot restart later in the planning input.");
      group = { id: item.id, timelineItemId: item.id, requirementId: item.requirementId, narrativeMomentId: item.narrativeMomentId,
        sectionId: item.sectionId, approvedDirection: text(item.prompt, 4000, "approved direction"),
        constraints: constraintsSnapshot(item.requirements), windows: [] };
      groups.push(group);
    } else if (group.windows.at(-1)!.songEnd !== segment.musicStart) {
      throw new Error("Disjoint holes need explicit source-boundary context before shot planning.");
    }
    const frames = h3FrameCount(segment.musicEnd - segment.musicStart);
    const selectedEvidence = params.generatedEvidenceByWindowKey?.get(key);
    if (Boolean(segment.generatedAssetId) !== Boolean(selectedEvidence)) throw new Error("Applied generated coverage requires its exact canonical evidence.");
    let generatedEvidence: GeneratedFootageEvidence | undefined;
    let generatedEvidenceBindingSha256: string | undefined;
    if (selectedEvidence) {
      const value = selectedEvidence.evidence;
      if (value.assetId !== segment.generatedAssetId || value.completion !== "unverified"
        || !["requested-direction", "media-only"].includes(value.evidenceKind)
        || !Number.isFinite(value.sourceStart) || !Number.isFinite(value.sourceEnd) || value.sourceStart < 0
        || value.sourceEnd <= value.sourceStart || Math.abs(value.sourceStart - segment.startTime) > 0.000001
        || Math.abs(value.sourceEnd - segment.endTime) > 0.000001
        || Math.abs(value.sourceEnd - value.sourceStart - (segment.musicEnd - segment.musicStart)) > 0.000001
        || (value.mediaSha256 !== undefined && !/^[a-f0-9]{64}$/.test(value.mediaSha256))) throw new Error("Generated planning evidence differs from its applied trim.");
      generatedEvidence = { assetId: text(value.assetId, 200, "covered asset"), sourceStart: value.sourceStart, sourceEnd: value.sourceEnd,
        evidenceKind: value.evidenceKind, completion: "unverified", ...(value.mediaSha256 ? { mediaSha256: value.mediaSha256 } : {}) };
      if (value.evidenceKind === "requested-direction") {
        if (!/^h3-[a-f0-9]{64}$/.test(value.jobId ?? "") || !value.mediaSha256) throw new Error("Canonical generated direction requires its job and media binding.");
        generatedEvidence.jobId = value.jobId;
        generatedEvidence.requestedDirection = text(value.requestedDirection, 6000, "prior requested direction");
      } else if (value.jobId !== undefined || value.requestedDirection !== undefined) throw new Error("Media-only coverage cannot claim a generated action.");
      const binding = JSON.stringify(selectedEvidence.canonicalBinding);
      if (!binding || new TextEncoder().encode(binding).length > 16_384) throw new Error("Generated planning binding exceeds its bound.");
      generatedEvidenceBindingSha256 = generationScopeSha256(selectedEvidence.canonicalBinding);
    }
    const moment = !segment.generatedAssetId && placement.kind === "source" ? project.videoMoments.find(moment => moment.id === placement.momentId) : undefined;
    const sourceStart = placement.sourceStart + segment.musicStart - placement.songStart;
    const sourceEnd = sourceStart + segment.musicEnd - segment.musicStart;
    if (moment && (!Number.isFinite(sourceStart) || !Number.isFinite(sourceEnd) || sourceStart < 0
      || sourceEnd > placement.sourceEnd + 0.001)) throw new Error("Source planning evidence exceeds its confirmed trim.");
    group.windows.push({ key, placementId: placement.id, songStart: segment.musicStart, songEnd: segment.musicEnd,
      inference: { fps: H3_FPS, frames, durationSeconds: frames / H3_FPS },
      ...(moment ? { sourceEvidence: { momentId: moment.id, caption: text(moment.caption || moment.label, 1800, "source evidence"), sourceStart, sourceEnd } } : {}),
      ...(generatedEvidence ? { generatedEvidence, generatedEvidenceBindingSha256 } : {}) });
    if (groups.length > H3_SHOT_PLANNING_LIMITS.groups || group.windows.length > H3_SHOT_PLANNING_LIMITS.windowsPerGroup) throw new Error("Shot planning group count exceeds its bound.");
  }
  if (params.generatedEvidenceByWindowKey && [...params.generatedEvidenceByWindowKey.keys()].some(key => !seen.has(key))) throw new Error("Generated evidence refers to another planning window.");
  for (const group of groups) {
    const item = project.editPlan.timelineItems.find(item => item.id === group.timelineItemId)!;
    if (group.windows[0].songStart !== item.start
      || group.windows.at(-1)!.songEnd !== item.end) throw new Error("Plan the full ordered requirement, not only its remaining holes.");
  }
  const settings = project.placementPlan.settings;
  if (!Number.isFinite(settings.cutDensity) || settings.cutDensity < 0 || settings.cutDensity > 1 || typeof settings.preferOnsets !== "boolean") throw new Error("Invalid confirmed shot pacing settings.");
  const body = { version: 1 as const, projectId: text(params.projectId ?? project.id, 200, "project"), planSignature,
    settings: { cutDensity: settings.cutDensity, preferOnsets: settings.preferOnsets }, subjectNames, groups,
    ...(params.coverageBinding !== undefined ? { coverageSha256: generationScopeSha256(params.coverageBinding) } : {}) };
  if (new TextEncoder().encode(JSON.stringify(body)).length > H3_SHOT_PLANNING_LIMITS.inputBytes) throw new Error("Shot planning input exceeds its byte bound.");
  return { ...body, bindingSha256: generationScopeSha256(body) };
}

/** Strict structural validation only. State equality and declared action-index
 * allocation cannot establish that free text obeys the approved story.
 * Callers must preserve overrides/frozen jobs and separately compile/lint/review.
 */
export function parseH3ShotPlanningResult(value: unknown, input: H3ShotPlanningInput): H3ShotPlanningResult {
  const { bindingSha256, ...body } = input;
  if (generationScopeSha256(body) !== bindingSha256) throw new Error("Shot planning input binding changed.");
  let serialized: string | undefined;
  try { serialized = typeof value === "string" ? value : JSON.stringify(value); }
  catch { throw new Error("Shot planning result must be JSON serializable."); }
  if (serialized === undefined) throw new Error("Invalid shot planning result.");
  if (new TextEncoder().encode(serialized).length > H3_SHOT_PLANNING_LIMITS.resultBytes) throw new Error("Shot planning result exceeds its byte bound.");
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { throw new Error("Shot planning result must be valid JSON."); }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid shot planning result.");
  const result = value as H3ShotPlanningResult;
  if (Object.keys(result).some(key => !["version", "bindingSha256", "directions"].includes(key))
    || result.version !== 1 || result.bindingSha256 !== bindingSha256 || !Array.isArray(result.directions)
    || result.directions.length !== input.groups.reduce((count, group) => count + group.windows.length, 0)) throw new Error("Shot planning result does not cover its exact bound input.");
  const directions: H3ShotDirection[] = [];
  let offset = 0;
  for (const group of input.groups) {
    const actionSequence = group.constraints.actionSequence ?? [];
    const allocated: number[] = [];
    let previousExit: string | undefined;
    for (const window of group.windows) {
      const entry = result.directions[offset++];
      if (!entry || typeof entry !== "object" || Array.isArray(entry)
        || Object.keys(entry).some(key => !["windowKey", "direction", "entryState", "exitState", "actionIndices"].includes(key))
        || entry.windowKey !== window.key || !Array.isArray(entry.actionIndices) || entry.actionIndices.length > actionSequence.length
        || entry.actionIndices.some(index => !Number.isInteger(index) || index < 0 || index >= actionSequence.length)) throw new Error("Shot directions must cover the requested ordered window keys exactly once.");
      const direction = text(entry.direction, H3_SHOT_PLANNING_LIMITS.directionCharacters, "direction");
      const entryState = text(entry.entryState, H3_SHOT_PLANNING_LIMITS.stateCharacters, "entry state");
      const exitState = text(entry.exitState, H3_SHOT_PLANNING_LIMITS.stateCharacters, "exit state");
      if (previousExit !== undefined && entryState !== previousExit) throw new Error("Adjacent planned shot states do not match.");
      previousExit = exitState;
      allocated.push(...entry.actionIndices);
      directions.push({ windowKey: window.key, direction, entryState, exitState, actionIndices: [...entry.actionIndices] });
    }
    if (allocated.length !== actionSequence.length || allocated.some((index, position) => index !== position)) throw new Error("Allocate the approved action sequence once, in order, without restarting it.");
  }
  return { version: 1, bindingSha256, directions };
}
