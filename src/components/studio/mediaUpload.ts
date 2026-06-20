import { uploadSceneCaptionManifestToRustFs, uploadVideoFileToRustFs } from "./mediaStorage";
import { captionDetectedScenes } from "./sceneCaptioning";
import { detectScenesFromStoredVideo, detectScenesWithSplitter } from "./sceneSplit";
import type { DetectedSceneSegment, SceneCaptionSettings, UploadedVideoSource } from "./types";

export type VideoSceneUpdate = {
  key: string;
  source: UploadedVideoSource;
};

export type VideoStorageUpdate = {
  key: string;
  source: UploadedVideoSource;
};

export async function prepareVideoSources(
  files: File[],
  onSceneUpdate?: (update: VideoSceneUpdate) => void,
  onStorageUpdate?: (update: VideoStorageUpdate) => void,
  captionSettings: SceneCaptionSettings = { mode: "fast" },
) {
  const videoFiles = files.filter((file) => file.type.startsWith("video/"));

  return Promise.all(
    videoFiles.map(async (file, index) => {
      const objectUrl = URL.createObjectURL(file);

      try {
        const duration = await readVideoDuration(objectUrl);
        const thumbnailUrl = await captureVideoThumbnail(objectUrl, duration);

        const source = {
          id: index,
          name: file.name,
          duration,
          size: file.size,
          thumbnailUrl,
          videoUrl: objectUrl,
          storageProvider: "local" as const,
          storageStatus: "uploading" as const,
          storageError: null,
          scenes: [],
          sceneStatus: "detecting" as const,
          sceneError: null,
        } satisfies UploadedVideoSource;
        const key = buildPreparedSourceKey(source);

        if (onStorageUpdate || onSceneUpdate) {
          void uploadVideoFileToRustFs(file)
            .then((storage) => {
              const storedSource = {
                ...source,
                ...storage,
              };
              onStorageUpdate?.({
                key,
                source: storedSource,
              });

              if (onSceneUpdate && storage.storageBucket && storage.storagePath) {
                return detectScenesFromStoredVideo({
                  bucket: storage.storageBucket,
                  objectKey: storage.storagePath,
                }, index)
                  .then(async (scenes) => {
                    const readySource = {
                      ...storedSource,
                      scenes,
                      sceneStatus: "ready" as const,
                      sceneError: null,
                      captionStatus: "captioning" as const,
                      captionError: null,
                    };
                    onSceneUpdate({
                      key,
                      source: readySource,
                    });

                    const captionedSource = await captionAndPersistSourceScenes(readySource, key, captionSettings, onSceneUpdate);
                    onSceneUpdate({ key, source: captionedSource });
                  })
                  .catch((error) => {
                    const sceneError = error instanceof Error ? error.message : "Stored-object scene detection failed";
                    onSceneUpdate({
                      key,
                      source: {
                        ...storedSource,
                        scenes: [],
                        sceneStatus: "failed" as const,
                        sceneError,
                        captionStatus: "failed" as const,
                        captionError: "Captioning requires successful PySceneDetect scene output.",
                      },
                    });
                  });
              }
              return undefined;
            })
            .catch((error) => {
              const storageError = error instanceof Error ? error.message : "RustFS upload failed";
              onStorageUpdate?.({
                key,
                source: {
                  ...source,
                  storageStatus: "failed" as const,
                  storageError,
                  sceneStatus: "failed" as const,
                  sceneError: "RustFS upload is required before server-side scene detection.",
                  captionStatus: "failed" as const,
                  captionError: "Captioning requires durable RustFS media upload.",
                },
              });
            });
        }

        if (onSceneUpdate) {
          void detectScenesWithSplitter(file, index)
            .then(async (scenes) => {
              const readySource = {
                ...source,
                scenes,
                sceneStatus: "ready" as const,
                sceneError: null,
                captionStatus: "captioning" as const,
                captionError: null,
              };
              onSceneUpdate({
                key,
                source: readySource,
              });
              const captionedSource = await captionAndPersistSourceScenes(readySource, key, captionSettings, onSceneUpdate);
              onSceneUpdate({ key, source: captionedSource });
            })
            .catch((error) => {
              const sceneError = error instanceof Error ? error.message : "Scene detection failed";
              onSceneUpdate({
                key,
                source: {
                  ...source,
                  scenes: [],
                  sceneStatus: "failed" as const,
                  sceneError,
                  captionStatus: "failed" as const,
                  captionError: "Captioning requires successful PySceneDetect scene output.",
                },
              });
            });
        }

        return source;
      } catch (error) {
        URL.revokeObjectURL(objectUrl);
        throw error;
      }
    })
  );
}

export function revokePreparedVideoSources(sources: UploadedVideoSource[]) {
  for (const source of sources) {
    URL.revokeObjectURL(source.videoUrl);
  }
}

