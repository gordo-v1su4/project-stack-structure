import type { MediaGatewayUploadResult } from "@/lib/mediaGateway";

export type DirectUploadResult = MediaGatewayUploadResult & { uploadToken: string };

let activeUploads = 0;
const waitingUploads: Array<() => void> = [];

async function uploadRequest(payload: Record<string, unknown>) {
  const response = await fetch("/api/storage/direct", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(65_000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw new Error(result?.error || `Storage request failed (${response.status}).`);
  return result;
}

/** Only metadata goes to Vercel. Each file part is PUT directly to RustFS. */
export async function uploadFileDirectlyToRustFs(file: File, folder: string, onPartUploaded?: (uploaded: number, total: number) => void): Promise<DirectUploadResult> {
  if (activeUploads >= 3) await new Promise<void>(resolve => waitingUploads.push(resolve));
  else activeUploads += 1;
  try { return await uploadDirect(file, folder, onPartUploaded); }
  finally {
    const next = waitingUploads.shift();
    if (next) next();
    else activeUploads -= 1;
  }
}

async function uploadDirect(file: File, folder: string, onPartUploaded?: (uploaded: number, total: number) => void): Promise<DirectUploadResult> {
  const upload: { token: string; partSize: number; parts: Array<{ number: number; url: string }> } = await uploadRequest({
    action: "start", fileName: file.name, size: file.size,
    contentType: file.type || "application/octet-stream", folder,
  });
  try {
    for (const part of upload.parts) {
      const start = (part.number - 1) * upload.partSize;
      const bytes = file.slice(start, Math.min(file.size, start + upload.partSize));
      let succeeded = false;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const response = await fetch(part.url, { method: "PUT", body: bytes, credentials: "omit", signal: AbortSignal.timeout(180_000) });
          if (!response.ok) throw new Error(`Storage upload failed (${response.status}).`);
          succeeded = true;
          break;
        } catch (error) {
          if (attempt === 2) throw error;
          await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 500));
        }
      }
      if (!succeeded) throw new Error("Storage upload failed. Please retry.");
      onPartUploaded?.(part.number, upload.parts.length);
    }
    const result = await uploadRequest({ action: "complete", token: upload.token });
    if (!result.bucket || !result.objectKey || !result.publicUrl || !result.mime || !result.uploadToken) throw new Error("Storage returned an incomplete upload.");
    return result;
  } catch (error) {
    await uploadRequest({ action: "abort", token: upload.token }).catch(() => {});
    throw error;
  }
}
