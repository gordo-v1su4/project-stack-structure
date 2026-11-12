import type { UploadedVideoSource } from "./types";
import { buildGeneratedAssetPlaybackUrl, type GeneratedStudioAsset } from "./generatedAssets";
import { reviewVideoReference } from "./reviewHoverPreview";
import type { ReviewBackfillInput } from "./reviewBackfill";

/** Original references only; preparation never edits the saved source inventory. */
export function reviewPreparationSources(videos: Array<Pick<UploadedVideoSource, "name" | "storageBucket" | "storagePath">>, assets: GeneratedStudioAsset[]): ReviewBackfillInput[] {
  const sources: ReviewBackfillInput[] = [], seen = new Set<string>();
  function add(bucket: string | undefined, objectKey: string | undefined, label: string) {
    if (!bucket || !objectKey || !/\.(mp4|mov|mkv|webm|m4v)$/i.test(objectKey)) return;
    const key = JSON.stringify([bucket, objectKey]);
    if (seen.has(key)) return; seen.add(key);
    sources.push({ bucket, objectKey, label: label.replace(/\s+/g, " ").trim().slice(0, 160) || "Stored video" });
  }
  for (const video of videos) add(video.storageBucket, video.storagePath, video.name);
  for (const asset of assets) {
    if (asset.status !== "completed" || asset.mediaKind !== "video") continue;
    const reference = reviewVideoReference(buildGeneratedAssetPlaybackUrl(asset) ?? "", "https://studio.invalid");
    if (reference) add(reference.bucket, reference.objectKey, asset.title || asset.target?.timelineItemId || asset.id);
  }
  return sources;
}
