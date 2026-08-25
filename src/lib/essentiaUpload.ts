export const ESSENTIA_AUDIO_CHUNK_SIZE_BYTES = 3 * 1024 * 1024;
export const ESSENTIA_MAX_AUDIO_SIZE_BYTES = 256 * 1024 * 1024;

export type EssentiaAudioChunkReference = {
  bucket: string;
  objectKey: string;
};

const UUID_V4_SOURCE = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

export function buildAudioChunkRanges(size: number, chunkSize = ESSENTIA_AUDIO_CHUNK_SIZE_BYTES) {
  if (!Number.isSafeInteger(size) || size < 0 || !Number.isSafeInteger(chunkSize) || chunkSize <= 0) {
    throw new Error("Audio size and chunk size must be valid byte counts.");
  }

  const ranges: Array<{ index: number; start: number; end: number }> = [];
  for (let start = 0, index = 0; start < size; start += chunkSize, index += 1) {
    ranges.push({ index, start, end: Math.min(size, start + chunkSize) });
  }
  return ranges;
}

export function validateEssentiaAudioChunks(args: {
  value: unknown;
  size: number;
  bucket: string;
  uploadPrefix: string;
  ownerId: string;
}): EssentiaAudioChunkReference[] | null {
  if (
    !Number.isSafeInteger(args.size)
    || args.size <= ESSENTIA_AUDIO_CHUNK_SIZE_BYTES
    || args.size > ESSENTIA_MAX_AUDIO_SIZE_BYTES
    || !Array.isArray(args.value)
  ) {
    return null;
  }

  const expectedCount = Math.ceil(args.size / ESSENTIA_AUDIO_CHUNK_SIZE_BYTES);
  if (args.value.length !== expectedCount) return null;

  const prefix = normalizePath(args.uploadPrefix);
  const ownerSegment = essentiaUploadOwnerSegment(args.ownerId);
  const pattern = new RegExp(
    `^${escapeRegExp(prefix)}/source-audio/chunks/${escapeRegExp(ownerSegment)}/(${UUID_V4_SOURCE})/\\d+-(\\d{5})\\.part$`,
    "i",
  );
  let uploadId: string | null = null;
  const chunks: EssentiaAudioChunkReference[] = [];

  for (let index = 0; index < args.value.length; index += 1) {
    const entry = args.value[index];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const chunk = entry as Record<string, unknown>;
    if (chunk.bucket !== args.bucket || typeof chunk.objectKey !== "string") return null;

    const objectKey = normalizePath(chunk.objectKey);
    const match = pattern.exec(objectKey);
    if (!match || Number(match[2]) !== index) return null;
    if (uploadId && match[1] !== uploadId) return null;
    uploadId = match[1] ?? null;
    chunks.push({ bucket: args.bucket, objectKey });
  }

  return chunks;
}

export function scopeEssentiaChunkUploadFolder(folder: unknown, ownerId: string) {
  if (typeof folder !== "string") return null;
  const match = new RegExp(`^media-uploads/source-audio/chunks/(${UUID_V4_SOURCE})$`, "i").exec(normalizePath(folder));
  if (!match?.[1]) return null;
  return `media-uploads/source-audio/chunks/${essentiaUploadOwnerSegment(ownerId)}/${match[1]}`;
}

export function scopeMediaUploadFolder(folder: string | undefined | null, ownerId: string) {
  const normalized = normalizePath(folder ?? "");
  if (!normalized.startsWith("media-uploads/")) return normalized;
  const ownerSegment = essentiaUploadOwnerSegment(ownerId);
  if (mediaUploadBelongsToOwner(normalized, ownerId)) return normalized;
  const rest = normalized.slice("media-uploads/".length);
  // Audio-chunk folders carry the owner inside the chunks tree, matching the
  // worker-facing chunk manifest contract.
  if (/^source-audio\/chunks\//i.test(rest)) {
    return normalizePath(`media-uploads/source-audio/chunks/${ownerSegment}/${rest.slice("source-audio/chunks/".length)}`);
  }
  return normalizePath(`media-uploads/${ownerSegment}/${rest}`);
}

export function mediaUploadBelongsToOwner(objectKey: string, ownerId: string) {
  const normalized = normalizePath(objectKey);
  if (!normalized.startsWith("media-uploads/")) return false;
  const ownerSegment = essentiaUploadOwnerSegment(ownerId);
  const parts = normalized.split("/");
  return parts[1] === ownerSegment
    || (parts[1] === "source-audio" && parts[2] === "chunks" && parts[3] === ownerSegment);
}

export function essentiaUploadOwnerSegment(ownerId: string) {
  return ownerId.trim().replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 128) || "unknown-user";
}

function normalizePath(value: string) {
  return value.split("/").map((part) => part.trim()).filter(Boolean).join("/");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
