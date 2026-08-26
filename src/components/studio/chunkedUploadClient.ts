import {
  buildUploadChunkRanges,
  type ChunkedUploadManifest,
} from "@/lib/chunkedMediaUpload";

export const MAX_CONCURRENT_CHUNK_UPLOADS = 4;

let activeChunkUploads = 0;
const chunkUploadWaiters: Array<() => void> = [];

async function withChunkUploadSlot<T>(upload: () => Promise<T>): Promise<T> {
  if (activeChunkUploads >= MAX_CONCURRENT_CHUNK_UPLOADS) {
    await new Promise<void>((resolve) => chunkUploadWaiters.push(resolve));
  }

  activeChunkUploads += 1;
  try {
    return await upload();
  } finally {
    activeChunkUploads -= 1;
    chunkUploadWaiters.shift()?.();
  }
}

function readStringField(value: unknown, key: string) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? typeof (value as Record<string, unknown>)[key] === "string"
      ? (value as Record<string, unknown>)[key] as string
      : undefined
    : undefined;
}

/**
 * Uploads a file as ordered gateway-stored chunks (each under the Vercel
 * request-body cap) and returns the manifest downstream workers reassemble.
 * Returns null for files small enough to travel in one request.
 */
export async function uploadFileInChunks(
  file: File,
  folderBase: string,
  options: { endpoint?: string; onPartUploaded?: (uploaded: number, total: number) => void } = {},
): Promise<ChunkedUploadManifest | null> {
  if (file.size <= 4 * 1024 * 1024) return null;

  const endpoint = options.endpoint ?? "/api/storage/upload";
  const folder = `${folderBase.replace(/\/+$/, "")}/${crypto.randomUUID()}`;
  const chunks: Array<{ bucket: string; objectKey: string }> = [];
  const ranges = buildUploadChunkRanges(file.size);

  for (const range of ranges) {
    const partName = `${String(range.index).padStart(5, "0")}.part`;
    const part = new File([file.slice(range.start, range.end)], partName, {
      type: "application/octet-stream",
    });
    const formData = new FormData();
    formData.set("file", part);
    formData.set("folder", folder);
    const { response, payload } = await withChunkUploadSlot(async () => {
      const response = await fetch(endpoint, { method: "POST", body: formData });
      const payload: unknown = await response.json().catch(() => null);
      return { response, payload };
    });
    const bucket = readStringField(payload, "bucket");
    const objectKey = readStringField(payload, "objectKey") ?? readStringField(payload, "storagePath");
    if (!response.ok || !bucket || !objectKey) {
      const message = readStringField(payload, "error");
      throw new Error(message ?? `Chunk ${range.index + 1}/${ranges.length} failed to upload (${response.status}).`);
    }
    chunks.push({ bucket, objectKey });
    options.onPartUploaded?.(range.index + 1, ranges.length);
  }

  return { size: file.size, contentType: file.type || undefined, chunks };
}
