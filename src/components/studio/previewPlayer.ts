import { markPlaybackGroupState, markPlaybackTiming, pauseWithPlaybackTiming } from "./playbackTiming";

export interface PreviewSegment {
  useClipAudio?: boolean;
  kind?: "source" | "gap";
  gapReason?: string;
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
  private progressFrameVideo: VideoWithFrameCallback | null = null;
  private playbackToken = 0;
  private playbackAbort = new AbortController();
  private gapOffset = 0;
  private gapStartedAt: number | null = null;
  private pendingSeekTime: number | null = null;
  private seekPlaybackIntent: boolean | null = null;
  private seekedTimelineEnd = false;
  private elementOwnerTokens = new WeakMap<HTMLVideoElement, number>();
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
    return getMasterAudioTimeForPosition(this.segments, this.currentIndex, currentSegment.kind === "gap" ? currentSegment.startTime + this.currentGapOffset() : this.videoElement.currentTime);
  }

  private startMasterAudio() {
    const audio = this.audioElement;
    if (!audio) return;
    try {
      const target = this.getMasterAudioTargetTime();
      if (audio.paused || Math.abs(audio.currentTime - target) > MASTER_AUDIO_DRIFT_TOLERANCE_SECONDS) {
        audio.currentTime = target;
      }
    } catch {
      // Metadata may not be loaded yet; the drift loop corrects once playable.
    }
    if (!audio.paused) return;
    void audio.play().catch(() => {
      // Autoplay policy or missing source: video playback continues silently.
    });
  }

  private pauseMasterAudio() {
    if (this.audioElement) pauseWithPlaybackTiming(this.audioElement, "master-audio");
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
      if (!element) return;
      const active = this.segments[this.currentIndex]?.kind !== "gap" && index === this.activeElementIndex;
      element.style.opacity = active ? "1" : "0";
      element.muted = !active || this.segments[this.currentIndex]?.useClipAudio !== true;
    });
  }

  load(segments: PreviewSegment[]) {
    this.stop();
    this.segments = segments.filter(
      (segment) => (segment.kind === "gap" || segment.videoUrl) && segment.endTime > segment.startTime
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
    this.pendingSeekTime = null;
    this.seekPlaybackIntent = null;
    this.seekedTimelineEnd = false;
    this.status = "loading";
    this.emit();
    const token = this.invalidatePlayback();

    try {
      await this.playSegment(this.currentIndex, token);
    } catch (error) {
      if (token !== this.playbackToken) return;
      this.status = "error";
      this.currentSegmentEndTime = null;
      this.errorMessage = error instanceof Error ? error.message : "Playback failed.";
      this.stopProgressLoop();
      this.emit();
    }
  }

  pause() {
    markPlaybackTiming("player-pause-entry");
    if (!this.videoElement) return;
    const pendingSeekTime = this.pendingSeekTime;
    if (this.segments[this.currentIndex]?.kind === "gap") { this.gapOffset = this.currentGapOffset(); this.gapStartedAt = null; }
    pauseWithPlaybackTiming(this.videoElement, "active-video");
    this.pauseMasterAudio();
    markPlaybackGroupState([...this.elements, this.audioElement]);
    const token = this.invalidatePlayback();
    if (this.pendingSeekTime !== null) this.seekPlaybackIntent = false;
    this.status = "paused";
    this.stopProgressLoop();
    this.emit();
    markPlaybackTiming("player-pause-return");
    // Pausing cancels autoplay, not the requested frame. Continue preparing it
    // silently so a paused scrub does not leave the previous image displayed.
    if (pendingSeekTime !== null && token === this.playbackToken && this.status === "paused") void this.seekToPosition(pendingSeekTime, false);
  }

  resume() {
    if (!this.videoElement) return;
    if (this.pendingSeekTime !== null) {
      void this.seekToPosition(this.pendingSeekTime, true);
      return;
    }
    if (this.seekedTimelineEnd && this.status === "paused") {
      this.status = "ended";
      this.currentSegmentEndTime = null;
      this.emit();
      return;
    }
    if (this.segments[this.currentIndex]?.kind === "gap") {
      const token = this.invalidatePlayback();
      void this.playGap(this.segments[this.currentIndex]!, token).then(() => this.advanceToNext(token));
      return;
    }

    if (this.currentSegmentEndTime !== null && this.status === "paused") {
      const token = this.invalidatePlayback();
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

    if (this.status === "paused") {
      // Pausing a pending metadata/seek operation invalidates its chain before
      // an end waiter exists. Restart preparation so the resumed cut is bounded.
      void this.play();
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
    this.pendingSeekTime = null;
    this.seekPlaybackIntent = null;
    this.seekedTimelineEnd = false;
    this.stopProgressLoop();
    this.pauseMasterAudio();
    this.currentSegmentEndTime = null;
    this.status = "error";
    this.errorMessage = message;
    this.emit();
  }

  stop() {
    markPlaybackTiming("player-stop-entry");
    this.gapOffset = 0;
    this.gapStartedAt = null;
    this.pendingSeekTime = null;
    this.seekPlaybackIntent = null;
    this.seekedTimelineEnd = false;
    this.invalidatePlayback();
    this.stopProgressLoop();
    this.pauseMasterAudio();
    this.currentSegmentEndTime = null;
    this.nextSegmentIsLive = false;
    for (const element of this.elements) {
      if (!element) continue;
      pauseWithPlaybackTiming(element, element === this.videoElement ? "active-video" : "standby-video");
      element.removeAttribute("src");
      element.load();
    }
    this.activeElementIndex = 0;
    this.applyElementVisibility();
    this.status = "idle";
    this.currentIndex = 0;
    markPlaybackGroupState([...this.elements, this.audioElement]);
    this.emit();
    markPlaybackTiming("player-stop-return");
  }

  seekToSegment(index: number): Promise<void> {
    if (!Number.isInteger(index) || index < 0 || index >= this.segments.length) return Promise.resolve();
    return this.seekToTime(this.segments.slice(0, index).reduce((sum, segment) => sum + segment.endTime - segment.startTime, 0));
  }

  /** Elapsed assembled-preview seconds, matching getState().currentTime.
   * Latest request wins. Resolves preparation, never the remaining playback;
   * current errors are reported through state, so fire-and-forget UI is safe. */
  seekToTime(seconds: number): Promise<void> {
    return this.seekToPosition(seconds, this.seekPlaybackIntent ?? (this.status === "playing" || this.status === "loading"));
  }

  private async seekToPosition(seconds: number, shouldPlay: boolean): Promise<void> {
    if (!Number.isFinite(seconds) || !this.videoElement || !this.segments.length) return;
    const timelineTime = Math.min(this.totalDuration, Math.max(0, seconds));
    let index = 0, elapsed = 0;
    while (index < this.segments.length - 1 && elapsed + this.segments[index]!.endTime - this.segments[index]!.startTime <= timelineTime) {
      elapsed += this.segments[index]!.endTime - this.segments[index]!.startTime;
      index++;
    }
    const segment = this.segments[index]!;
    const offset = Math.min(segment.endTime - segment.startTime, timelineTime - elapsed);
    const sourceTime = segment.startTime + offset;
    const token = this.invalidatePlayback();
    this.stopProgressLoop();
    for (const element of this.elements) element?.pause();
    this.pauseMasterAudio();
    this.nextSegmentIsLive = false;
    this.currentSegmentEndTime = null;
    this.currentIndex = index;
    this.gapOffset = offset;
    this.gapStartedAt = null;
    this.pendingSeekTime = timelineTime;
    this.seekPlaybackIntent = shouldPlay;
    this.seekedTimelineEnd = timelineTime === this.totalDuration;
    this.errorMessage = null;
    this.status = "loading";
    // Reuse the standby decoder if it already owns this resource; never clear
    // either assignment or the warm cache just to move the playhead.
    if (segment.kind !== "gap" && !hasAssignedVideoSource(this.videoElement!, segment.videoUrl)
      && this.standbyElement && hasAssignedVideoSource(this.standbyElement, segment.videoUrl)) {
      this.activeElementIndex = this.activeElementIndex === 0 ? 1 : 0;
    }
    this.applyElementVisibility();
    this.emit();
    if (token !== this.playbackToken) return;
    const video = this.videoElement!;
    try {
      if (segment.kind !== "gap") {
        // Timeline end is logical; the final trim's source end is exclusive.
        // Seek just inside it rather than exposing the next, unapproved frame.
        const exclusiveEnd = this.seekedTimelineEnd ? segment.endTime : undefined;
        const landingTime = exclusiveEnd === undefined ? sourceTime
          : exclusiveEnd - Math.min(0.000001, (segment.endTime - segment.startTime) / 2);
        await this.prepareVisibleVideo(video, { ...segment, startTime: landingTime }, token, exclusiveEnd);
      }
      if (token !== this.playbackToken) return;
      if (this.audioElement) {
        try { this.audioElement.currentTime = getMasterAudioTimeForPosition(this.segments, index, sourceTime); }
        catch { /* Metadata may arrive later; normal playback drift corrects it. */ }
      }
      if (shouldPlay && !this.seekedTimelineEnd && segment.kind !== "gap") {
        await video.play();
        if (token !== this.playbackToken) {
          if (this.elementOwnerTokens.get(video) === token) video.pause();
          return;
        }
      }
      this.pendingSeekTime = null;
      this.seekPlaybackIntent = null;
      this.currentSegmentEndTime = segment.endTime;
      if (!shouldPlay || this.seekedTimelineEnd) {
        this.status = shouldPlay ? "ended" : "paused";
        this.emit();
      } else {
        let playing: Promise<void>;
        if (segment.kind === "gap") playing = this.playGap(segment, token).then(() => this.advanceToNext(token));
        else {
          this.nextSegmentIsLive = true;
          playing = this.playSegment(index, token, true);
        }
        void playing.catch(error => {
          if (token === this.playbackToken) this.failPlayback(error instanceof Error ? error.message : "Playback failed after seeking.");
        });
      }
    } catch (error) {
      if (token !== this.playbackToken) return;
      video.pause();
      this.failPlayback(error instanceof Error ? error.message : "Could not seek preview playback.");
    }
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

  private async playSegment(index: number, token: number, preserveWarmCache = false) {
    if (token !== this.playbackToken) return;
    const video = this.videoElement;
    if (!video || index >= this.segments.length) {
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
    this.currentSegmentEndTime = null;
    if (!preserveWarmCache) this.warmSourcesAround(index);
    this.applyElementVisibility();
    if (segment.kind === "gap") {
      this.gapOffset = 0;
      this.nextSegmentIsLive = false;
      await this.playGap(segment, token);
      await this.advanceToNext(token);
      return;
    }

    if (this.nextSegmentIsLive) {
      // This segment was staged on the standby element and swapped in at the
      // previous cut boundary; it is already seeked, visible, and playing.
      this.nextSegmentIsLive = false;
    } else {
      await this.prepareVisibleVideo(video, segment, token);
      if (token !== this.playbackToken) return;

      await video.play();
      if (token !== this.playbackToken) {
        if (this.elementOwnerTokens.get(video) === token) video.pause();
        return;
      }
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
    if (standby && nextSegment && nextSegment.kind !== "gap") {
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
        // stop/seek/pause/newer chain invalidated this one while play() was
        // pending. Only silence the standby if this chain still owns it — a
        // newer chain may have repurposed the same element for the same URL.
        if (this.standbyElement === standby && this.elementOwnerTokens.get(standby) === token) {
          standby.pause();
        }
        return;
      }
      if (standbyReady) {
        this.activeElementIndex = this.activeElementIndex === 0 ? 1 : 0;
        video.muted = true;
        video.pause();
        this.nextSegmentIsLive = true;
        this.stopProgressLoop();
      }
    }

    await this.advanceToNext(token);
  }

  private currentGapOffset() {
    return this.gapOffset + (this.gapStartedAt === null ? 0 : (performance.now() - this.gapStartedAt) / 1000);
  }

  private invalidatePlayback() {
    this.playbackToken++;
    this.playbackAbort.abort();
    this.playbackAbort = new AbortController();
    return this.playbackToken;
  }

  private async playGap(segment: PreviewSegment, token: number) {
    for (const element of this.elements) element?.pause();
    this.stopProgressLoop();
    this.applyElementVisibility();
    this.gapStartedAt = performance.now();
    this.status = "playing";
    this.currentSegmentEndTime = segment.endTime;
    this.startMasterAudio();
    await new Promise<void>((resolve) => {
      const signal = this.playbackAbort.signal;
      let frameId: number | null = null;
      const finish = () => {
        if (frameId !== null) cancelAnimationFrame(frameId);
        signal.removeEventListener("abort", finish);
        resolve();
      };
      const tick = () => {
        if (token !== this.playbackToken || this.status !== "playing") { finish(); return; }
        this.correctMasterAudioDrift();
        this.emit();
        if (this.currentGapOffset() >= segment.endTime - segment.startTime) {
          this.gapOffset = segment.endTime - segment.startTime;
          this.gapStartedAt = null;
          finish();
          return;
        }
        frameId = requestAnimationFrame(tick);
      };
      signal.addEventListener("abort", finish, { once: true });
      tick();
    });
  }

  private async prepareVisibleVideo(video: HTMLVideoElement, segment: PreviewSegment, token: number, exclusiveEnd?: number) {
    if (token !== this.playbackToken) return;
    this.elementOwnerTokens.set(video, token);
    // stop() clears src, but Chromium can retain currentSrc until its next
    // resource-selection task. That stale URL has no playable metadata.
    // Trust the assigned source so immediate section replays always reload.
    const sameSource = hasAssignedVideoSource(video, segment.videoUrl);
    if (!sameSource) {
      video.pause();
      video.preload = "auto";
      video.src = segment.videoUrl;
      video.load();
    }

    await waitForMetadata(video, token, () => this.playbackToken, this.playbackAbort.signal);
    if (token !== this.playbackToken) return;
    await seekVideo(video, segment.startTime, token, () => this.playbackToken, this.playbackAbort.signal, exclusiveEnd);
  }

  private waitForSegmentEnd(endTime: number, token: number): Promise<void> {
    return new Promise<void>((resolve) => {
      if (!this.videoElement || token !== this.playbackToken) {
        resolve();
        return;
      }

      const video = this.videoElement as VideoWithFrameCallback;
      const signal = this.playbackAbort.signal;
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
        signal.removeEventListener("abort", finish);
        video.removeEventListener("timeupdate", onTimeUpdate);
        video.removeEventListener("ended", onEnded);
        video.removeEventListener("error", onError);
        if (frameCallbackId !== null) {
          video.cancelVideoFrameCallback?.(frameCallbackId);
          frameCallbackId = null;
        }
      };

      video.addEventListener("ended", onEnded);
      signal.addEventListener("abort", finish, { once: true });
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
      for (const element of this.elements) element?.pause();
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
      this.progressFrameVideo = video;
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
    if (this.progressFrameCallbackId !== null) {
      this.progressFrameVideo?.cancelVideoFrameCallback?.(this.progressFrameCallbackId);
      this.progressFrameCallbackId = null;
    }
    this.progressFrameVideo = null;
    if (this.progressRafId !== null) {
      cancelAnimationFrame(this.progressRafId);
      this.progressRafId = null;
    }
  }

  private computeCurrentTime(): number {
    if (this.pendingSeekTime !== null) return this.pendingSeekTime;
    if (this.status === "idle") return 0;
    if (this.status === "ended" || (this.seekedTimelineEnd && this.status === "paused")) return this.totalDuration;
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
      elapsed += currentSegment.kind === "gap" ? Math.min(currentSegment.endTime - currentSegment.startTime, this.currentGapOffset()) : Math.max(0, this.videoElement.currentTime - currentSegment.startTime);
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

function hasAssignedVideoSource(video: HTMLVideoElement, requested: string): boolean {
  // The reflected .src is absolute even when a segment uses /api/storage/media.
  // The attribute establishes that a source is still assigned after stop();
  // currentSrc can retain the previous resource after that attribute is cleared.
  const assigned = video.getAttribute("src");
  if (!assigned) return false;
  if (assigned === requested) return true;
  try {
    const base = video.ownerDocument?.baseURI;
    return new URL(assigned, base).href === new URL(requested, base).href;
  } catch {
    return false;
  }
}

function waitForMetadata(video: HTMLVideoElement, token: number, getToken: () => number, signal: AbortSignal): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("error", onError);
      signal.removeEventListener("abort", onLoaded);
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
    signal.addEventListener("abort", onLoaded, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

function seekVideo(video: HTMLVideoElement, time: number, token: number, getToken: () => number, signal: AbortSignal, exclusiveEnd?: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (token !== getToken()) {
      resolve();
      return;
    }

    const targetTime = Number.isFinite(video.duration) && video.duration > 0
      ? Math.min(Math.max(0, time), Math.max(0, video.duration - (exclusiveEnd === undefined ? 0.01 : 0.000001)))
      : Math.max(0, time);
    const atTarget = () => exclusiveEnd === undefined
      ? Math.abs(video.currentTime - targetTime) < 0.01
      : video.currentTime < exclusiveEnd && Math.abs(video.currentTime - targetTime) <= 0.000001;

    const cleanup = () => {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
      signal.removeEventListener("abort", onAbort);
    };
    const onSeeked = () => {
      if (token === getToken() && (video.seeking || !atTarget())) return;
      cleanup();
      resolve();
    };
    const onAbort = () => { cleanup(); resolve(); };
    const onError = () => {
      cleanup();
      reject(new Error("Could not seek preview video."));
    };

    if (atTarget() && !video.seeking) {
      resolve();
      return;
    }

    video.addEventListener("seeked", onSeeked);
    signal.addEventListener("abort", onAbort, { once: true });
    video.addEventListener("error", onError, { once: true });
    try {
      if (!atTarget()) video.currentTime = targetTime;
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}