async function captionAndPersistSourceScenes(
  source: UploadedVideoSource,
  key: string,
  captionSettings: SceneCaptionSettings,
  onSceneUpdate?: (update: VideoSceneUpdate) => void,
): Promise<UploadedVideoSource> {
  const scenes = source.scenes ?? [];
  if (!scenes.length) {
    return {
      ...source,
      captionStatus: "ready",
      captionError: null,
    };
  }

  try {
    const captionedScenes = await captionDetectedScenes(source, scenes, captionSettings, (_progress, partialScenes) => {
      onSceneUpdate?.({
        key,
        source: {
          ...source,
          scenes: partialScenes,
          captionStatus: "captioning",
          captionError: null,
        },
      });
    });
    let captionedSource: UploadedVideoSource = {
      ...source,
      scenes: captionedScenes,
      captionStatus: "ready",
      captionError: null,
    };

    if (source.storageProvider === "rustfs" && source.storageBucket && source.storagePath) {
      try {
        captionedSource = {
          ...captionedSource,
          ...(await uploadSceneCaptionManifestToRustFs(captionedSource)),
        };
      } catch (error) {
        console.warn("[RustFS] Scene caption manifest upload failed; keeping local captions", error);
      }
    }

    return captionedSource;
  } catch (error) {
    return {
      ...source,
      scenes: markCaptionError(scenes, error, captionSettings),
      captionStatus: "failed",
      captionError: error instanceof Error ? error.message : "Scene captioning failed",
    };
  }
}

function markCaptionError(scenes: DetectedSceneSegment[], error: unknown, captionSettings: SceneCaptionSettings) {
  const message = error instanceof Error ? error.message : "Scene captioning failed";
  return scenes.map((scene) => scene.caption ? scene : { ...scene, captionMode: captionSettings.mode, captionError: message });
}

function buildPreparedSourceKey(source: Pick<UploadedVideoSource, "name" | "size" | "duration">) {
  return `${source.name}::${source.size}::${source.duration.toFixed(3)}`;
}

function readVideoDuration(url: string) {
  return new Promise<number>((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.src = url;
    video.muted = true;
    video.playsInline = true;

    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
      resolve(duration);
    };
    video.onerror = () => reject(new Error("Could not read the uploaded video metadata."));
  });
}

function captureVideoThumbnail(url: string, duration: number) {
  return new Promise<string>((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "auto";
    video.src = url;
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = "anonymous";

    video.onloadeddata = () => {
      const targetTime = Math.max(0, Math.min(duration * 0.2, Math.max(duration - 0.1, 0.1)));
      if (targetTime <= 0.05) {
        resolve(renderVideoFrame(video));
        return;
      }

      video.currentTime = targetTime;
    };

    video.onseeked = () => {
      resolve(renderVideoFrame(video));
    };

    video.onerror = () => reject(new Error("Could not render a thumbnail for the uploaded video."));
  });
}

function renderVideoFrame(video: HTMLVideoElement) {
  const canvas = document.createElement("canvas");
  const width = Math.max(320, video.videoWidth || 320);
  const height = Math.max(180, video.videoHeight || 180);
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not create a canvas for video thumbnails.");
  }

  context.drawImage(video, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", 0.84);
}


export function mergeUploadedVideoSourceUpdate(
  currentSource: UploadedVideoSource,
  update: UploadedVideoSource,
): UploadedVideoSource {
  return {
    ...update,
    videoUrl: currentSource.videoUrl,
    thumbnailUrl: currentSource.thumbnailUrl,
    scenes: update.scenes?.length ? update.scenes : currentSource.scenes,
    sceneStatus: update.sceneStatus ?? currentSource.sceneStatus,
    sceneError: update.sceneError ?? currentSource.sceneError,
    captionStatus: update.captionStatus ?? currentSource.captionStatus,
    captionError: update.captionError ?? currentSource.captionError,
    captionManifestPath: update.captionManifestPath ?? currentSource.captionManifestPath,
    captionManifestUrl: update.captionManifestUrl ?? currentSource.captionManifestUrl,
    storageProvider: mergeStorageProvider(currentSource, update),
    storageBucket: update.storageBucket ?? currentSource.storageBucket,
    storagePath: update.storagePath ?? currentSource.storagePath,
    storageUrl: update.storageUrl ?? currentSource.storageUrl,
    storageStatus: mergeStorageStatus(currentSource, update),
    storageError: update.storageError ?? currentSource.storageError,
  };
}

function mergeStorageProvider(currentSource: UploadedVideoSource, update: UploadedVideoSource) {
  if (update.storageProvider && update.storageProvider !== "local") return update.storageProvider;
  return currentSource.storageProvider ?? update.storageProvider;
}

function mergeStorageStatus(currentSource: UploadedVideoSource, update: UploadedVideoSource) {
  if (update.storageStatus && update.storageStatus !== "uploading") return update.storageStatus;
  return currentSource.storageStatus ?? update.storageStatus;
}
