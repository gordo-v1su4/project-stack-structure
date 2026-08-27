import type { MediaGatewayUploadResult } from "@/lib/mediaGateway";
import { uploadFileInChunks } from "./chunkedUploadClient";

type StorageUploadResponse = Partial<MediaGatewayUploadResult> & {
  error?: string;
};

export async function uploadGeneratedClipToRustFs(args: {
  file: File;
  folder: string;
  onPartUploaded?: (uploaded: number, total: number) => void;
}): Promise<MediaGatewayUploadResult> {
  const fileName = args.file.name;
  const contentType = args.file.type || "video/mp4";
  const chunked = await uploadFileInChunks(args.file, args.folder, {
    onPartUploaded: args.onPartUploaded,
  });

  if (chunked) {
    return requestStoredUpload("/api/storage/assemble", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        size: chunked.size,
        contentType: chunked.contentType || contentType,
        fileName,
        folder: args.folder,
        chunks: chunked.chunks,
      }),
    });
  }

  const formData = new FormData();
  formData.append("file", args.file, args.file.name);
  formData.append("folder", args.folder);
  return requestStoredUpload("/api/storage/upload", {
    method: "POST",
    body: formData,
  });
}

async function requestStoredUpload(url: string, init: RequestInit): Promise<MediaGatewayUploadResult> {
  const response = await fetch(url, init);
  const text = await response.text();
  let payload: StorageUploadResponse = {};
  if (text.trim()) {
    try {
      payload = JSON.parse(text) as StorageUploadResponse;
    } catch {
      payload = { error: text.slice(0, 300) };
    }
  }

  const publicUrl = payload.publicUrl ?? payload.mediaUrl;
  const objectKey = payload.objectKey ?? payload.storagePath;
  if (!response.ok || payload.error || !payload.bucket || !publicUrl || !objectKey || !payload.mime) {
    throw new Error(payload.error ?? `Generated clip upload failed with HTTP ${response.status}.`);
  }

  return {
    bucket: payload.bucket,
    publicUrl,
    mediaUrl: payload.mediaUrl,
    storagePath: objectKey,
    objectKey,
    mime: payload.mime,
  };
}
