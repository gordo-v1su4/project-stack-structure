/**
 * Detached video element + frame extraction helpers used by the analysis
 * pipeline (thumbnails for scene cards, bitmaps for the caption model).
 */

export async function createAnalysisVideo(src: string): Promise<HTMLVideoElement> {
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = "anonymous";
  video.src = src;
  await new Promise<void>((resolve, reject) => {
    video.addEventListener("loadeddata", () => resolve(), { once: true });
    video.addEventListener("error", () => reject(new Error("DECODE_FAILED")), {
      once: true,
    });
  });
  return video;
}

export function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      clearTimeout(t);
      resolve();
    };
    const t = setTimeout(() => {
      video.removeEventListener("seeked", onSeeked);
      resolve();
    }, 1000);
    video.addEventListener("seeked", onSeeked);
    video.currentTime = Math.min(time, video.duration || time);
  });
}

const THUMB_MAX = 320;

/** Grab a JPEG data URL thumbnail at the given time. */
export async function grabThumbnail(
  video: HTMLVideoElement,
  time: number
): Promise<string> {
  await seekVideo(video, time);
  const vw = video.videoWidth || 640;
  const vh = video.videoHeight || 360;
  const scale = Math.min(THUMB_MAX / Math.max(vw, vh), 1);
  const w = Math.round(vw * scale);
  const h = Math.round(vh * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(video, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", 0.7);
}

const CAPTION_MAX = 512;

/** Grab an ImageBitmap at the given time, sized for the caption model. */
export async function grabBitmap(
  video: HTMLVideoElement,
  time: number
): Promise<ImageBitmap> {
  await seekVideo(video, time);
  const vw = video.videoWidth || 640;
  const vh = video.videoHeight || 360;
  const scale = Math.min(CAPTION_MAX / Math.max(vw, vh), 1);
  const w = Math.round(vw * scale);
  const h = Math.round(vh * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(video, 0, 0, w, h);
  return createImageBitmap(canvas);
}
