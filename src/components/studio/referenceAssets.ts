import { uploadFileDirectlyToRustFs } from "./directUploadClient";

export type ReferenceAssetRole = "character-1" | "character-2" | "environment" | "custom";
export type ReferenceAssetLibraryRole = ReferenceAssetRole | "crowd";
export type ReferenceAssetKind = "character" | "environment" | "crowd" | "prop" | "vehicle" | "wardrobe" | "custom";
export type ReferenceAssetStatus = "local" | "uploading" | "uploaded" | "failed";

export interface ReferenceAsset {
  id: string;
  role: ReferenceAssetLibraryRole;
  kind: ReferenceAssetKind;
  displayName: string;
  fileName: string;
  previewUrl: string;
  promptHint: string;
  storageProvider?: "local" | "rustfs";
  storageBucket?: string;
  storagePath?: string;
  storageUrl?: string;
  storageStatus: ReferenceAssetStatus;
  storageError?: string | null;
  createdAt: string;
}

export interface GenerationReferenceSelection {
  character1Id?: string;
  character2Id?: string;
  environmentId?: string;
  crowdIds?: string[];
  customId?: string;
}

export interface GenerationReferenceInput {
  role: "anchor" | ReferenceAssetLibraryRole;
  label: string;
  url: string;
  assetId?: string;
  instruction: string;
}

export const REFERENCE_ASSET_SLOT_LABELS: Record<ReferenceAssetLibraryRole, string> = {
  "character-1": "Character 1",
  "character-2": "Character 2",
  environment: "Environment / location",
  crowd: "Crowd / extras",
  custom: "Custom reference",
};

export const REFERENCE_ASSET_SLOT_DETAILS: Record<ReferenceAssetLibraryRole, string> = {
  "character-1": "Primary character sheet or hero likeness.",
  "character-2": "Secondary character sheet, duet partner, antagonist, or co-star.",
  environment: "Room, location, vehicle interior, set, or recurring visual world.",
  crowd: "Background-cast identity and wardrobe sheets. Keep multiple options in the project and select only the ones needed for a shot.",
  custom: "Prop, car, wardrobe, extra person, object, or user-defined reference.",
};

export const MAX_CROWD_REFERENCE_SELECTIONS = 3;

export function defaultReferenceKindForRole(role: ReferenceAssetLibraryRole): ReferenceAssetKind {
  if (role === "environment") return "environment";
  if (role === "crowd") return "crowd";
  if (role === "custom") return "custom";
  return "character";
}

