import { normalizeFps } from "./frame-utils";

export interface ProbedMetadata {
  width: number;
  height: number;
  duration: number;
  fps: number;
  codec: string;
}

/** Best-effort codec guess from the container/MIME — browsers don't expose the real codec. */
function guessCodec(file: File): string {
  const ext = file.name.split(".").pop()?.toUpperCase() ?? "";
  const map: Record<string, string> = {
    MOV: "ProRes / H.264",
    MP4: "H.264",
    WEBM: "VP9",
    MKV: "H.264",
    M4V: "H.264",
  };
  return map[ext] ?? file.type.split("/")[1]?.toUpperCase() ?? "UNKNOWN";
}

/**
 * Probe a video file for dimensions, duration and fps. FPS is measured by
 * counting requestVideoFrameCallback ticks across a short play window, then
 * snapped to the nearest broadcast standard.
 */
export function probeVideo(file: File, src: string): Promise<ProbedMetadata> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.src = src;

    const fail = (e: unknown) => {
      cleanup();
      reject(e instanceof Error ? e : new Error("DECODE_FAILED"));
    };

    const cleanup = () => {
      video.removeEventListener("error", onError);
      video.src = "";
    };

    const onError = () => fail(new Error("DECODE_FAILED"));
    video.addEventListener("error", onError);

    video.addEventListener(
      "loadedmetadata",
      () => {
        const width = video.videoWidth || 1920;
        const height = video.videoHeight || 1080;
        const duration = Number.isFinite(video.duration) ? video.duration : 0;

        // Measure fps via rVFC if available.
        const rvfc = (
          video as HTMLVideoElement & {
            requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number;
          }
        ).requestVideoFrameCallback;

        if (!rvfc) {
          cleanup();
          resolve({ width, height, duration, fps: 30, codec: guessCodec(file) });
          return;
        }

        let firstMediaTime = -1;
        let firstNow = -1;
        let frames = 0;
        const SAMPLE_FRAMES = 12;

        const onFrame = (now: number, meta: { mediaTime: number }) => {
          if (firstMediaTime < 0) {
            firstMediaTime = meta.mediaTime;
            firstNow = now;
          }
          frames++;
          if (frames >= SAMPLE_FRAMES) {
            const mediaDelta = meta.mediaTime - firstMediaTime;
            const measured = mediaDelta > 0 ? (frames - 1) / mediaDelta : 30;
            void firstNow;
            video.pause();
            cleanup();
            resolve({
              width,
              height,
              duration,
              fps: normalizeFps(measured),
              codec: guessCodec(file),
            });
            return;
          }
          rvfc.call(video, onFrame);
        };

        rvfc.call(video, onFrame);
        video.play().catch(() => {
          // Autoplay blocked — fall back to a default fps.
          cleanup();
          resolve({ width, height, duration, fps: 30, codec: guessCodec(file) });
        });
      },
      { once: true }
    );
  });
}

export function probeImage(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("DECODE_FAILED"));
    img.src = src;
  });
}
