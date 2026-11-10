import { buildGeneratedAssetPlaybackUrl, generatedAssetDraftIdentityBlockReason, type GeneratedStudioAsset, type GeneratedStudioAssetTarget } from "./generatedAssets";
import { effectiveGenerationScope, generationScopeSha256, generationSemanticSha256, normalizeGenerationScopeReceipt } from "./generationScope";
import { currentIdentityReviewSha256, currentReferenceIdentityApprovalSha256 } from "./currentReferenceIdentity";
import { currentIdentityEvidenceSha256 } from "./issuedIdentityPolicy";
import { placementInputSignature, type EditPlanPreviewSegment, type MusicVideoProject } from "./musicVideoProject";
import { sameAnimaticMotionBinding } from "./animaticMotionBinding";

/** A lookup coordinate, never authority. Server readers retrieve the canonical same-project record. */
export type ReuseSourceBaseline = { scopeSignature: string; semanticSha256: string; receiptId?: string };
export type ReuseOrigin = { assetId: string; jobId: string; scopeSignature: string; assetSha256: string };
export type ReusedTakePlacement = {
  version: 1; id: string; assetId: string; jobId: string; originSha256: string;
  target: GeneratedStudioAssetTarget; sourceStart: number; sourceEnd: number;
  /** Fresh consent to this placement and current evidence, not a historical asset approval. */
  approvedReviewSha256?: string;
};
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/** Review fields and runtime URLs cannot rewrite immutable origin identity. */
export function reuseOriginAssetSha256(asset: GeneratedStudioAsset): string {
  return generationScopeSha256({ id: asset.id, jobId: asset.jobId, provider: asset.provider, model: asset.model,
    target: asset.target, mediaSha256: asset.mediaSha256, mediaFrameCount: asset.mediaFrameCount, mediaFrameRate: asset.mediaFrameRate,
    durationSeconds: asset.durationSeconds, trimStart: asset.trimStart ?? 0,
    storage: { bucket: asset.fullStorage?.bucket, objectKey: asset.fullStorage?.objectKey ?? asset.fullStorage?.storagePath },
    generationReferenceHashes: asset.generationReferenceHashes, identityReferenceHashes: asset.identityReferenceHashes,
    identityVerification: asset.identityVerification, identityAssessmentId: asset.identityAssessmentId,
    identityAssessmentTrimStart: asset.identityAssessmentTrimStart, firstFrame: asset.firstFrame });
}

export function retainReuseSourceBaselines(previous: MusicVideoProject | null | undefined, next: MusicVideoProject, hasExistingGeneratedFootage = false): MusicVideoProject {
  if (!previous) return next;
  const baselines = [...(previous.reuseSourceBaselines ?? [])];
  const receipt = normalizeGenerationScopeReceipt(previous.generationScope), scope = receipt?.body.scopeSignature ?? effectiveGenerationScope(previous);
  if (scope && (receipt || baselines.length || hasExistingGeneratedFootage)) baselines.push({ scopeSignature: scope, semanticSha256: receipt?.body.semanticSha256 ?? generationSemanticSha256(previous),
    ...(receipt ? { receiptId: receipt.id } : {}) });
  const unique = [...new Map(baselines.map(row => [generationScopeSha256(row), row])).values()];
  if (unique.length > 32) throw new Error("The historical source baseline bound was reached.");
  const current = { ...next, id: previous.id, ...(unique.length ? { reuseSourceBaselines: unique } : {}),
    ...(previous.currentIdentity ? { currentIdentity: previous.currentIdentity } : {}) };
  if (!current.placementPlan) return current;
  const inputSignature = placementInputSignature(current, current.placementPlan.settings);
  return current.placementPlan.inputSignature === inputSignature ? current
    : { ...current, placementPlan: { ...current.placementPlan, inputSignature } };
}

export function sanitizeReusedTakePlacements(value: unknown): ReusedTakePlacement[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 128) throw new Error("Invalid reused footage placements.");
  const ids = new Set<string>();
  return value.map((row: ReusedTakePlacement) => {
    if (!row || row.version !== 1 || typeof row.id !== "string" || row.id.length > 256 || !row.id || ids.has(row.id)
      || typeof row.assetId !== "string" || !row.assetId || !/^h3-[a-f0-9]{64}$/.test(row.jobId) || !hash(row.originSha256)
      || !row.target || !row.target.planSignature || !row.target.timelineItemId || !row.target.sectionId
      || ![row.sourceStart, row.sourceEnd, row.target.songStart, row.target.songEnd].every(Number.isFinite)
      || row.sourceStart < 0 || row.sourceEnd <= row.sourceStart || row.target.songStart < 0
      || !near(row.sourceEnd - row.sourceStart, row.target.songEnd - row.target.songStart)
      || row.approvedReviewSha256 !== undefined && !hash(row.approvedReviewSha256)) throw new Error("Invalid reused footage placement.");
    ids.add(row.id);
    return { version: 1, id: row.id, assetId: row.assetId, jobId: row.jobId, originSha256: row.originSha256,
      target: { ...row.target }, sourceStart: row.sourceStart, sourceEnd: row.sourceEnd,
      ...(row.approvedReviewSha256 ? { approvedReviewSha256: row.approvedReviewSha256 } : {}) };
  });
}

