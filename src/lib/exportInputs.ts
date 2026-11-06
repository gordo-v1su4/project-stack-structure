import { getMediaGatewayConfig, normalizeMediaPath } from "./mediaGateway";
import { mediaUploadBelongsToOwner } from "./essentiaUpload";

export type DurableExportInput = { bucket: string; objectKey: string; fileName: string; mimeType: string; chunks?: Array<{ bucket: string; objectKey: string }> };

function assertExportKey(value: string) {
  const decoded = /%(?:2f|2e|5c)/i.test(value) ? decodeURIComponent(value) : value;
  if (/[\\\x00-\x1f]/.test(decoded) || decoded.split("/").some(part => part === "." || part === "..")) throw new Error("Referenced objects must be within the application's media storage.");
}

export function resolveDurableInput(entry: unknown, mimeType: string): DurableExportInput {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Durable reference must be an object.");
  const record = entry as Record<string, unknown>;
  if (typeof record.bucket !== "string" || typeof record.objectKey !== "string") {
    throw new Error("Durable reference requires string bucket and objectKey.");
  }
  assertExportKey(record.objectKey);
  const config = getMediaGatewayConfig();
  if (!config) throw new Error("RustFS media gateway env is not configured; durable export references cannot be resolved.");
  const objectKey = normalizeMediaPath(/%2f/i.test(record.objectKey) ? decodeURIComponent(record.objectKey) : record.objectKey);
  if (!objectKey.startsWith("media-uploads/") || objectKey.length > 512) throw new Error("Referenced objects must be within the application's media storage.");
  if (record.bucket.trim() !== config.bucket) throw new Error(`Durable reference bucket must be ${config.bucket}.`);

  let chunks: Array<{ bucket: string; objectKey: string }> | undefined;
  if (record.chunks !== undefined && record.chunks !== null) {
    if (!Array.isArray(record.chunks)) throw new Error("Chunk references must be an array.");
    chunks = record.chunks.map((part) => {
      if (!part || typeof part !== "object" || Array.isArray(part)) throw new Error("Each chunk reference must be an object.");
      const partRecord = part as Record<string, unknown>;
      if (typeof partRecord.bucket !== "string" || typeof partRecord.objectKey !== "string") {
        throw new Error("Chunk references require string bucket and objectKey.");
      }
      assertExportKey(partRecord.objectKey);
      if (partRecord.bucket.trim() !== config.bucket) throw new Error(`Chunk reference bucket must be ${config.bucket}.`);
      const partKey = normalizeMediaPath(partRecord.objectKey);
      if (!partKey.startsWith("media-uploads/") || partKey.length > 512) throw new Error("Referenced objects must be within the application's media storage.");
      return { bucket: partRecord.bucket.trim(), objectKey: partKey };
    });
  }

  return {
    bucket: record.bucket.trim(),
    objectKey,
    fileName: objectKey.split("/").pop() || "input.bin",
    mimeType,
    ...(chunks?.length ? { chunks } : {}),
  };
}

export function resolveDurableInputs(entries: unknown, mimeType: string): DurableExportInput[] {
  if (!Array.isArray(entries) || !entries.length) throw new Error("Durable references must be a non-empty array.");
  return entries.map((entry) => resolveDurableInput(entry, mimeType));
}

/** Ownership comes from the authenticated session, never a client prefix or owner field. */
export function assertExportInputOwnership(inputs: DurableExportInput[], ownerId: string) {
  for (const input of inputs) for (const objectKey of [input.objectKey, ...(input.chunks ?? []).map(chunk => chunk.objectKey)]) {
    if (!mediaUploadBelongsToOwner(objectKey, ownerId)) throw new Error("Referenced media is not registered to this account. Re-upload legacy media through the authenticated upload path.");
  }
}

