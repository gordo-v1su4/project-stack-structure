type AuditionVideo = Pick<HTMLVideoElement, "currentTime" | "pause" | "play"> &
  Partial<Pick<HTMLVideoElement, "requestVideoFrameCallback" | "cancelVideoFrameCallback">>;
type FrameScheduler = {
  request: (callback: FrameRequestCallback) => number;
  cancel: (id: number) => void;
};

/** Audition only: freeze on the last included native frame, without changing edit budgets. */
export function createNativeHandleAudition(video: AuditionVideo,
  range: { trimStart: number; endFrameExclusive: number; fps: number },
  scheduler: FrameScheduler = { request: callback => requestAnimationFrame(callback), cancel: id => cancelAnimationFrame(id) }) {
  const lastFrameTime = (range.endFrameExclusive - 1) / range.fps;
  let frameId: number | undefined, animationId: number | undefined;
  let active = false, disposed = false, epoch = 0;

  function cancel() {
    active = false;
    epoch++;
    if (frameId !== undefined) video.cancelVideoFrameCallback?.(frameId);
    if (animationId !== undefined) scheduler.cancel(animationId);
    frameId = animationId = undefined;
  }
  function check(time = video.currentTime) {
    if (!active || disposed || time < lastFrameTime - 1e-6) return false;
    cancel();
    video.pause();
    // Also recover deterministically if a busy main thread skipped the boundary callback.
    video.currentTime = lastFrameTime;
    return true;
  }
  function schedule(token: number) {
    if (video.requestVideoFrameCallback) {
      frameId = video.requestVideoFrameCallback((_now, metadata) => {
        if (!active || disposed || token !== epoch) return;
        frameId = undefined;
        if (!check(metadata.mediaTime)) schedule(token);
      });
    } else {
      animationId = scheduler.request(() => {
        if (!active || disposed || token !== epoch) return;
        animationId = undefined;
        if (!check()) schedule(token);
      });
    }
  }
  function watch() {
    if (disposed || active) return;
    active = true;
    schedule(epoch);
  }
  return {
    watch, check, cancel,
    play() {
      if (disposed) return;
      cancel();
      video.currentTime = range.trimStart;
      watch();
      const token = epoch;
      void video.play().catch(() => { if (token === epoch) cancel(); });
    },
    destroy() { disposed = true; cancel(); video.pause(); },
  };
}