export function reusedTakeReviewSha256(row: ReusedTakePlacement, asset: GeneratedStudioAsset): string {
  const placement = { ...row };
  delete placement.approvedReviewSha256;
  return generationScopeSha256({ placement, origin: reuseOriginAssetSha256(asset),
    identityEvidenceSha256: currentIdentityEvidenceSha256(asset), currentReferenceEvidenceSha256: currentReferenceIdentityApprovalSha256(asset),
    currentIdentity: asset.currentReferenceIdentity ? currentIdentityReviewSha256(asset.currentReferenceIdentity.context) : undefined });
}

function reusedTakeOriginMatches(row: ReusedTakePlacement, asset: GeneratedStudioAsset): boolean {
  const target = row.target, origin = asset.target;
  return asset.id === row.assetId && asset.jobId === row.jobId && asset.provider === "swarmui" && Boolean(origin?.planSignature)
    && asset.reviewStatus !== "rejected" && asset.status === "completed" && asset.mediaKind === "video"
    && generatedAssetDraftIdentityBlockReason(asset) === null && reuseOriginAssetSha256(asset) === row.originSha256
    && row.sourceStart >= (asset.trimStart ?? 0) - 1e-6
    && row.sourceEnd <= (asset.trimStart ?? 0) + origin!.songEnd - origin!.songStart + 1e-6
    && row.sourceEnd <= (asset.durationSeconds ?? 0) + 1e-6
    && near(row.sourceEnd - row.sourceStart, target.songEnd - target.songStart);
}
function reusedTakeWindowMatches(row: ReusedTakePlacement, segment: EditPlanPreviewSegment): boolean {
  const target = row.target;
  return target.planSignature === segment.planSignature && target.sectionId === segment.sectionId && target.timelineItemId === segment.timelineItemId
    && sameAnimaticMotionBinding(target.animaticMotion, segment.animaticMotion)
    && target.requirementId === segment.requirementId && target.narrativeMomentId === segment.narrativeMomentId
    && target.songStart < segment.musicEnd - 1e-6 && target.songEnd > segment.musicStart + 1e-6;
}
export function reusedTakePlacementMatches(row: ReusedTakePlacement, asset: GeneratedStudioAsset, segment: EditPlanPreviewSegment): boolean {
  return reusedTakeWindowMatches(row, segment) && reusedTakeOriginMatches(row, asset);
}

/** Validate every saved row, including unused/stale rows, before a server boundary consumes it. */
export function assertCurrentReusedTakePlacements(project: MusicVideoProject, rows: unknown) {
  const placements = sanitizeReusedTakePlacements(rows) ?? [];
  const scope = effectiveGenerationScope(project);
  for (const row of placements) {
    const item = project.editPlan.timelineItems.find(item => item.id === row.target.timelineItemId);
    const origin = project.generationScope?.body.reuseOrigins?.find(origin => origin.assetId === row.assetId && origin.jobId === row.jobId);
    if (!item || row.target.planSignature !== scope || row.target.sectionId !== item.sectionId
      || row.target.requirementId !== item.requirementId || row.target.narrativeMomentId !== item.narrativeMomentId
      || row.target.songStart < item.start - 1e-6 || row.target.songEnd > item.end + 1e-6
      || !origin || origin.assetSha256 !== row.originSha256) throw new Error("A reused placement no longer matches the current story and canonical origin baseline.");
  }
  const sorted = [...placements].sort((a, b) => a.target.songStart - b.target.songStart);
  if (sorted.some((row, index) => index > 0 && row.target.songStart < sorted[index - 1].target.songEnd - 1e-6)) throw new Error("Reused placements overlap. Select one take for each song window.");
  return placements;
}

