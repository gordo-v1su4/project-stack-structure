import type { MediaGatewayUploadResult } from "@/lib/mediaGateway";
import type { GeneratedStudioAsset, GeneratedStudioAssetTarget } from "./generatedAssets";
import type { EditPlanPreviewSegment } from "./musicVideoProject";
import { createImportedVideoAsset, type ExternalClipImportKind } from "./externalClipImport";
import { sameAnimaticMotionBinding } from "./animaticMotionBinding";

export type ExternalImportRange = { songStart: number; songEnd: number };
const overlaps = (a: ExternalImportRange, b: ExternalImportRange) => a.songStart < b.songEnd && a.songEnd > b.songStart;
const valid = (range: ExternalImportRange) => Number.isFinite(range.songStart) && Number.isFinite(range.songEnd) && range.songStart >= 0 && range.songEnd > range.songStart;

/** Selected cuts remain reserved even while their identity checks are pending. */
export function externalImportWindows(segment: EditPlanPreviewSegment, resolved: EditPlanPreviewSegment[], selected: GeneratedStudioAsset[]) {
  const cut = { songStart: segment.musicStart, songEnd: segment.musicEnd };
  if (!valid(cut) || !segment.planSignature) throw new Error("Select a current resolved cut before importing.");
  const reserved = selected.flatMap(asset => {
    const target = asset.target;
    if (!target) throw new Error("A selected take has no target. Restore the current draft before importing.");
    if (target.planSignature !== segment.planSignature) return [];
    if (!sameAnimaticMotionBinding(target.animaticMotion, segment.animaticMotion)) return [];
    if (!valid(target)) throw new Error("A selected take has an invalid target. Restore the current draft before importing.");
    return overlaps(target, cut) ? [{ songStart: target.songStart, songEnd: target.songEnd }] : [];
  });
  const gaps = resolved.filter(item => item.kind === "gap" && item.planSignature === segment.planSignature)
    .map(item => ({ songStart: Math.max(cut.songStart, item.musicStart), songEnd: Math.min(cut.songEnd, item.musicEnd) })).filter(valid)
    .sort((a, b) => a.songStart - b.songStart);
  const merged: ExternalImportRange[] = [];
  for (const gap of gaps) {
    const previous = merged.at(-1);
    if (previous && gap.songStart <= previous.songEnd) previous.songEnd = Math.max(previous.songEnd, gap.songEnd);
    else merged.push({ ...gap });
  }
  const uncovered = reserved.reduce((windows, used) => windows.flatMap(window => !overlaps(window, used) ? [window] : [
    { songStart: window.songStart, songEnd: Math.min(window.songEnd, used.songStart) },
    { songStart: Math.max(window.songStart, used.songEnd), songEnd: window.songEnd },
  ].filter(valid)), merged);
  return { reserved, uncovered, defaultRange: uncovered[0] ?? cut };
}

/** Target metadata stays on the original resolved cut; only its explicit song interval narrows. */
export function externalImportTarget(segment: EditPlanPreviewSegment, range: ExternalImportRange, reserved: ExternalImportRange[], timelineItemId: string): GeneratedStudioAssetTarget {
  if (!valid(range) || !valid({ songStart: segment.musicStart, songEnd: segment.musicEnd }) || !segment.planSignature
    || range.songStart < segment.musicStart || range.songEnd > segment.musicEnd) throw new Error("Import start and end must stay inside the selected resolved cut.");
  if (reserved.some(used => !valid(used) || overlaps(range, used))) throw new Error("This interval overlaps a selected take. Choose an uncovered interval; existing selected takes stay intact.");
  if (segment.animaticShotId && (!segment.animaticMotion || range.songStart !== segment.musicStart || range.songEnd !== segment.musicEnd)) {
    throw new Error("Import footage for the complete reviewed animatic shot.");
  }
  return { timelineItemId: segment.timelineItemId ?? timelineItemId, planSignature: segment.planSignature, requirementId: segment.requirementId,
    ...(segment.animaticMotion ? { animaticMotion: { ...segment.animaticMotion } } : {}),
    narrativeMomentId: segment.narrativeMomentId, sectionId: segment.sectionId, sectionLabel: segment.label, parentMomentId: segment.momentId, ...range };
}

/** Async work may leave an uploaded file, but stale targets never enter the bank. */
export async function importExternalClipCandidate(params: { file: File; kind: ExternalClipImportKind; target: GeneratedStudioAssetTarget;
  isCurrent: () => boolean; readDuration: (file: File) => Promise<number>; upload: (file: File) => Promise<MediaGatewayUploadResult>;
  deliver: (asset: GeneratedStudioAsset) => void }) {
  const assertCurrent = () => { if (!params.isCurrent()) throw new Error("The project, selected cut or import interval changed. The clip was not added to the bank."); };
  const target = { ...params.target, ...(params.target.animaticMotion ? { animaticMotion: { ...params.target.animaticMotion } } : {}) };
  if (!valid(target) || !target.planSignature) throw new Error("Choose a valid current import target.");
  assertCurrent();
  const durationSeconds = await params.readDuration(params.file);
  assertCurrent();
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || target.songStart + durationSeconds < target.songEnd) throw new Error("This clip is shorter than the chosen import interval. Choose a shorter interval or a longer clip.");
  const storage = await params.upload(params.file);
  assertCurrent();
  params.deliver(createImportedVideoAsset({ kind: params.kind, fileName: params.file.name, durationSeconds, storage, target }));
}
