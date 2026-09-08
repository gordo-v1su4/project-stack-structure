import { getMediaGatewayConfig, normalizeMediaPath } from "./mediaGateway";

export type DurableExportInput = { bucket: string; objectKey: string; fileName: string; mimeType: string; chunks?: Array<{ bucket: string; objectKey: string }> };

export function resolveDurableInput(entry: unknown, mimeType: string): DurableExportInput {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Durable reference must be an object.");
  const record = entry as Record<string, unknown>;
  if (typeof record.bucket !== "string" || typeof record.objectKey !== "string") {
    throw new Error("Durable reference requires string bucket and objectKey.");
  }
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

