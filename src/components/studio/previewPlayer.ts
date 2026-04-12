export interface PreviewSegment {
  videoUrl: string;
  startTime: number;
  endTime: number;
  label: string;
}

export interface PreviewPlayerState {
  status: "idle" | "loading" | "playing" | "paused" | "ended" | "error";
  currentIndex: number;
  segmentCount: number;
  currentTime: number;
  totalDuration: number;
  errorMessage: string | null;
}

export type PreviewPlayerListener = (state: PreviewPlayerState) => void;

const STATE_IDLE: PreviewPlayerState = {
  status: "idle",
  currentIndex: 0,
  segmentCount: 0,
  currentTime: 0,
  totalDuration: 0,
  errorMessage: null,
};

export class BrowserPreviewPlayer {
  private segments: PreviewSegment[] = [];
  private videoElement: HTMLVideoElement | null = null;
  private currentIndex = 0;
  private listeners = new Set<PreviewPlayerListener>();
  private totalDuration = 0;
  private status: PreviewPlayerState["status"] = "idle";
  private errorMessage: string | null = null;
  private seeking = false;
  private currentSegmentEndTime: number | null = null;
  private progressRafId: number | null = null;

  attach(videoElement: HTMLVideoElement) {
    this.videoElement = videoElement;
  }

  detach() {
    this.stop();
    this.videoElement = null;
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
    this.emit();
  }

  async play() {
    if (!this.videoElement || this.segments.length === 0) return;
    this.status = "loading";
    this.emit();

    try {
      await this.playSegment(this.currentIndex);
    } catch (error) {
      this.status = "error";
      this.errorMessage = error instanceof Error ? error.message : "Playback failed.";
      this.emit();
    }
  }

  pause() {
    if (!this.videoElement) return;
    this.videoElement.pause();
    this.status = "paused";
    this.stopProgressLoop();
    this.emit();
  }

  resume() {
    if (!this.videoElement) return;

    if (this.currentSegmentEndTime !== null && this.status === "paused") {
      this.videoElement.play().catch(() => {});
      this.status = "playing";
      this.startProgressLoop();
      this.emit();

      this.waitForSegmentEnd(this.currentSegmentEndTime)
        .then(() => this.advanceToNext())
        .catch(() => {});
      return;
    }

    this.videoElement.play().catch(() => {});
    this.status = "playing";
    this.emit();
  }

  stop() {
    this.stopProgressLoop();
    this.currentSegmentEndTime = null;
    if (this.videoElement) {
      this.videoElement.pause();
      this.videoElement.removeAttribute("src");
      this.videoElement.load();
    }
    this.status = "idle";
    this.currentIndex = 0;
    this.emit();
  }

  seekToSegment(index: number) {
    if (index < 0 || index >= this.segments.length) return;
    this.stop();
    this.currentIndex = index;
    this.play();
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

  private async playSegment(index: number) {
    if (!this.videoElement || index >= this.segments.length) {
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
    this.seeking = true;

    const video = this.videoElement;
    video.src = segment.videoUrl;

    await new Promise<void>((resolve, reject) => {
      const onLoaded = () => {
        video.currentTime = segment.startTime;
      };

      const onSeeked = () => {
        cleanup();
        this.seeking = false;
        video
          .play()
          .then(resolve)
          .catch(reject);
      };

      const onError = () => {
        cleanup();
        reject(new Error(`Failed to load segment: ${segment.label}`));
      };

      const cleanup = () => {
        video.removeEventListener("loadedmetadata", onLoaded);
        video.removeEventListener("seeked", onSeeked);
        video.removeEventListener("error", onError);
      };

      video.addEventListener("loadedmetadata", onLoaded, { once: true });
      video.addEventListener("seeked", onSeeked, { once: true });
      video.addEventListener("error", onError, { once: true });
    });

    this.status = "playing";
    this.currentSegmentEndTime = segment.endTime;
    this.startProgressLoop();
    this.emit();

    await this.waitForSegmentEnd(segment.endTime);
    await this.advanceToNext();
  }

  private waitForSegmentEnd(endTime: number): Promise<void> {
    return new Promise<void>((resolve) => {
      if (!this.videoElement) {
        resolve();
        return;
      }

      const video = this.videoElement;

      const onTimeUpdate = () => {
        if (video.currentTime >= endTime - 0.05) {
          cleanup();
          resolve();
        }
      };

      const onEnded = () => {
        cleanup();
        resolve();
      };

      const cleanup = () => {
        video.removeEventListener("timeupdate", onTimeUpdate);
        video.removeEventListener("ended", onEnded);
      };

      video.addEventListener("timeupdate", onTimeUpdate);
      video.addEventListener("ended", onEnded);
    });
  }

  private async advanceToNext() {
    if (this.status !== "playing") return;

    const nextIndex = this.currentIndex + 1;
    if (nextIndex >= this.segments.length) {
      this.stopProgressLoop();
      this.currentSegmentEndTime = null;
      this.status = "ended";
      this.emit();
      return;
    }

    try {
      await this.playSegment(nextIndex);
    } catch (error) {
      this.stopProgressLoop();
      this.currentSegmentEndTime = null;
      this.status = "error";
      this.errorMessage = error instanceof Error ? error.message : "Segment playback failed.";
      this.emit();
    }
  }

  private startProgressLoop() {
    this.stopProgressLoop();
    const tick = () => {
      if (this.status === "playing") {
        this.emit();
      }
      this.progressRafId = requestAnimationFrame(tick);
    };
    this.progressRafId = requestAnimationFrame(tick);
  }

  private stopProgressLoop() {
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
