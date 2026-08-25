export interface PreviewSegment {
  videoUrl: string;
  startTime: number;
  endTime: number;
  label: string;
  /** Master-song timeline seconds for this cut (startTime/endTime are source-clip seconds). */
  musicStart?: number;
  musicEnd?: number;
}

export interface PreviewPlayerState {
  status: "idle" | "loading" | "playing" | "paused" | "ended" | "error";
  currentIndex: number;
  segmentCount: number;
  currentTime: number;
  totalDuration: number;
  errorMessage: string | null;
  engineMode: "html-video" | "warm-video";
  warmedSourceCount: number;
  usesFrameCallback: boolean;
}

export type PreviewPlayerListener = (state: PreviewPlayerState) => void;

export interface BrowserPreviewPlayerOptions {
  /** Number of upcoming unique source URLs to keep hot in hidden native video decoders. */
  warmSourceLimit?: number;
  /** Number of timeline segments to scan ahead when choosing sources to warm. */
  warmAheadSegments?: number;
  /** Seconds before a segment start used for decoder pre-roll seeks. */
  prerollSeconds?: number;
}

type FrameCallbackMetadata = { mediaTime: number };
type FrameCallback = (now: number, metadata: FrameCallbackMetadata) => void;
type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: FrameCallback) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

const STATE_IDLE: PreviewPlayerState = {
  status: "idle",
  currentIndex: 0,
  segmentCount: 0,
  currentTime: 0,
  totalDuration: 0,
  errorMessage: null,
  engineMode: "html-video",
  warmedSourceCount: 0,
  usesFrameCallback: false,
};

const DEFAULT_WARM_SOURCE_LIMIT = 4;
const DEFAULT_WARM_AHEAD_SEGMENTS = 6;
const DEFAULT_PREROLL_SECONDS = 0.08;
const SEGMENT_END_TOLERANCE_SECONDS = 0.025;
const MASTER_AUDIO_DRIFT_TOLERANCE_SECONDS = 0.12;

export class BrowserPreviewPlayer {
  private segments: PreviewSegment[] = [];
  private elements: [HTMLVideoElement | null, HTMLVideoElement | null] = [null, null];
  private activeElementIndex: 0 | 1 = 0;
  private nextSegmentIsLive = false;
  private currentIndex = 0;
  private listeners = new Set<PreviewPlayerListener>();
  private totalDuration = 0;
  private status: PreviewPlayerState["status"] = "idle";
  private errorMessage: string | null = null;
  private currentSegmentEndTime: number | null = null;
  private progressRafId: number | null = null;
  private progressFrameCallbackId: number | null = null;
  private playbackToken = 0;
  private warmElements = new Map<string, HTMLVideoElement>();
  private audioElement: HTMLAudioElement | null = null;
  private readonly warmSourceLimit: number;
  private readonly warmAheadSegments: number;
  private readonly prerollSeconds: number;

  constructor(options: BrowserPreviewPlayerOptions = {}) {
    this.warmSourceLimit = Math.max(0, options.warmSourceLimit ?? DEFAULT_WARM_SOURCE_LIMIT);
    this.warmAheadSegments = Math.max(0, options.warmAheadSegments ?? DEFAULT_WARM_AHEAD_SEGMENTS);
    this.prerollSeconds = Math.max(0, options.prerollSeconds ?? DEFAULT_PREROLL_SECONDS);
  }

  /** The element currently shown to the user. */
  private get videoElement(): HTMLVideoElement | null {
    return this.elements[this.activeElementIndex];
  }

  /** The hidden element the next cut is staged on (double buffering). */
  private get standbyElement(): HTMLVideoElement | null {
    return this.elements[this.activeElementIndex === 0 ? 1 : 0];
  }

  /**
   * Attach the visible playback element and, optionally, a second stacked
   * element used to stage the next cut off-screen. With a standby element the
   * cut swap is atomic — no black frame while the next source loads/seeks.
   */
  attach(videoElement: HTMLVideoElement, standbyElement: HTMLVideoElement | null = null) {
    this.elements = [videoElement, standbyElement];
    this.activeElementIndex = 0;
    this.nextSegmentIsLive = false;
    for (const element of this.elements) {
      if (!element) continue;
      element.crossOrigin = "anonymous";
      element.preload = "auto";
      element.playsInline = true;
    }
    this.applyElementVisibility();
  }

  detach() {
    this.stop();
    this.releaseWarmElements();
    this.attachAudioElement(null);
    this.elements = [null, null];
    this.activeElementIndex = 0;
  }

