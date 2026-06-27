import type { BeatJoinAnalysis } from "./types";

export type UploadedAudioStorage = Pick<
  BeatJoinAnalysis,
  "storageProvider" | "storageBucket" | "storagePath" | "storageUrl" | "storageStatus" | "storageError"
>;

type StorageUploadResponse = {
  storageProvider?: string;
  bucket?: string;
  publicUrl?: string;
  mediaUrl?: string;
  storagePath?: string;
  objectKey?: string;
  mime?: string;
  error?: string;
};

export async function uploadAudioFileToRustFs(file: File): Promise<UploadedAudioStorage> {
  const formData = new FormData();
  formData.append("file", file, file.name);
  formData.append("folder", "media-uploads/source-audio");

  const response = await fetch("/api/storage/upload", {
    method: "POST",
    body: formData,
  });
  const payload = await readJson(response);

  if (!response.ok) {
    throw new Error(payload.error || `${response.status} ${response.statusText}`);
  }

  const storageUrl = payload.publicUrl || payload.mediaUrl;
  const storagePath = payload.storagePath || payload.objectKey;
  if (!storageUrl || !storagePath) {
    throw new Error("RustFS upload returned an incomplete audio storage payload.");
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

async function readJson(response: Response): Promise<StorageUploadResponse> {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as StorageUploadResponse;
  } catch {
    return { error: text.slice(0, 300) };
  }
}
