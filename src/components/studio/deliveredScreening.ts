import { applyGeneratedAssetOverlays, type GeneratedStudioAsset } from "./generatedAssets";
import type { EditPlanPreviewSegment } from "./musicVideoProject";
import type { StillAnimaticPlan } from "./stillAnimatic";
import type { UploadedVideoSource } from "./types";

/** Read-only playback projection. Never used to adopt takes or authorize export. */
export function buildDeliveredScreeningSegments({ segments, assets, videoSources, plan, projectId }: {
  segments: EditPlanPreviewSegment[]; assets: GeneratedStudioAsset[]; videoSources: UploadedVideoSource[];
  plan?: StillAnimaticPlan | null; projectId: string;
}): EditPlanPreviewSegment[] {
  const candidates = assets.filter(asset => asset.reviewStatus !== "rejected")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  return segments.flatMap(segment => {
    if (segment.kind !== "gap" && segment.videoUrl) return [segment];
    const overlaid = applyGeneratedAssetOverlays([segment], candidates);
    if (overlaid.some(part => part.kind !== "gap" && part.videoUrl)) return overlaid.map(part => ({
      ...part, thumbnailUrl: part.thumbnailUrl ?? segment.thumbnailUrl,
    }));
    const retained = plan?.projectId === projectId ? plan.shots.find(shot => shot.id === segment.animaticShotId)?.sourceFrame : undefined;
    const source = retained && videoSources.find(source => source.id === retained.sourceId);
    const duration = segment.musicEnd - segment.musicStart;
    if (!retained || !source?.videoUrl || !Number.isFinite(retained.sourceSecond) || retained.sourceSecond < 0
      || !Number.isFinite(source.duration) || retained.sourceSecond + duration > source.duration + .001) return [segment];
    const videoUrl = source.storageBucket && source.storagePath
      ? `/api/storage/media?${new URLSearchParams({ bucket: source.storageBucket, objectKey: source.storagePath })}` : source.videoUrl;
    return [{ ...segment, kind: "source" as const, videoUrl, sourceClipId: source.id,
      startTime: retained.sourceSecond, endTime: retained.sourceSecond + duration, gapReason: undefined,
      sourceRefLabel: "PREVIEW · retained source footage", useClipAudio: false }];
  });
}
