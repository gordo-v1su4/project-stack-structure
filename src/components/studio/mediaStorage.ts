import type { UploadedVideoSource } from "./types";

export type UploadedVideoStorage = Pick<
  UploadedVideoSource,
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

export async function uploadVideoFileToRustFs(file: File): Promise<UploadedVideoStorage> {
  const formData = new FormData();
  formData.append("file", file, file.name);

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
    throw new Error("RustFS upload returned an incomplete storage payload.");
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

export async function uploadSceneCaptionManifestToRustFs(source: UploadedVideoSource): Promise<Pick<UploadedVideoSource, "captionManifestPath" | "captionManifestUrl">> {
  if (!source.storageBucket || !source.storagePath) {
    throw new Error("Scene caption manifest upload requires a RustFS-backed source.");
  }

  const captions = (source.scenes ?? [])
    .filter((scene) => scene.caption || scene.captionMeta)
    .map((scene) => ({
      id: scene.id,
      sourceClipId: scene.sourceClipId,
      label: scene.label,
      start: scene.start,
      end: scene.end,
      duration: scene.duration,
      text: scene.caption ?? "",
      sceneData: scene.captionMeta,
      captionSource: scene.captionSource ?? "lfm-webgpu",
      thumbnailUrl: scene.thumbnailUrl,
    }));

  const manifest = {
    schema: "stack-structure.scene-captions.v1",
    generatedAt: new Date().toISOString(),
    source: {
      name: source.name,
      duration: source.duration,
      storageBucket: source.storageBucket,
      storagePath: source.storagePath,
      storageUrl: source.storageUrl,
    },
    captions,
  };

  const file = new File(
    [JSON.stringify(manifest, null, 2)],
    "captions.json",
    { type: "application/json" },
  );
  const folder = `${source.storagePath}.analysis/client-captions`;
  const formData = new FormData();
  formData.append("file", file, file.name);
  formData.append("folder", folder);

  const response = await fetch("/api/storage/upload", {
    method: "POST",
    body: formData,
  });
  const payload = await readJson(response);

  if (!response.ok) {
    throw new Error(payload.error || `${response.status} ${response.statusText}`);
  }

  const captionManifestUrl = payload.publicUrl || payload.mediaUrl;
  const captionManifestPath = payload.storagePath || payload.objectKey;
  if (!captionManifestUrl || !captionManifestPath) {
    throw new Error("RustFS caption manifest upload returned an incomplete storage payload.");
  }

  return { captionManifestPath, captionManifestUrl };
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