  getActiveVideoElement(): HTMLVideoElement | null {
    return this.videoElement;
  }

  /**
   * Attach the master-song audio element. While present, playback keeps it
   * synced to the cut timeline (segment musicStart + offset into the cut), so
   * previews play against the real track instead of raw source-clip audio.
   */
  attachAudioElement(audioElement: HTMLAudioElement | null) {
    if (this.audioElement && this.audioElement !== audioElement) {
      this.audioElement.pause();
    }
    this.audioElement = audioElement;
  }

  private getMasterAudioTargetTime(): number {
    if (!this.videoElement) return 0;
    const currentSegment = this.segments[this.currentIndex];
    if (!currentSegment) return 0;
    return getMasterAudioTimeForPosition(this.segments, this.currentIndex, this.videoElement.currentTime);
  }

  private startMasterAudio() {
    const audio = this.audioElement;
    if (!audio) return;
    try {
      audio.currentTime = this.getMasterAudioTargetTime();
    } catch {
      // Metadata may not be loaded yet; the drift loop corrects once playable.
    }
    void audio.play().catch(() => {
      // Autoplay policy or missing source: video playback continues silently.
    });
  }

  private pauseMasterAudio() {
    this.audioElement?.pause();
  }

  private correctMasterAudioDrift() {
    const audio = this.audioElement;
    if (!audio || audio.paused) return;
    const target = this.getMasterAudioTargetTime();
    if (Math.abs(audio.currentTime - target) > MASTER_AUDIO_DRIFT_TOLERANCE_SECONDS) {
      try {
        audio.currentTime = target;
      } catch {
        // Seek before metadata is a no-op; next tick retries.
      }
    }
  }

  private applyElementVisibility() {
    this.elements.forEach((element, index) => {
      if (element) element.style.opacity = index === this.activeElementIndex ? "1" : "0";
    });
  }

  load(segments: PreviewSegment[]) {
    this.stop();
    this.segments = segments.filter(
      (segment) => segment.videoUrl && segment.endTime > segment.startTime
    );
    this.totalDuration = this.segments.reduce(
      (sum, segment) => sum + (segment.endTime - segment.startTime),
      0
    );
    this.currentIndex = 0;
    this.status = "idle";
    this.errorMessage = this.segments.length > 0 ? null : "No valid segments to preview.";
    this.warmSourcesAround(0);
    this.emit();
  }

  async play() {
    if (!this.videoElement || this.segments.length === 0) return;
    this.status = "loading";
    this.emit();

    try {
      await this.playSegment(this.currentIndex, ++this.playbackToken);
    } catch (error) {
      this.status = "error";
      this.currentSegmentEndTime = null;
      this.errorMessage = error instanceof Error ? error.message : "Playback failed.";
      this.stopProgressLoop();
      this.emit();
    }
  }

  pause() {
    if (!this.videoElement) return;
    this.videoElement.pause();
    this.pauseMasterAudio();
    this.status = "paused";
    this.stopProgressLoop();
    this.emit();
  }

  resume() {
    if (!this.videoElement) return;

    if (this.currentSegmentEndTime !== null && this.status === "paused") {
      const token = ++this.playbackToken;
      const endTime = this.currentSegmentEndTime;
      void this.videoElement.play()
        .then(() => {
          if (token !== this.playbackToken) return;
          this.startMasterAudio();
          this.status = "playing";
          this.startProgressLoop();
          this.emit();
          return this.waitForSegmentEnd(endTime, token)
            .then(() => this.advanceToNext(token));
        })
        .catch(() => {
          if (token !== this.playbackToken) return;
          this.failPlayback("Could not resume preview playback.");
        });
      return;
    }

    const token = this.playbackToken;
    void this.videoElement.play()
      .then(() => {
        if (token !== this.playbackToken) return;
        this.startMasterAudio();
        this.status = "playing";
        this.startProgressLoop();
        this.emit();
      })
      .catch(() => {
        if (token !== this.playbackToken) return;
        this.failPlayback("Could not resume preview playback.");
      });
  }

  private failPlayback(message: string) {
    this.stopProgressLoop();
    this.pauseMasterAudio();
    this.currentSegmentEndTime = null;
    this.status = "error";
    this.errorMessage = message;
    this.emit();
  }

  stop() {
    this.playbackToken++;
    this.stopProgressLoop();
    this.pauseMasterAudio();
    this.currentSegmentEndTime = null;
    this.nextSegmentIsLive = false;
    for (const element of this.elements) {
      if (!element) continue;
      element.pause();
      element.removeAttribute("src");
      element.load();
    }
    this.activeElementIndex = 0;
    this.applyElementVisibility();
    this.status = "idle";
    this.currentIndex = 0;
    this.emit();
  }

