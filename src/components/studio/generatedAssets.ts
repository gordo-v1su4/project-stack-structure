import type { ImageSplitManifest } from "@/lib/imageSplitterGateway";
import type { MediaGatewayUploadResult } from "@/lib/mediaGateway";

export type GeneratedStudioAssetProvider = "higgsfield" | "swarmui";

export type GeneratedStudioAsset = {
  id: string;
  provider: GeneratedStudioAssetProvider;
  model: string;
  characterName?: string;
  title?: string;
  prompt: string;
  createdAt: string;
  jobId?: string;
  status: "completed" | "failed" | "queued" | "processing";
  aspectRatio?: string;
  resolution?: string;
  width?: number;
  height?: number;
  resultUrl?: string;
  thumbnailUrl?: string;
  fullStorage?: MediaGatewayUploadResult;
  split?: ImageSplitManifest;
};

export function sanitizeGeneratedStudioAssetForStorage(asset: GeneratedStudioAsset): GeneratedStudioAsset {
  return {
    id: asset.id,
    provider: asset.provider,
    model: asset.model,
    characterName: asset.characterName,
    title: asset.title,
    prompt: asset.prompt,
    createdAt: asset.createdAt,
    jobId: asset.jobId,
    status: asset.status,
    aspectRatio: asset.aspectRatio,
    resolution: asset.resolution,
    width: asset.width,
    height: asset.height,
    resultUrl: stripRuntimeUrl(asset.resultUrl),
    thumbnailUrl: stripRuntimeUrl(asset.thumbnailUrl),
    fullStorage: asset.fullStorage,
    split: asset.split,
  };
}

export function hydrateGeneratedStudioAssets(assets: GeneratedStudioAsset[] | undefined): GeneratedStudioAsset[] {
  return Array.isArray(assets) ? assets.map(sanitizeGeneratedStudioAssetForStorage) : [];
}

function stripRuntimeUrl(value: string | undefined) {
  if (!value) return undefined;
  return value.startsWith("data:") || value.startsWith("blob:") ? undefined : value;
}
