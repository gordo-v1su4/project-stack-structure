import { uploadSceneCaptionManifestToRustFs, uploadVideoFileToRustFs } from "./mediaStorage";
import { captionDetectedScenes, sceneCaptionMatchesMode, type SceneCaptionOptions } from "./sceneCaptioning";
import { detectScenesFromStoredVideo } from "./sceneSplit";
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

              if (!onSceneUpdate) return undefined;
              if (!storage.storageBucket || !storage.storagePath) {
                onSceneUpdate({
                  key,
                  source: {
                    ...storedSource,
                    scenes: [],
                    sceneStatus: "failed" as const,
                    sceneError: "RustFS upload did not return a bucket and object key for scene detection.",
                    captionStatus: "failed" as const,
                    captionError: "Captioning requires successful PySceneDetect scene output.",
                  },
                });
                return undefined;
              }

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

/**
 * Counts scenes whose captions were not produced by the requested caption
 * mode (e.g. BLIP captions imported from the scene-detect worker while the
 * studio is set to smart Qwen captions).
 */
export function countMismatchedSceneCaptions(sources: UploadedVideoSource[], mode: SceneCaptionSettings["mode"]) {
  return sources.reduce(
    (total, source) => total + (source.scenes ?? []).filter((scene) => scene.caption && !sceneCaptionMatchesMode(scene, mode)).length,
    0,
  );
}

/**
 * Re-runs server scene detection and/or captioning for an already-uploaded
 * source. Used for clips restored from a draft after a transient gateway
 * failure, and to recaption scenes with the currently selected caption lane.
 * Detection is skipped when the source already has ready scenes; captioning
 * always runs and replaces captions that do not match the requested mode
 * (keeping the previous caption when a recaption attempt fails).
 */
export async function rerunSourceSceneAnalysis(
  source: UploadedVideoSource,
  captionSettings: SceneCaptionSettings,
  onUpdate: (update: VideoSceneUpdate) => void,
): Promise<void> {
  const key = buildPreparedSourceKey(source);

  if (!source.storageBucket || !source.storagePath) {
    onUpdate({
      key,
      source: {
        ...source,
        sceneStatus: "failed",
        sceneError: "Scene analysis needs this clip in RustFS; re-upload the clip first.",
        captionStatus: "failed",
        captionError: "Captioning requires successful PySceneDetect scene output.",
      },
    });
    return;
  }

  let workingSource: UploadedVideoSource = { ...source };
  const needsDetection = workingSource.sceneStatus !== "ready" || !(workingSource.scenes?.length);

  if (needsDetection) {
    onUpdate({
      key,
      source: { ...workingSource, scenes: [], sceneStatus: "detecting", sceneError: null, captionStatus: undefined, captionError: null },
    });

    try {
      const scenes = await detectScenesFromStoredVideo(
        { bucket: source.storageBucket, objectKey: source.storagePath },
        source.id,
      );
      workingSource = { ...workingSource, scenes, sceneStatus: "ready", sceneError: null };
    } catch (error) {
      onUpdate({
        key,
        source: {
          ...workingSource,
          scenes: [],
          sceneStatus: "failed",
          sceneError: error instanceof Error ? error.message : "Stored-object scene detection failed",
          captionStatus: "failed",
          captionError: "Captioning requires successful PySceneDetect scene output.",
        },
      });
      return;
    }
  }

  workingSource = { ...workingSource, captionStatus: "captioning", captionError: null };
  onUpdate({ key, source: workingSource });

  const captionedSource = await captionAndPersistSourceScenes(workingSource, key, captionSettings, onUpdate, { force: true });
  onUpdate({ key, source: captionedSource });
}

async function captionAndPersistSourceScenes(
  source: UploadedVideoSource,
  key: string,
  captionSettings: SceneCaptionSettings,
  onSceneUpdate?: (update: VideoSceneUpdate) => void,
  captionOptions: SceneCaptionOptions = {},
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
    }, captionOptions);
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
    scenes: mergeScenes(currentSource, update),
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

function mergeScenes(currentSource: UploadedVideoSource, update: UploadedVideoSource) {
  if (update.sceneStatus === "failed") return update.scenes ?? [];
  if (update.scenes !== undefined) return update.scenes;
  return currentSource.scenes;
}

function mergeStorageProvider(currentSource: UploadedVideoSource, update: UploadedVideoSource) {
  if (update.storageProvider && update.storageProvider !== "local") return update.storageProvider;
  return currentSource.storageProvider ?? update.storageProvider;
}

function mergeStorageStatus(currentSource: UploadedVideoSource, update: UploadedVideoSource) {
  if (update.storageStatus && update.storageStatus !== "uploading") return update.storageStatus;
  return currentSource.storageStatus ?? update.storageStatus;
}