export function createLocalReferenceAsset(params: {
  role: ReferenceAssetLibraryRole;
  file: File;
  previewUrl: string;
  displayName?: string;
  kind?: ReferenceAssetKind;
  createdAt?: string;
}): ReferenceAsset {
  const roleLabel = REFERENCE_ASSET_SLOT_LABELS[params.role];
  return {
    id: `${params.role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: params.role,
    kind: params.kind ?? defaultReferenceKindForRole(params.role),
    displayName: cleanName(params.displayName) || cleanName(stripExtension(params.file.name)) || roleLabel,
    fileName: params.file.name,
    previewUrl: params.previewUrl,
    promptHint: defaultPromptHint(params.role),
    storageProvider: "local",
    storageStatus: "uploading",
    storageError: null,
    createdAt: params.createdAt ?? new Date().toISOString(),
  };
}

export async function uploadReferenceAssetToRustFs(file: File, role: ReferenceAssetLibraryRole): Promise<Pick<ReferenceAsset, "storageProvider" | "storageBucket" | "storagePath" | "storageUrl" | "storageStatus" | "storageError">> {
  const payload = await uploadFileDirectlyToRustFs(file, `media-uploads/${buildReferenceAssetFolder(role)}`);

  const storageUrl = payload.publicUrl || payload.mediaUrl;
  const storagePath = payload.storagePath || payload.objectKey;
  if (!payload.bucket || !storageUrl || !storagePath) {
    throw new Error("RustFS reference upload returned an incomplete storage payload.");
  }

  return {
    storageProvider: "rustfs",
    storageBucket: payload.bucket,
    storagePath,
    storageUrl,
    storageStatus: "uploaded",
    storageError: null,
  };
}

export function buildGenerationReferenceInputs(params: {
  anchorUrl?: string;
  anchorLabel?: string;
  assets: ReferenceAsset[];
  selection: GenerationReferenceSelection;
}): { inputs: GenerationReferenceInput[]; imageUrls: string[]; instructions: string[]; errors: string[] } {
  const inputs: GenerationReferenceInput[] = [];
  const errors: string[] = [];
  if (params.anchorUrl) {
    inputs.push({
      role: "anchor",
      label: params.anchorLabel ?? "composition reference (from cut)",
      url: params.anchorUrl,
      instruction:
        "Use Reference 1 as a composition reference from the matched cut only: character placement and blocking, camera angle, screen direction, and where in the room the action happens. Do not use this low-resolution grab for identity, face, skin, wardrobe, texture, sharpness, or location materials — character and environment sheets are the quality authorities. Re-create the shot from sheets; do not upscale or continue the muddy frame.",
    });
  }

  const selected = [
    { role: "character-1" as const, id: params.selection.character1Id },
    { role: "character-2" as const, id: params.selection.character2Id },
    { role: "environment" as const, id: params.selection.environmentId },
    ...normalizeCrowdReferenceIds(params.selection.crowdIds).map((id) => ({ role: "crowd" as const, id })),
    { role: "custom" as const, id: params.selection.customId },
  ];

  for (const selectedRef of selected) {
    if (!selectedRef.id) continue;
    const asset = params.assets.find((candidate) => candidate.id === selectedRef.id);
    if (!asset) {
      errors.push(`${REFERENCE_ASSET_SLOT_LABELS[selectedRef.role]} reference is missing from the project library.`);
      continue;
    }
    if (asset.storageStatus !== "uploaded" || !asset.storageUrl) {
      errors.push(`${asset.displayName} is not uploaded to RustFS yet; generation cannot use a local-only reference.`);
      continue;
    }
    inputs.push({
      role: selectedRef.role,
      label: asset.displayName,
      url: asset.storageUrl,
      assetId: asset.id,
      instruction: buildReferenceInstruction(asset, inputs.length + 1),
    });
  }

  return {
    inputs,
    imageUrls: inputs.map((input) => input.url),
    instructions: inputs.map((input) => input.instruction),
    errors,
  };
}

export function buildReferenceInstruction(asset: ReferenceAsset, referenceNumber: number) {
  if (asset.role === "character-1" || asset.role === "character-2") {
    return `Use Reference ${referenceNumber} as character "${asset.displayName}"; treat the attached sheet as authoritative for exact visual identity and continuity. Do not invent or restate visual details in text. ${asset.promptHint}`.trim();
  }
  if (asset.role === "environment") {
    return `Use Reference ${referenceNumber} as the environment/location "${asset.displayName}"; preserve the spatial layout, lighting direction, materials, palette, and atmosphere. ${asset.promptHint}`.trim();
  }
  if (asset.role === "crowd") {
    return `Use Reference ${referenceNumber} as the crowd/extras sheet "${asset.displayName}"; it controls background-dancer identity variety and crowd wardrobe only. Do not transfer a background extra's identity or wardrobe to a named lead, and do not copy a named lead's wardrobe onto the crowd. Ignore location, composition, camera, lighting, and action from this sheet. ${asset.promptHint}`.trim();
  }
  return `Use Reference ${referenceNumber} as the custom ${asset.kind} reference "${asset.displayName}"; keep it visually consistent when it appears. ${asset.promptHint}`.trim();
}

export function defaultPromptHint(role: ReferenceAssetLibraryRole) {
  switch (role) {
    case "character-1":
    case "character-2":
      return "Identity and wardrobe lock. Use this exact display name in every caption and prompt when this person is visible.";
    case "environment":
      return "Treat this as the continuity anchor for the scene world.";
    case "crowd":
      return "Background extras only. Preserve cast variety and wardrobe range without borrowing a named lead's identity or wardrobe.";
    case "custom":
      return "Use only if the selected shot needs this object or extra visual reference.";
  }
}

export function normalizeCrowdReferenceIds(ids: string[] | undefined) {
  return [...new Set((ids ?? []).filter(Boolean))].slice(0, MAX_CROWD_REFERENCE_SELECTIONS);
}

export function getOrderedSelectedReferenceIds(selection: GenerationReferenceSelection) {
  return [
    selection.character1Id,
    selection.character2Id,
    selection.environmentId,
    ...normalizeCrowdReferenceIds(selection.crowdIds),
    selection.customId,
  ].filter((id, index, ids): id is string => Boolean(id) && ids.indexOf(id) === index);
}

export function sanitizeReferenceAssetForStorage(asset: ReferenceAsset): ReferenceAsset {
  return {
    ...asset,
    previewUrl: stripRuntimeUrl(asset.previewUrl) || asset.storageUrl || "",
  };
}

export function hydrateReferenceAssets(assets: ReferenceAsset[] = []): ReferenceAsset[] {
  return assets.map((asset) => ({
    ...asset,
    previewUrl: asset.previewUrl || asset.storageUrl || "",
    storageStatus: asset.storageStatus ?? (asset.storageUrl ? "uploaded" : "failed"),
  }));
}

function buildReferenceAssetFolder(role: ReferenceAssetLibraryRole) {
  const now = new Date();
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  return `reference-assets/${role}/${year}/${month}_${day}`;
}

function cleanName(value?: string) {
  return value?.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim() ?? "";
}

function stripExtension(value: string) {
  return value.replace(/\.[^.]+$/, "");
}

function stripRuntimeUrl(value: string | undefined) {
  if (!value) return "";
  return value.startsWith("data:") || value.startsWith("blob:") ? "" : value;
}
