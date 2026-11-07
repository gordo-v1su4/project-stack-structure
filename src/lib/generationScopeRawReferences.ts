import { createHash } from "node:crypto";
import { getMediaGatewayConfig } from "./mediaGateway";
import { mediaUploadBelongsToOwner } from "./essentiaUpload";
import type { H3ReferenceSnapshot } from "@/components/studio/h3Generation";
import type { ScopeRawReference, SourceReferenceManifest } from "@/components/studio/generationScope";

const MAX_REFERENCES = 32, MAX_TOTAL_BYTES = 128 * 1024 * 1024;
export type ExpectedScopeRawReference = Omit<ScopeRawReference, "byteLength"> & { byteLength?: number };
function snapshots(ownerId: string, references: SourceReferenceManifest): H3ReferenceSnapshot[] {
  const bucket = getMediaGatewayConfig()?.bucket;
  if (!bucket || references.length > MAX_REFERENCES || new Set(references.map(reference => reference.id)).size !== references.length) throw new Error("The source-reference inventory exceeds its supported bound.");
  return references.map(reference => {
    if (reference.storageStatus !== "uploaded" || reference.storageBucket !== bucket || !reference.storagePath
      || !mediaUploadBelongsToOwner(reference.storagePath, ownerId) || /[\\\x00-\x1f]/.test(reference.storagePath)
      || reference.storagePath.split("/").some(part => !part || part === "." || part === "..")) throw new Error("The source-reference inventory requires durable owned images.");
    const role: H3ReferenceSnapshot["role"] = reference.kind === "character" || reference.role.startsWith("character") ? "identity"
      : reference.kind === "environment" || reference.role === "environment" ? "environment"
      : reference.kind === "crowd" || reference.role === "crowd" ? "crowd"
      : reference.kind === "prop" || reference.kind === "vehicle" || reference.kind === "wardrobe" ? reference.kind : "composition";
    return { assetId: reference.id, canonicalName: reference.displayName, role, bucket, objectKey: reference.storagePath,
      version: createHash("sha256").update(JSON.stringify([reference.id, bucket, reference.storagePath, reference.createdAt, role, reference.displayName])).digest("hex") };
  });
}

/** At most three conditional reads are in flight; images and aggregate bytes are bounded independently. */
async function readRaw(snapshots: H3ReferenceSnapshot[], expected?: ExpectedScopeRawReference[]): Promise<ScopeRawReference[]> {
  const { downloadH3ReferenceImage } = await import("./h3JobStore");
  let totalBytes = 0;
  const output: ScopeRawReference[] = [];
  for (let offset = 0; offset < snapshots.length; offset += 3) {
    const batch = await Promise.all(snapshots.slice(offset, offset + 3).map(async reference => {
      const image = await downloadH3ReferenceImage(reference);
      const bytes = new Uint8Array(image.bytes);
      totalBytes += bytes.length;
      if (totalBytes > MAX_TOTAL_BYTES || !/^image\/(?:png|jpeg|webp)$/.test(image.mime) || image.etag !== reference.etag) throw new Error("The conditional source-reference response differs or exceeds its bound.");
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const prior = expected?.find(value => value.assetId === reference.assetId);
      if (expected && (!prior || prior.sha256 !== sha256 || (prior.byteLength !== undefined && prior.byteLength !== bytes.length))) throw new Error("The canonical source-reference pixels changed.");
      return { assetId: reference.assetId, bucket: reference.bucket, objectKey: reference.objectKey, etag: reference.etag!, sha256, byteLength: bytes.length };
    }));
    output.push(...batch);
  }
  return output;
}

/** Initial pinning is only for a new baseline or newly appended sheets; it never replaces an expected old ETag. */
export async function pinGenerationScopeRawReferences(ownerId: string, references: SourceReferenceManifest): Promise<ScopeRawReference[]> {
  const { pinH3ReferenceSnapshots } = await import("./h3JobStore");
  return readRaw(await pinH3ReferenceSnapshots(snapshots(ownerId, references)));
}
export async function verifyGenerationScopeRawReferences(ownerId: string, references: SourceReferenceManifest, expected: ExpectedScopeRawReference[]): Promise<ScopeRawReference[]> {
  const input = snapshots(ownerId, references);
  if (expected.length !== input.length || new Set(expected.map(reference => reference.assetId)).size !== input.length) throw new Error("The canonical raw-reference manifest differs.");
  const pinned = input.map(reference => {
    const prior = expected.find(value => value.assetId === reference.assetId);
    if (!prior?.etag || !/^[a-f0-9]{64}$/.test(prior.sha256) || prior.bucket !== reference.bucket || prior.objectKey !== reference.objectKey) throw new Error("The canonical raw-reference binding differs.");
    return { ...reference, etag: prior.etag };
  });
  return readRaw(pinned, expected);
}
