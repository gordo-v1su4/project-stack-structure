import type { H3ReferenceSnapshot } from "./h3Generation";

/** Availability is separate from explicit per-shot inclusion. Never identity authority. */
export type AestheticReferenceAsset = {
  id: string;
  purpose: "shot" | "style";
  displayName: string;
  fileName: string;
  sha256: string;
  guidance: string;
  scope: { kind: "project" } | { kind: "section"; sectionId: string } | { kind: "shot"; timelineItemId: string };
  previewUrl: string;
  storageBucket?: string;
  storagePath?: string;
  storageUrl?: string;
  storageStatus: "uploading" | "uploaded" | "failed";
  storageError?: string;
  createdAt: string;
};
export type AestheticReferenceLibrary = { assets: AestheticReferenceAsset[]; shots: Record<string, string[]> };
export const EMPTY_AESTHETIC_REFERENCES: AestheticReferenceLibrary = { assets: [], shots: {} };
export const MAX_AESTHETIC_SHOT_REFERENCES = 3;

export function normalizeAestheticReferences(value: unknown): AestheticReferenceLibrary {
  if (!value || typeof value !== "object") return { assets: [], shots: {} };
  const raw = value as Partial<AestheticReferenceLibrary>;
  const seen = new Set<string>();
  const ids = new Set<string>();
  const assets: AestheticReferenceAsset[] = [];
  for (const asset of Array.isArray(raw.assets) ? raw.assets.slice(0, 128) : []) {
    if (!asset || typeof asset.id !== "string" || !asset.id.startsWith("aesthetic-") || ids.has(asset.id)
      || !/^[a-f0-9]{64}$/.test(asset.sha256) || seen.has(asset.sha256)
      || !["shot", "style"].includes(asset.purpose) || typeof asset.displayName !== "string"
      || typeof asset.fileName !== "string" || typeof asset.createdAt !== "string") continue;
    if (!asset.scope || !["project", "section", "shot"].includes(asset.scope.kind)
      || (asset.scope.kind === "section" && (typeof asset.scope.sectionId !== "string" || !asset.scope.sectionId))
      || (asset.scope.kind === "shot" && (typeof asset.scope.timelineItemId !== "string" || !asset.scope.timelineItemId))) continue;
    const scope = asset.scope?.kind === "section" && typeof asset.scope.sectionId === "string"
      ? { kind: "section" as const, sectionId: asset.scope.sectionId }
      : asset.scope?.kind === "shot" && typeof asset.scope.timelineItemId === "string"
        ? { kind: "shot" as const, timelineItemId: asset.scope.timelineItemId } : { kind: "project" as const };
    ids.add(asset.id); seen.add(asset.sha256);
    const durable = typeof asset.storageUrl === "string" && /^https?:\/\//.test(asset.storageUrl) ? asset.storageUrl : undefined;
    assets.push({ ...asset, scope, displayName: asset.displayName.slice(0, 120), guidance: typeof asset.guidance === "string" ? asset.guidance.slice(0, 500) : "",
      previewUrl: durable ?? "", storageUrl: durable,
      storageStatus: asset.storageStatus === "uploaded" && durable ? "uploaded" : "failed",
      ...(asset.storageStatus === "uploading" ? { storageError: "Upload was interrupted. Remove this entry and add the original again." } : {}) });
  }
  const shots: Record<string, string[]> = {};
  if (raw.shots && typeof raw.shots === "object" && !Array.isArray(raw.shots)) {
    for (const [shot, selected] of Object.entries(raw.shots).slice(0, 1024)) {
      if (["__proto__", "prototype", "constructor"].includes(shot)) continue;
      if (Array.isArray(selected)) shots[shot] = [...new Set(selected.filter((id): id is string => typeof id === "string"))].slice(0, MAX_AESTHETIC_SHOT_REFERENCES);
    }
  }
  return { assets, shots };
}

export function aestheticReferenceApplies(asset: AestheticReferenceAsset, target: { sectionId: string; timelineItemId?: string }) {
  return asset.scope.kind === "project" || (asset.scope.kind === "section" ? asset.scope.sectionId === target.sectionId : asset.scope.timelineItemId === target.timelineItemId);
}

export function selectedAestheticReferences(library: AestheticReferenceLibrary | undefined, target: { sectionId: string; timelineItemId?: string }, ids?: string[]) {
  const selected = ids ?? (target.timelineItemId ? library?.shots[target.timelineItemId] : []) ?? [];
  if (selected.length > MAX_AESTHETIC_SHOT_REFERENCES || new Set(selected).size !== selected.length) throw new Error("Choose at most three distinct shot and style refs.");
  return selected.map(id => {
    const asset = library?.assets.find(asset => asset.id === id);
    if (!asset || !aestheticReferenceApplies(asset, target) || asset.storageStatus !== "uploaded" || !asset.storageBucket || !asset.storagePath) {
      throw new Error("A selected shot or style ref is unavailable for this shot. Restore it or remove its selection.");
    }
    assertSafeAestheticGuidance(asset.guidance);
    return asset;
  });
}

export function aestheticReferenceRole(asset: AestheticReferenceAsset): H3ReferenceSnapshot["role"] {
  return asset.purpose === "style" ? "style" : "composition";
}

/** User visual notes cannot redefine the server-owned native reference wrapper. */
export function assertSafeAestheticGuidance(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length > 500
    || /<(?:Subject|Picture|Video|Audio)\b|\[Shot\b|(?:^|\n)\s*(?:subject_definitions|detailed_description|summary|retention_analysis|overall_soundscape|non_diegetic_music|integrated_multimodal_description)\s*:/i.test(value)) {
    throw new Error("Use plain visual guidance for shot/style refs; the server supplies the H3 reference wrapper.");
  }
}

export async function originalImageSha256(file: File) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())), byte => byte.toString(16).padStart(2, "0")).join("");
}
