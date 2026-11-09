import { applyGeneratedAssetOverlays, buildGeneratedAssetPlaybackUrl, type GeneratedStudioAsset } from "./generatedAssets";
import type { GeneratedDraftSelection } from "./generatedDraft";
import type { EditPlanPreviewSegment } from "./musicVideoProject";
import { generatedAssetDraftIdentityBlockReason } from "./generatedAssetIdentity";
import { stripCurrentReferenceIdentity } from "./currentReferenceIdentity";
import { findH3TargetSegment } from "./h3DraftPlan";

/** Inventory only. Blocked approved cuts remain visible here; these segments never reach playback. */
export function assetsForCurrentReferenceReview(assets: GeneratedStudioAsset[], draft: GeneratedDraftSelection | null, base: EditPlanPreviewSegment[]) {
  const selected = new Set([...(draft?.assetIds ?? []), ...(draft?.reusedTakePlacements?.map(row => row.assetId) ?? [])]);
  const selectedAssets = (draft?.assetIds ?? []).map(id => assets.find(asset => asset.id === id)).filter((asset): asset is GeneratedStudioAsset => Boolean(asset));
  const approved = assets.filter(asset => asset.reviewStatus === "approved").sort((left, right) =>
    Date.parse(left.approvedAt ?? left.createdAt) - Date.parse(right.approvedAt ?? right.createdAt));
  const intended = [...approved, ...selectedAssets];
  const representedUrls = new Set(applyGeneratedAssetOverlays(base, intended).map(segment => segment.videoUrl));
  return assets.filter(asset => selected.has(asset.id)
    || (asset.reviewStatus === "approved" && representedUrls.has(buildGeneratedAssetPlaybackUrl(asset) ?? "")));
}

/** A current-reference check cannot repair missing historical eligibility or retarget a bank take. */
export function currentReferenceBankCheckBlockReason(asset: GeneratedStudioAsset, base: EditPlanPreviewSegment[]): string | null {
  if (!asset.currentReferenceIdentity?.required) return "This take does not require an updated-reference check.";
  if (asset.mediaKind !== "video" || asset.status !== "completed" || asset.reviewStatus === "rejected"
    || !/^h3-[a-f0-9]{64}$/.test(asset.jobId ?? "")) return "A completed, unrejected canonical take is required.";
  const originalBlock = generatedAssetDraftIdentityBlockReason(stripCurrentReferenceIdentity([asset])[0]);
  if (originalBlock) return `Historical similarity check required: ${originalBlock}`;
  if (!asset.target || !findH3TargetSegment(base, asset.target)) return "This take no longer matches the current story window.";
  return null;
}

/** An explicit bank action checks only that exact saved take. It never selects or changes its trim. */
export function assetsForCurrentReferenceCheck(assets: GeneratedStudioAsset[], draft: GeneratedDraftSelection | null,
  base: EditPlanPreviewSegment[], explicitAssetId?: string): GeneratedStudioAsset[] {
  if (explicitAssetId === undefined) return assetsForCurrentReferenceReview(assets, draft, base).filter(asset => asset.currentReferenceIdentity?.required);
  const asset = assets.find(candidate => candidate.id === explicitAssetId);
  if (!asset) throw new Error("The requested bank take is no longer available.");
  const block = currentReferenceBankCheckBlockReason(asset, base);
  if (block) throw new Error(block);
  return [asset];
}