/** Explicit owner selection for the current target. The canonical baseline names eligible origins. */
export function selectReusedTakePlacement<T extends { planSignature: string; revision: number; assetIds: string[]; reusedTakePlacements?: ReusedTakePlacement[] }>(
  draft: T, project: MusicVideoProject, asset: GeneratedStudioAsset, segment: EditPlanPreviewSegment, sourceStart = asset.trimStart ?? 0): T {
  if (segment.animaticShotId) throw new Error("Existing-footage placement into the animatic still needs source-trim review support.");
  const scope = effectiveGenerationScope(project), origin = project.generationScope?.body.reuseOrigins?.find(origin => origin.assetId === asset.id && origin.jobId === asset.jobId);
  if (!scope || draft.planSignature !== scope || segment.planSignature !== scope || !segment.timelineItemId || !origin
    || origin.assetSha256 !== reuseOriginAssetSha256(asset) || origin.scopeSignature !== asset.target?.planSignature) throw new Error("Confirm the revised story and its canonical origin footage before reusing this take.");
  const target: GeneratedStudioAssetTarget = { planSignature: scope, timelineItemId: segment.timelineItemId, sectionId: segment.sectionId,
    ...(segment.animaticMotion ? { animaticMotion: segment.animaticMotion } : {}),
    sectionLabel: project.storySections.find(section => section.id === segment.sectionId)?.label ?? segment.sectionId,
    ...(segment.requirementId ? { requirementId: segment.requirementId } : {}),
    ...(segment.narrativeMomentId ? { narrativeMomentId: segment.narrativeMomentId } : {}), songStart: segment.musicStart,
    songEnd: Math.min(segment.musicEnd, segment.musicStart + asset.target!.songEnd - asset.target!.songStart - sourceStart + (asset.trimStart ?? 0)) };
  const body = { version: 1 as const, assetId: asset.id, jobId: asset.jobId!, originSha256: origin.assetSha256, target,
    sourceStart, sourceEnd: sourceStart + target.songEnd - target.songStart };
  const row: ReusedTakePlacement = { ...body, id: `reuse-${generationScopeSha256(body)}` };
  if (!reusedTakePlacementMatches(row, asset, segment)) throw new Error("This take cannot cover the selected window within its verified original source selection.");
  const reusedTakePlacements = [...(draft.reusedTakePlacements ?? []).filter(previous => previous.target.songEnd <= target.songStart || previous.target.songStart >= target.songEnd), row];
  if (reusedTakePlacements.length > 128) throw new Error("The reused footage placement bound was reached.");
  return { ...draft, revision: draft.revision + 1, reusedTakePlacements, sourceReviewRequired: true };
}

/** Compose current creative placements directly; never manufacture an asset with a replacement historical target. */
export function applyReusedTakePlacements(segments: EditPlanPreviewSegment[], assets: GeneratedStudioAsset[],
  rows: ReusedTakePlacement[] = [], approvedOnly = false): EditPlanPreviewSegment[] {
  let result = segments;
  for (const row of rows) {
    const asset = assets.find(asset => asset.id === row.assetId);
    if (!asset || !reusedTakeOriginMatches(row, asset) || approvedOnly && row.approvedReviewSha256 !== reusedTakeReviewSha256(row, asset)) continue;
    const videoUrl = buildGeneratedAssetPlaybackUrl(asset);
    if (!videoUrl) continue;
    result = result.flatMap(segment => {
      if (!reusedTakeWindowMatches(row, segment)) return [segment];
      const start = Math.max(row.target.songStart, segment.musicStart), end = Math.min(row.target.songEnd, segment.musicEnd);
      const slice = (from: number, to: number): EditPlanPreviewSegment => {
        const ratio = (segment.endTime - segment.startTime) / (segment.musicEnd - segment.musicStart);
        return { ...segment, musicStart: from, musicEnd: to,
          startTime: segment.kind === "gap" ? 0 : segment.startTime + (from - segment.musicStart) * ratio,
          endTime: segment.kind === "gap" ? to - from : segment.startTime + (to - segment.musicStart) * ratio };
      };
      return [...(start > segment.musicStart + 1e-6 ? [slice(segment.musicStart, start)] : []),
        { ...segment, kind: "source" as const, videoUrl, generatedAssetId: asset.id, reusedTakePlacementId: row.id,
          gapReason: undefined, momentId: undefined, sourceClipId: undefined, useClipAudio: false,
          musicStart: start, musicEnd: end, startTime: row.sourceStart + start - row.target.songStart,
          endTime: row.sourceStart + end - row.target.songStart, label: asset.title ?? "Reused generated footage" },
        ...(end < segment.musicEnd - 1e-6 ? [slice(end, segment.musicEnd)] : [])];
    });
  }
  return result;
}
