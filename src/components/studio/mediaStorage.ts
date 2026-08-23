import { uploadFileInChunks } from "./chunkedUploadClient";
import type { UploadedVideoSource } from "./types";

export type UploadedVideoStorage = Pick<
  UploadedVideoSource,
  "storageProvider" | "storageBucket" | "storagePath" | "storageUrl" | "storageStatus" | "storageError"
> & {
  /** Set when the file traveled as ordered gateway chunks (Vercel body cap). */
  uploadChunks?: { size: number; chunks: Array<{ bucket: string; objectKey: string }> } | null;
};

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
  const chunked = await uploadFileInChunks(file, "media-uploads/video-source");
  if (chunked) {
    return {
      storageProvider: "rustfs",
      storageBucket: chunked.chunks[0]?.bucket ?? "",
      storagePath: chunked.chunks[0]?.objectKey ?? "",
      storageUrl: "",
      storageStatus: "uploaded",
      storageError: null,
      uploadChunks: { size: chunked.size, chunks: chunked.chunks },
    };
  }

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
      captionMode: scene.captionMode ?? "fast",
      captionModel: scene.captionModel,
      thumbnailUrl: scene.thumbnailUrl,
      firstFrameUrl: scene.firstFrameUrl,
      middleFrameUrl: scene.middleFrameUrl,
      lastFrameUrl: scene.lastFrameUrl,
      storyboardUrl: scene.storyboardUrl,
      sampleTimes: scene.sampleTimes,
      captionSampleStrategy: scene.captionSampleStrategy,
      visualAnalysis: scene.visualAnalysis,
      motionDescriptor: scene.motionDescriptor ?? scene.visualAnalysis?.motion,
      contentHash: scene.contentHash ?? scene.visualAnalysis?.contentHash,
      keyframeTimestamps: scene.keyframeTimestamps ?? scene.visualAnalysis?.keyframeTimestamps,
      splitKind: scene.splitKind,
      parentSceneId: scene.parentSceneId,
    }));
  const captionProvider = pickCaptionProvider(captions.map((caption) => caption.captionSource));

  const manifest = {
    schema: "stack-structure.scene-captions.v1",
    generatedAt: new Date().toISOString(),
    captionProvider,
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
  const folder = `${source.storagePath}.analysis/${captionManifestFolder(captionProvider)}`;
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

function pickCaptionProvider(sources: Array<string | undefined>) {
  if (sources.some((source) => source === "qwen3-vl-server")) return "qwen3-vl-server";
  if (sources.some((source) => source === "lfm-server")) return "lfm-server";
  if (sources.some((source) => source === "lfm-webgpu")) return "lfm-webgpu";
  if (sources.some((source) => source === "imported")) return "imported";
  return "unknown";
}

function captionManifestFolder(provider: string) {
  switch (provider) {
    case "qwen3-vl-server":
      return "smart-captions";
    case "lfm-server":
      return "server-captions";
    case "lfm-webgpu":
      return "client-captions";
    default:
      return "scene-captions";
  }
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
