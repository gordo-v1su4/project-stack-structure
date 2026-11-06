import type { MediaGatewayUploadResult } from "@/lib/mediaGateway";
import type { GeneratedStudioAsset, GeneratedStudioAssetTarget } from "./generatedAssets";

export type ExternalClipImportKind = "seedance" | "original-footage";

/** Folder labels only; the exact cut target is stored separately and the server inserts the owner. */
export function buildImportedVideoUploadFolder({ kind = "seedance", projectId, cutId }: {
  kind?: ExternalClipImportKind;
  projectId?: string;
  cutId: string;
}): string {
  const segment = (value: string | undefined, fallback: string) => {
    const safe = (value ?? "").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 160);
    return !safe || safe === "." || safe === ".." ? fallback : safe;
  };
  const prefix = kind === "original-footage" ? "editorial/original-footage" : "generated/higgsfield/seedance";
  return `media-uploads/${prefix}/${segment(projectId, "draft")}/${segment(cutId, "resolved-cut")}`;
}

/** Provenance is explicit; importing never approves a clip or supplies H3 evidence. */
export function createImportedVideoAsset({ kind = "seedance", fileName, durationSeconds, storage, target }: {
  kind?: ExternalClipImportKind;
  fileName: string;
  durationSeconds: number;
  storage: MediaGatewayUploadResult;
  target: GeneratedStudioAssetTarget;
}): GeneratedStudioAsset {
  const editorial = kind === "original-footage";
  const model = editorial ? "original-footage-edit"
    : /seedance[-_. ]?2[._-]?5/i.test(fileName) ? "seedance_2_5"
    : /seedance[-_. ]?2[._-]?0/i.test(fileName) ? "seedance_2_0" : "seedance";
  return {
    id: `${editorial ? "editorial" : "seedance"}:${crypto.randomUUID()}`,
    provider: editorial ? "editorial" : "higgsfield",
    model,
    title: fileName.replace(/\.[^.]+$/, ""),
    prompt: editorial ? "Imported edit of original footage for explicit draft review; no AI generation or identity verification claimed."
      : "Imported completed Seedance continuation for explicit review.",
    createdAt: new Date().toISOString(),
    status: "completed",
    resultUrl: storage.mediaUrl ?? storage.publicUrl,
    fullStorage: storage,
    mediaKind: "video",
    durationSeconds,
    trimStart: 0,
    reviewStatus: "pending",
    target: { ...target },
  };
}