  seekToSegment(index: number) {
    if (index < 0 || index >= this.segments.length) return;
    this.stop();
    this.currentIndex = index;
    this.warmSourcesAround(index);
    void this.play();
  }

  getState(): PreviewPlayerState {
    const currentTime = this.computeCurrentTime();
    return {
      status: this.status,
      currentIndex: this.currentIndex,
      segmentCount: this.segments.length,
      currentTime,
      totalDuration: this.totalDuration,
      errorMessage: this.errorMessage,
      engineMode: this.warmElements.size > 0 ? "warm-video" : "html-video",
      warmedSourceCount: this.warmElements.size,
      usesFrameCallback: this.hasFrameCallbackSupport(),
    };
  }

  subscribe(listener: PreviewPlayerListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSegments(): PreviewSegment[] {
    return this.segments;
  }

  getCurrentSegment(): PreviewSegment | null {
    return this.segments[this.currentIndex] ?? null;
  }

  getWarmedSourceCount(): number {
    return this.warmElements.size;
  }

  getWarmSourceLimit(): number {
    return this.warmSourceLimit;
  }

  getWarmSourceUrls(): string[] {
    return [...this.warmElements.keys()];
  }

  private async playSegment(index: number, token: number) {
    const video = this.videoElement;
    if (!video || index >= this.segments.length || token !== this.playbackToken) {
      this.status = "ended";
      this.emit();
      return;
    }

    const segment = this.segments[index];
    if (!segment) {
      this.status = "ended";
      this.emit();
      return;
    }

    this.currentIndex = index;
    this.warmSourcesAround(index);

    if (this.nextSegmentIsLive) {
      // This segment was staged on the standby element and swapped in at the
      // previous cut boundary; it is already seeked, visible, and playing.
      this.nextSegmentIsLive = false;
    } else {
      await this.prepareVisibleVideo(video, segment, token);
      if (token !== this.playbackToken) return;

      await video.play();
      if (token !== this.playbackToken) return;
    }

    this.status = "playing";
    this.currentSegmentEndTime = segment.endTime;
    this.startMasterAudio();
    this.startProgressLoop();
    this.emit();

    // Stage the next cut on the hidden standby element while this one plays,
    // so the boundary is an atomic visibility swap instead of a src/seek gap.
    const nextSegment = this.segments[index + 1];
    const standby = this.standbyElement;
    let standbyReady = false;
    if (standby && nextSegment) {
      void this.prepareVisibleVideo(standby, nextSegment, token)
        .then(() => {
          if (token === this.playbackToken) standbyReady = true;
        })
        .catch(() => {
          // Fall back to preparing on the visible element at the boundary.
        });
    }

    await this.waitForSegmentEnd(segment.endTime, token);
    if (token !== this.playbackToken) return;

    if (standby && nextSegment && standbyReady) {
      try {
        await standby.play();
      } catch {
        // Standby refused to start (errored or undecodable source). currentIndex
        // still points at the finished cut, so the single advanceToNext fallback
        // below replays the standby's segment (currentIndex + 1) on the visible
        // element — identical to the never-staged path; no cut is skipped.
        standbyReady = false;
      }
      if (token !== this.playbackToken || this.status !== "playing") {
        // stop()/seek/pause invalidated this chain while play() was pending;
        // never expose the standby element for a dead chain.
        standby.pause();
        return;
      }
      if (standbyReady) {
        this.activeElementIndex = this.activeElementIndex === 0 ? 1 : 0;
        this.applyElementVisibility();
        video.pause();
        this.nextSegmentIsLive = true;
        this.stopProgressLoop();
      }
    }

    await this.advanceToNext(token);
  }

  private async prepareVisibleVideo(video: HTMLVideoElement, segment: PreviewSegment, token: number) {
    const sameSource = video.currentSrc === segment.videoUrl || video.src === segment.videoUrl;
    if (!sameSource) {
      video.pause();
      video.preload = "auto";
      video.src = segment.videoUrl;
      video.load();
    }

    await waitForMetadata(video, token, () => this.playbackToken);
    if (token !== this.playbackToken) return;
    await seekVideo(video, segment.startTime, token, () => this.playbackToken);
  }

  private waitForSegmentEnd(endTime: number, token: number): Promise<void> {
    return new Promise<void>((resolve) => {
      if (!this.videoElement || token !== this.playbackToken) {
        resolve();
        return;
      }

      const video = this.videoElement as VideoWithFrameCallback;
      let frameCallbackId: number | null = null;
      let settled = false;

      const finish = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };

      const isDone = () => token !== this.playbackToken || video.currentTime >= endTime - SEGMENT_END_TOLERANCE_SECONDS;

      const check = () => {
        if (isDone()) finish();
      };

      const onFrame: FrameCallback = () => {
        if (isDone()) {
          finish();
          return;
        }
        frameCallbackId = video.requestVideoFrameCallback?.(onFrame) ?? null;
      };

      const onTimeUpdate = () => check();
      const onEnded = () => finish();
      const onError = () => finish();

      const cleanup = () => {
        video.removeEventListener("timeupdate", onTimeUpdate);
        video.removeEventListener("ended", onEnded);
        video.removeEventListener("error", onError);
        if (frameCallbackId !== null) {
          video.cancelVideoFrameCallback?.(frameCallbackId);
          frameCallbackId = null;
        }
      };

      video.addEventListener("ended", onEnded);
      video.addEventListener("error", onError);

      if (video.requestVideoFrameCallback) {
        frameCallbackId = video.requestVideoFrameCallback(onFrame);
      } else {
        video.addEventListener("timeupdate", onTimeUpdate);
      }
      check();
    });
  }

