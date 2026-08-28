import { buildAudioChunkRanges, ESSENTIA_AUDIO_CHUNK_SIZE_BYTES } from "./essentiaUpload";

/**
 * Vercel caps serverless request bodies at ~4.5MB, so any media larger than
 * LARGE_UPLOAD_SINGLE_SHOT_MAX must travel as gateway-stored chunks. Workers
 * assemble the parts before the bytes reach a provider.
 */
export const LARGE_UPLOAD_CHUNK_BYTES = ESSENTIA_AUDIO_CHUNK_SIZE_BYTES;
export const LARGE_UPLOAD_SINGLE_SHOT_MAX = 4 * 1024 * 1024;

export type UploadChunkReference = {
  bucket: string;
  objectKey: string;
};

export type ChunkedUploadManifest = {
  size: number;
  contentType?: string;
  chunks: UploadChunkReference[];
};

const UUID_V4_SOURCE = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

export function buildUploadChunkRanges(size: number, chunkBytes = LARGE_UPLOAD_CHUNK_BYTES) {
  return buildAudioChunkRanges(size, chunkBytes);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Validates an ordered chunk manifest produced by uploadFileInChunks. Parts
 * must live under `expectedPrefix/<uuid>/NNNNN.part`, reference the configured
 * bucket, and be contiguous from index 0 with a count matching the declared
 * size. Returns the typed references, or null when anything is off.
 */
export function validateOrderedChunkManifest(args: {
  value: unknown;
  size: number;
  bucket: string;
  expectedPrefix: string;
}): UploadChunkReference[] | null {
  if (
    !Number.isSafeInteger(args.size)
    || args.size <= 0
    || !Array.isArray(args.value)
  ) {
    return null;
  }

  const expectedCount = Math.ceil(args.size / LARGE_UPLOAD_CHUNK_BYTES);
  if (args.value.length !== expectedCount) return null;

  const prefix = args.expectedPrefix.split("/").map((part) => part.trim()).filter(Boolean).join("/");
  if (!prefix) return null;
  // The gateway may prefix stored filenames with a timestamp
  // (e.g. 1787524663125-00000.part), so only the trailing index is authoritative.
  const pattern = new RegExp(`^${escapeRegExp(prefix)}/(${UUID_V4_SOURCE})/(?:[0-9]+-)?(\\d{5})\\.part$`, "i");

  let uploadId: string | null = null;
  const chunks: UploadChunkReference[] = [];

  for (let index = 0; index < args.value.length; index += 1) {
    const entry = args.value[index];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const chunk = entry as Record<string, unknown>;
    if (chunk.bucket !== args.bucket || typeof chunk.objectKey !== "string") return null;

    const objectKey = chunk.objectKey.split("/").map((part) => part.trim()).filter(Boolean).join("/");
    const match = pattern.exec(objectKey);
    if (!match) return null;
    const uploadIdForPart = match[1];
    const partIndex = Number(match[2]);
    if (!uploadIdForPart || partIndex !== index) return null;
    if (uploadId && uploadIdForPart !== uploadId) return null;
    uploadId = uploadIdForPart;
    chunks.push({ bucket: args.bucket, objectKey });
  }

  return chunks;
}

export function normalizeChunkedContentType(value: unknown, fallback = "application/octet-stream") {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= 127
    ? value.trim()
    : fallback;
}

const MEDIA_CONTENT_TYPES_BY_EXTENSION: Record<string, string> = {
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".avi": "video/x-msvideo",
  ".mkv": "video/x-matroska",
  ".mov": "video/quicktime",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

/**
 * Chunk assembly is deliberately limited to playable audio/video. Browsers can
 * omit a File MIME type, so a short allowlist of known media extensions is the
 * only fallback; arbitrary client-supplied content types are never accepted.
 */
export function resolveChunkedMediaContentType(value: unknown, fileName: unknown) {
  const requested = normalizeChunkedContentType(value);
  if (requested.startsWith("audio/") || requested.startsWith("video/")) return requested;

  const normalizedName = typeof fileName === "string" ? fileName.trim().toLowerCase() : "";
  const extension = /\.[a-z0-9]+$/.exec(normalizedName)?.[0] ?? "";
  return MEDIA_CONTENT_TYPES_BY_EXTENSION[extension] ?? null;
}
