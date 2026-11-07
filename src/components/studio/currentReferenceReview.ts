import { applyGeneratedAssetOverlays, buildGeneratedAssetPlaybackUrl, type GeneratedStudioAsset } from "./generatedAssets";
import type { GeneratedDraftSelection } from "./generatedDraft";
import type { EditPlanPreviewSegment } from "./musicVideoProject";

/** Inventory only. Blocked approved cuts remain visible here; these segments never reach playback. */
export function assetsForCurrentReferenceReview(assets: GeneratedStudioAsset[], draft: GeneratedDraftSelection | null, base: EditPlanPreviewSegment[]) {
  const selected = new Set(draft?.assetIds ?? []);
  const selectedAssets = (draft?.assetIds ?? []).map(id => assets.find(asset => asset.id === id)).filter((asset): asset is GeneratedStudioAsset => Boolean(asset));
  const approved = assets.filter(asset => asset.reviewStatus === "approved").sort((left, right) =>
    Date.parse(left.approvedAt ?? left.createdAt) - Date.parse(right.approvedAt ?? right.createdAt));
  const intended = [...approved, ...selectedAssets];
  const representedUrls = new Set(applyGeneratedAssetOverlays(base, intended).map(segment => segment.videoUrl));
  return assets.filter(asset => selected.has(asset.id)
    || (asset.reviewStatus === "approved" && representedUrls.has(buildGeneratedAssetPlaybackUrl(asset) ?? "")));
}