  private async advanceToNext(token: number) {
    if (this.status !== "playing" || token !== this.playbackToken) return;

    const nextIndex = this.currentIndex + 1;
    if (nextIndex >= this.segments.length) {
      this.stopProgressLoop();
      this.pauseMasterAudio();
      this.currentSegmentEndTime = null;
      this.status = "ended";
      this.emit();
      return;
    }

    try {
      await this.playSegment(nextIndex, token);
    } catch (error) {
      if (token !== this.playbackToken) return;
      this.stopProgressLoop();
      this.pauseMasterAudio();
      this.currentSegmentEndTime = null;
      this.status = "error";
      this.errorMessage = error instanceof Error ? error.message : "Segment playback failed.";
      this.emit();
    }
  }

  private startProgressLoop() {
    this.stopProgressLoop();
    const video = this.videoElement as VideoWithFrameCallback | null;
    if (video?.requestVideoFrameCallback) {
      const tick: FrameCallback = () => {
        if (this.status === "playing") {
          this.correctMasterAudioDrift();
          this.emit();
          this.progressFrameCallbackId = video.requestVideoFrameCallback?.(tick) ?? null;
        }
      };
      this.progressFrameCallbackId = video.requestVideoFrameCallback(tick);
      return;
    }

    const tick = () => {
      if (this.status === "playing") {
        this.correctMasterAudioDrift();
        this.emit();
      }
      this.progressRafId = requestAnimationFrame(tick);
    };
    this.progressRafId = requestAnimationFrame(tick);
  }

  private stopProgressLoop() {
    const video = this.videoElement as VideoWithFrameCallback | null;
    if (this.progressFrameCallbackId !== null) {
      video?.cancelVideoFrameCallback?.(this.progressFrameCallbackId);
      this.progressFrameCallbackId = null;
    }
    if (this.progressRafId !== null) {
      cancelAnimationFrame(this.progressRafId);
      this.progressRafId = null;
    }
  }

  private computeCurrentTime(): number {
    if (!this.videoElement || this.segments.length === 0) return 0;

    let elapsed = 0;
    for (let i = 0; i < this.currentIndex; i++) {
      const segment = this.segments[i];
      if (segment) {
        elapsed += segment.endTime - segment.startTime;
      }
    }

    const currentSegment = this.segments[this.currentIndex];
    if (currentSegment) {
      elapsed += Math.max(0, this.videoElement.currentTime - currentSegment.startTime);
    }

    return Math.min(elapsed, this.totalDuration);
  }

  private warmSourcesAround(index: number) {
    if (this.warmSourceLimit <= 0 || typeof document === "undefined") return;

    const targets = getWarmSegmentTargets({
      segments: this.segments,
      startIndex: index,
      aheadSegments: this.warmAheadSegments,
      limit: this.warmSourceLimit,
      prerollSeconds: this.prerollSeconds,
    });
    const targetUrls = new Set(targets.map((target) => target.videoUrl));

    for (const [url, element] of this.warmElements) {
      if (!targetUrls.has(url)) {
        releaseVideoElement(element);
        this.warmElements.delete(url);
      }
    }

    for (const target of targets) {
      const element = this.warmElements.get(target.videoUrl) ?? createWarmVideoElement(target.videoUrl);
      this.warmElements.set(target.videoUrl, element);
      warmVideoElement(element, target.warmTime);
    }
  }

