import type { UploadedVideoSource } from "./types";

export async function prepareVideoSources(files: File[]) {
  const videoFiles = files.filter((file) => file.type.startsWith("video/"));

  return Promise.all(
    videoFiles.map(async (file, index) => {
      const objectUrl = URL.createObjectURL(file);

      try {
        const duration = await readVideoDuration(objectUrl);
        const thumbnailUrl = await captureVideoThumbnail(objectUrl, duration);

        return {
          id: index,
          name: file.name,
          duration,
          size: file.size,
          thumbnailUrl,
          videoUrl: objectUrl,
        } satisfies UploadedVideoSource;
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
