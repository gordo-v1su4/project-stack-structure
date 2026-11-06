/** Capture native H3 pixels in the browser; the worker still screens the PNG. */
export async function captureH3FirstFrame(url: string, timeSeconds: number): Promise<File> {
  if (!url || !Number.isFinite(timeSeconds) || timeSeconds < 0) throw new Error("Choose a frame inside the earlier shot.");
  if (typeof document === "undefined") throw new Error("Frame capture requires the browser.");
  return new Promise<File>((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = "anonymous";
    let settled = false;
    let capturing = false;
    const finish = (error?: Error, file?: File) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      video.onloadedmetadata = null;
      video.onloadeddata = null;
      video.onseeked = null;
      video.onerror = null;
      video.pause();
      video.removeAttribute("src");
      video.load();
      if (error) reject(error);
      else if (file) resolve(file);
      else reject(new Error("The earlier shot could not supply a first frame."));
    };
    const timeout = window.setTimeout(() => finish(new Error("Frame capture timed out. Try the earlier shot again.")), 20_000);
    const capture = () => {
      if (settled || capturing || video.seeking || video.readyState < 2) return;
      if (video.videoWidth !== 1344 || video.videoHeight !== 768) {
        finish(new Error("Choose a native H3 shot for this first frame. No automatic resizing is applied."));
        return;
      }
      capturing = true;
      try {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("The browser could not prepare a first frame.");
        context.drawImage(video, 0, 0);
        canvas.toBlob((blob) => {
          if (!blob || blob.size < 1 || blob.size > 32 * 1024 * 1024) {
            finish(new Error("The captured first frame could not be prepared."));
            return;
          }
          finish(undefined, new File([blob], `first-frame-${Date.now()}.png`, { type: "image/png" }));
        }, "image/png");
      } catch {
        finish(new Error("The earlier shot could not supply a readable first frame."));
      }
    };
    video.onloadedmetadata = () => {
      if (!Number.isFinite(video.duration) || timeSeconds >= video.duration) {
        finish(new Error("Choose a frame inside the earlier shot."));
        return;
      }
      video.currentTime = timeSeconds;
    };
    video.onloadeddata = capture;
    video.onseeked = capture;
    video.onerror = () => finish(new Error("The earlier shot could not be loaded for frame capture."));
    video.src = url;
    video.load();
  });
}