  private releaseWarmElements() {
    for (const element of this.warmElements.values()) {
      releaseVideoElement(element);
    }
    this.warmElements.clear();
  }

  private hasFrameCallbackSupport(): boolean {
    return typeof (this.videoElement as VideoWithFrameCallback | null)?.requestVideoFrameCallback === "function";
  }

  private emit() {
    const state = this.getState();
    for (const listener of this.listeners) {
      listener(state);
    }
  }
}

export function createPreviewPlayerState(): PreviewPlayerState {
  return { ...STATE_IDLE };
}

/**
 * Master-song time for a cut position. Prefers the segment's own musicStart
 * (exact across non-contiguous edits); falls back to elapsed preview time
 * offset by the first segment's musicStart when music times are missing.
 */
export function getMasterAudioTimeForPosition(
  segments: PreviewSegment[],
  currentIndex: number,
  segmentVideoTime: number,
): number {
  const segment = segments[currentIndex];
  if (!segment) return 0;

  const offsetIntoSegment = Math.max(0, segmentVideoTime - segment.startTime);
  if (Number.isFinite(segment.musicStart)) {
    return Math.max(0, segment.musicStart! + offsetIntoSegment);
  }

  let elapsed = 0;
  for (let index = 0; index < currentIndex; index += 1) {
    const prior = segments[index];
    if (prior) elapsed += prior.endTime - prior.startTime;
  }
  const firstMusicStart = segments[0]?.musicStart;
  const base = Number.isFinite(firstMusicStart) ? firstMusicStart! : 0;
  return Math.max(0, base + elapsed + offsetIntoSegment);
}

export function getWarmSegmentTargets(params: {
  segments: PreviewSegment[];
  startIndex: number;
  aheadSegments: number;
  limit: number;
  prerollSeconds?: number;
}): Array<{ videoUrl: string; warmTime: number }> {
  const targets: Array<{ videoUrl: string; warmTime: number }> = [];
  const seen = new Set<string>();
  const endIndex = Math.min(params.segments.length, params.startIndex + params.aheadSegments + 1);
  for (let index = Math.max(0, params.startIndex); index < endIndex; index++) {
    const segment = params.segments[index];
    if (!segment?.videoUrl || seen.has(segment.videoUrl)) continue;
    seen.add(segment.videoUrl);
    targets.push({
      videoUrl: segment.videoUrl,
      warmTime: Math.max(0, segment.startTime - (params.prerollSeconds ?? DEFAULT_PREROLL_SECONDS)),
    });
    if (targets.length >= params.limit) break;
  }
  return targets;
}

function createWarmVideoElement(videoUrl: string) {
  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = videoUrl;
  video.setAttribute("data-preview-warm-source", "true");
  video.style.position = "fixed";
  video.style.width = "1px";
  video.style.height = "1px";
  video.style.opacity = "0";
  video.style.pointerEvents = "none";
  video.style.left = "-9999px";
  video.style.top = "-9999px";
  document.body.appendChild(video);
  video.load();
  return video;
}

function warmVideoElement(video: HTMLVideoElement, warmTime: number) {
  const seek = () => {
    try {
      if (Number.isFinite(video.duration) && video.duration > 0) {
        video.currentTime = Math.min(Math.max(0, warmTime), Math.max(0, video.duration - 0.05));
      }
    } catch {
      // Browser decoders can reject rapid background seeks; warmup is best-effort.
    }
  };

  if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
    seek();
    return;
  }

  video.addEventListener("loadedmetadata", seek, { once: true });
}

function releaseVideoElement(video: HTMLVideoElement) {
  video.pause();
  video.removeAttribute("src");
  video.load();
  video.remove();
}

function waitForMetadata(video: HTMLVideoElement, token: number, getToken: () => number): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("error", onError);
    };
    const onLoaded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Could not load preview video metadata."));
    };
    if (token !== getToken()) {
      resolve();
      return;
    }
    video.addEventListener("loadedmetadata", onLoaded, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

function seekVideo(video: HTMLVideoElement, time: number, token: number, getToken: () => number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (token !== getToken()) {
      resolve();
      return;
    }

    const targetTime = Number.isFinite(video.duration) && video.duration > 0
      ? Math.min(Math.max(0, time), Math.max(0, video.duration - 0.01))
      : Math.max(0, time);

    const cleanup = () => {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
    };
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Could not seek preview video."));
    };

    if (Math.abs(video.currentTime - targetTime) < 0.01) {
      resolve();
      return;
    }

    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onError, { once: true });
    try {
      video.currentTime = targetTime;
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}
