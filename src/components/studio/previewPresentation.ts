/** One visible raster and two decoder-owned current/standby snapshots, never a
 * resident timeline frame bank. Decoder frames outside a trim are never copied. */
export type PreviewPresentedFrame = { index: number; mediaTime: number; token: number };
type Snapshot = { image: CanvasImageSource; close(): void };
type BufferFrame = {
  index: number; token: number; endTime: number; time: number | null;
  mediaClock: number; snapshot: Snapshot | null; ready: boolean; cancel(): void;
  readyPromise: Promise<void>; resolveReady(): void;
};
const MAX_PIXELS = 3840 * 2160;

export class PreviewPresentation {
  private canvas: HTMLCanvasElement | null = null;
  private context: CanvasRenderingContext2D | null = null;
  private raster: OffscreenCanvas | null = null;
  private frames = new Map<HTMLVideoElement, BufferFrame>();
  private presented: PreviewPresentedFrame | null = null;

  constructor(private readonly current: (video: HTMLVideoElement, index: number, token: number, mediaTime: number) => boolean,
    private readonly failure: (error: unknown) => void) {}

  attach(canvas: HTMLCanvasElement | null): boolean {
    this.clear(); this.canvas = canvas; this.context = null;
    if (!canvas || typeof OffscreenCanvas === "undefined") return false;
    this.context = canvas.getContext("2d", { alpha: false });
    this.raster = this.context ? new OffscreenCanvas(1, 1) : null;
    return !!this.context;
  }

  get element() { return this.context ? this.canvas : null; }
  get frame(): PreviewPresentedFrame | null { return this.presented; }

  observe(video: HTMLVideoElement, index: number, endTime: number, token: number, signal: AbortSignal, fresh: boolean, targetTime?: number) {
    if (!this.context || !video.requestVideoFrameCallback) return;
    const previous = this.frames.get(video); previous?.cancel();
    const retain = !fresh && !!previous;
    if (!retain) previous?.snapshot?.close();
    let resolveReady = () => {};
    let readyTimer: ReturnType<typeof setTimeout> | null = null;
    const readyPromise = new Promise<void>(resolve => { resolveReady = () => {
      if (readyTimer !== null) clearTimeout(readyTimer);
      readyTimer = null; resolve();
    }; });
    const state: BufferFrame = {
      index, endTime, token, time: retain ? previous.time : null,
      mediaClock: retain ? previous.mediaClock : 0,
      snapshot: retain ? previous.snapshot : null, ready: retain && previous.ready,
      cancel: () => {}, readyPromise, resolveReady,
    };
    let handle: number | null = null;
    const cancel = () => {
      if (handle !== null) video.cancelVideoFrameCallback(handle);
      handle = null; signal.removeEventListener("abort", cancel);
      resolveReady();
    };
    state.cancel = cancel; this.frames.set(video, state);
    // A decoder that never presents its staged seek frame is an explicit
    // preparation error, not an indefinitely pending playing transport.
    readyTimer = setTimeout(() => {
      cancel(); this.failure(new Error("The preview decoder did not present the requested frame."));
    }, 5000);
    const tick: VideoFrameRequestCallback = (_now, metadata) => {
      if (signal.aborted || this.frames.get(video) !== state) return;
      try {
        // Chromium can deliver the requested decoded frame before `seeked`.
        // Retain that snapshot, but publish it only after seek readiness.
        // The containing first frame can start before the requested in-point;
        // the out-point is exclusive even for an unknown/VFR frame duration.
        // rVFC timestamps can be rounded to microseconds (for example 68/24
        // appears as 2.833333). Compare in that same integer timebase so the
        // excluded frame is not admitted by floating-point representation.
        const firstTarget = !!state.snapshot || targetTime === undefined || metadata.mediaTime <= targetTime + 0.000001;
        if (firstTarget && Math.round(metadata.mediaTime * 1_000_000) < Math.round(endTime * 1_000_000) && video.videoWidth > 0) {
          const scale = Math.min(1, Math.sqrt(MAX_PIXELS / (video.videoWidth * video.videoHeight)));
          const width = Math.max(1, Math.floor(video.videoWidth * scale));
          const height = Math.max(1, Math.floor(video.videoHeight * scale));
          const raster = this.raster!;
          if (raster.width !== width || raster.height !== height) { raster.width = width; raster.height = height; }
          raster.getContext("2d", { alpha: false })!.drawImage(video, 0, 0, width, height);
          state.snapshot?.close(); state.snapshot = null;
          const image = raster.transferToImageBitmap();
          state.snapshot = { image, close: () => image.close() };
          state.time = metadata.mediaTime; state.mediaClock = video.currentTime;
          if (state.ready) resolveReady();
          this.present(video);
        }
      } catch (error) { cancel(); this.failure(error); return; }
      handle = video.requestVideoFrameCallback(tick);
    };
    signal.addEventListener("abort", cancel, { once: true });
    handle = video.requestVideoFrameCallback(tick);
  }

  ready(video: HTMLVideoElement) {
    const state = this.frames.get(video); if (!state) return Promise.resolve();
    const wasReady = state.ready;
    state.ready = true;
    // A pre-seek snapshot is not the requested image. A later decoded-frame
    // callback will replace it; until then the visible raster stays intact.
    if (!wasReady && state.snapshot && Math.abs(state.mediaClock - video.currentTime) >= 0.01) {
      state.snapshot.close(); state.snapshot = null; state.time = null;
    }
    if (state.snapshot) state.resolveReady();
    this.present(video);
    return state.readyPromise;
  }

  present(video: HTMLVideoElement) {
    const state = this.frames.get(video), canvas = this.canvas, context = this.context;
    if (!state?.ready || !state.snapshot || state.time === null || !canvas || !context
      || video.seeking || !this.current(video, state.index, state.token, state.time)) return;
    const image = state.snapshot.image as ImageBitmap;
    if (canvas.width !== image.width || canvas.height !== image.height) { canvas.width = image.width; canvas.height = image.height; }
    context.drawImage(image, 0, 0);
    this.presented = { index: state.index, mediaTime: state.time, token: state.token };
  }

  blank() { this.context?.clearRect(0, 0, this.canvas!.width, this.canvas!.height); this.presented = null; }
  clear() {
    for (const state of this.frames.values()) { state.cancel(); state.snapshot?.close(); }
    this.frames.clear(); this.blank();
    if (this.raster) { this.raster.width = 1; this.raster.height = 1; }
  }
}
