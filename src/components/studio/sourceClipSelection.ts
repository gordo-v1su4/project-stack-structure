import { generationScopeSha256 } from "./generationScope";
import { createImportedVideoAsset } from "./externalClipImport";
import { externalImportTarget } from "./externalClipImportTarget";
import type { GeneratedStudioAsset } from "./generatedAssets";
import type { EditPlanPreviewSegment } from "./musicVideoProject";
import type { UploadedVideoSource } from "./types";

/** Descriptor binding, not a claim that the browser verified the media bytes. */
export type SourceClipSelection = { version: 1; sourceId: number; sourceBindingSha256: string; browserDuration: number };

export function sourceClipBinding(source: UploadedVideoSource) {
  return generationScopeSha256({ id: source.id, bucket: source.storageBucket, objectKey: source.storagePath,
    size: source.size, chunks: source.uploadChunks?.chunks ?? [] });
}

export function normalizeSourceClipSelection(value: unknown): SourceClipSelection | undefined {
  const row = value as SourceClipSelection;
  if (!row || row.version !== 1 || !Number.isSafeInteger(row.sourceId) || row.sourceId < 0
    || typeof row.sourceBindingSha256 !== "string" || !/^[a-f0-9]{64}$/.test(row.sourceBindingSha256)
    || !Number.isFinite(row.browserDuration) || row.browserDuration <= 0 || row.browserDuration > 86400) return undefined;
  return { version: 1, sourceId: row.sourceId, sourceBindingSha256: row.sourceBindingSha256, browserDuration: row.browserDuration };
}

export function createSourceClipCandidate(source: UploadedVideoSource, segment: EditPlanPreviewSegment,
  sourceStart: number, browserDuration: number): GeneratedStudioAsset {
  if (!source.storageBucket || !source.storagePath || source.storageStatus !== "uploaded" || source.uploadChunks?.chunks.length) {
    throw new Error("Choose a completely uploaded single-file source clip.");
  }
  if (!segment.animaticShotId || !segment.animaticMotion) throw new Error("Review the complete current animatic before choosing source footage.");
  const selection = normalizeSourceClipSelection({ version: 1, sourceId: source.id, sourceBindingSha256: sourceClipBinding(source), browserDuration });
  if (!selection || !Number.isFinite(sourceStart) || sourceStart < 0 || sourceStart + segment.musicEnd - segment.musicStart > browserDuration + 1e-6) {
    throw new Error("The source trim must cover this whole shot within the browser-reported clip duration.");
  }
  const target = externalImportTarget(segment, { songStart: segment.musicStart, songEnd: segment.musicEnd }, [], segment.timelineItemId!);
  const candidate = createImportedVideoAsset({ kind: "original-footage", fileName: source.name, durationSeconds: browserDuration, target,
    storage: { bucket: source.storageBucket, objectKey: source.storagePath, storagePath: source.storagePath, publicUrl: "", mime: "video/mp4" } });
  return { ...candidate, model: "original-source-selection", sourceClip: selection, trimStart: sourceStart,
    prompt: "Selected existing project footage for explicit assembled-draft review. No upload, generation or identity verification claimed." };
}

/** Called after the server has validated the canonical project source scope. */
export function assertCurrentSourceClipCandidate(asset: GeneratedStudioAsset, sources: UploadedVideoSource[]) {
  const row = normalizeSourceClipSelection(asset.sourceClip), source = row && sources.find(source => source.id === row.sourceId);
  const start = asset.trimStart ?? 0, target = asset.target;
  if (!row || !source || asset.provider !== "editorial" || asset.model !== "original-source-selection" || asset.jobId
    || source.storageStatus !== "uploaded" || source.uploadChunks?.chunks.length || !source.storageBucket || !source.storagePath
    || row.sourceBindingSha256 !== sourceClipBinding(source) || asset.durationSeconds !== row.browserDuration
    || asset.fullStorage?.bucket !== source.storageBucket || (asset.fullStorage.objectKey ?? asset.fullStorage.storagePath) !== source.storagePath
    || !target?.animaticMotion || !Number.isFinite(start) || start < 0 || !Number.isFinite(target.songEnd - target.songStart)
    || target.songEnd <= target.songStart || start + target.songEnd - target.songStart > row.browserDuration + 1e-6) {
    throw new Error("The selected source clip, descriptor or trim changed after draft review.");
  }
  return source;
}
