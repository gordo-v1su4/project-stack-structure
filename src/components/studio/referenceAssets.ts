export type ReferenceAssetRole = "character-1" | "character-2" | "environment" | "custom";
export type ReferenceAssetKind = "character" | "environment" | "prop" | "vehicle" | "wardrobe" | "custom";
export type ReferenceAssetStatus = "local" | "uploading" | "uploaded" | "failed";

export interface ReferenceAsset {
  id: string;
  role: ReferenceAssetRole;
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
  customId?: string;
}

export interface GenerationReferenceInput {
  role: "anchor" | ReferenceAssetRole;
  label: string;
  url: string;
  assetId?: string;
  instruction: string;
}

export const REFERENCE_ASSET_SLOT_LABELS: Record<ReferenceAssetRole, string> = {
  "character-1": "Character 1",
  "character-2": "Character 2",
  environment: "Environment / location",
  custom: "Custom reference",
};

export const REFERENCE_ASSET_SLOT_DETAILS: Record<ReferenceAssetRole, string> = {
  "character-1": "Primary character sheet or hero likeness.",
  "character-2": "Secondary character sheet, duet partner, antagonist, or co-star.",
  environment: "Room, location, vehicle interior, set, or recurring visual world.",
  custom: "Prop, car, wardrobe, extra person, object, or user-defined reference.",
};

export function defaultReferenceKindForRole(role: ReferenceAssetRole): ReferenceAssetKind {
  if (role === "environment") return "environment";
  if (role === "custom") return "custom";
  return "character";
}

export function createLocalReferenceAsset(params: {
  role: ReferenceAssetRole;
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

export async function uploadReferenceAssetToRustFs(file: File, role: ReferenceAssetRole): Promise<Pick<ReferenceAsset, "storageProvider" | "storageBucket" | "storagePath" | "storageUrl" | "storageStatus" | "storageError">> {
  const formData = new FormData();
  formData.append("file", file, file.name);
  formData.append("folder", buildReferenceAssetFolder(role));

  const response = await fetch("/api/storage/upload", {
    method: "POST",
    body: formData,
  });
  const payload = await readUploadJson(response);

  if (!response.ok) {
    throw new Error(payload.error || `${response.status} ${response.statusText}`);
  }

  const storageUrl = payload.publicUrl || payload.mediaUrl;
  const storagePath = payload.storagePath || payload.objectKey;
  if (!storageUrl || !storagePath) {
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
      label: params.anchorLabel ?? "source frame / shot anchor",
      url: params.anchorUrl,
      instruction: "Use Reference 1 as the source frame / shot anchor for composition, continuity, and camera intent.",
    });
  }

  const selected = [
    { role: "character-1" as const, id: params.selection.character1Id },
    { role: "character-2" as const, id: params.selection.character2Id },
    { role: "environment" as const, id: params.selection.environmentId },
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
  return `Use Reference ${referenceNumber} as the custom ${asset.kind} reference "${asset.displayName}"; keep it visually consistent when it appears. ${asset.promptHint}`.trim();
}

export function defaultPromptHint(role: ReferenceAssetRole) {
  switch (role) {
    case "character-1":
    case "character-2":
      return "Do not replace this person with a generic subject.";
    case "environment":
      return "Treat this as the continuity anchor for the scene world.";
    case "custom":
      return "Use only if the selected shot needs this object or extra visual reference.";
  }
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

function buildReferenceAssetFolder(role: ReferenceAssetRole) {
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

type UploadPayload = {
  bucket?: string;
  publicUrl?: string;
  mediaUrl?: string;
  storagePath?: string;
  objectKey?: string;
  error?: string;
};

async function readUploadJson(response: Response): Promise<UploadPayload> {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as UploadPayload;
  } catch {
    return { error: text.slice(0, 300) };
  }
}
