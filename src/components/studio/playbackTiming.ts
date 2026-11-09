export const PLAYBACK_TIMING_WINDOW_MS = 20_000;
export const PLAYBACK_TIMING_RECORD_LIMIT = 256;

const PHASES = ["window-start", "window-end", "input-capture", "handler-entry", "handler-return", "native-pause-call",
  "native-pause-return", "player-pause-entry", "player-pause-return", "player-stop-entry", "player-stop-return",
  "group-state", "media-event", "next-frame", "following-frame", "event-timing", "long-task"] as const;
const ACTIONS = ["toggle", "stop", "rewind"] as const;
const ROLES = ["active-video", "standby-video", "master-audio", "video", "audio"] as const;
const EVENTS = ["pointerdown", "click", "keydown", "playing", "pause", "waiting", "stalled"] as const;
export type PlaybackTimingPhase = typeof PHASES[number];
export type PlaybackTimingAction = typeof ACTIONS[number];
type PlaybackTimingRole = typeof ROLES[number];
export type PlaybackTimingDetail = {
  action?: PlaybackTimingAction;
  role?: PlaybackTimingRole;
  event?: typeof EVENTS[number];
  paused?: boolean;
  allPaused?: boolean;
  mediaCount?: number;
  eventStartMs?: number;
  processingStartMs?: number;
  processingEndMs?: number;
  durationMs?: number;
  interactionId?: number;
};
export type PlaybackTimingObservation = { phase: "event-timing" | "long-task"; detail: PlaybackTimingDetail };
type Entry = PlaybackTimingDetail & { sequence: number; phase: PlaybackTimingPhase; atMs: number; delivery?: "finish-drain" };
type FinishReason = "deadline" | "manual" | "unmount";

/** Local, scalar-only data. All times use the same page performance.now() clock. */
export class PlaybackTimingRecording {
  readonly startedAtMs: number;
  readonly deadlineMs: number;
  private entries: Entry[] = [];
  private sequence = 0;
  private droppedRecords = 0;
  private finishedAtMs: number | null = null;
  private finishReason: FinishReason | null = null;
  private unsupportedObservers = new Set<"event" | "longtask">();
  private milestones = { transportInput: false, transportHandler: false, playerPause: false, nativePause: false, allPausedGroup: false, frameOpportunity: false };

  constructor(private clock: () => number) {
    this.startedAtMs = clock();
    this.deadlineMs = this.startedAtMs + PLAYBACK_TIMING_WINDOW_MS;
    this.mark("window-start");
  }

  get recording() { return this.finishedAtMs === null && this.clock() <= this.deadlineMs; }

  mark(phase: PlaybackTimingPhase, detail: PlaybackTimingDetail = {}) {
    const atMs = this.clock();
    if (this.finishedAtMs !== null || atMs > this.deadlineMs || !PHASES.includes(phase)) return false;
    this.append(phase, detail, atMs);
    return true;
  }

  private append(phase: PlaybackTimingPhase, detail: PlaybackTimingDetail, atMs: number, delivery?: "finish-drain") {
    const entry: Entry = { sequence: ++this.sequence, phase, atMs, ...(delivery ? { delivery } : {}) };
    // Never copy caller objects, DOM nodes, URLs, arbitrary names or content.
    if (ACTIONS.includes(detail.action!)) entry.action = detail.action;
    if (ROLES.includes(detail.role!)) entry.role = detail.role;
    if (EVENTS.includes(detail.event!)) entry.event = detail.event;
    if (typeof detail.paused === "boolean") entry.paused = detail.paused;
    if (typeof detail.allPaused === "boolean") entry.allPaused = detail.allPaused;
    for (const key of ["mediaCount", "eventStartMs", "processingStartMs", "processingEndMs", "durationMs", "interactionId"] as const) {
      const value = detail[key];
      if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER) entry[key] = value;
    }
    if (this.entries.length === PLAYBACK_TIMING_RECORD_LIMIT) { this.entries.shift(); this.droppedRecords++; }
    this.entries.push(entry);
    if (phase === "input-capture") this.milestones.transportInput = true;
    if (phase === "handler-entry") this.milestones.transportHandler = true;
    if (phase === "player-pause-entry") this.milestones.playerPause = true;
    if (phase === "native-pause-return") this.milestones.nativePause = true;
    if (phase === "group-state" && entry.allPaused) this.milestones.allPausedGroup = true;
    if (phase === "next-frame" || phase === "following-frame") this.milestones.frameOpportunity = true;
  }

  unsupported(type: "event" | "longtask") { this.unsupportedObservers.add(type); }

  finish(reason: FinishReason, pendingObservations: readonly PlaybackTimingObservation[] = []) {
    if (this.finishedAtMs !== null) return;
    this.mark("window-end");
    this.finishedAtMs = this.clock();
    this.finishReason = reason;
    const cutoff = Math.min(this.finishedAtMs, this.deadlineMs);
    // Only the two bounded observer queues may arrive after the deadline. A
    // blocking task can delay teardown; its original start still belongs to
    // this window. Ordinary hooks and later callbacks remain closed.
    for (const observation of pendingObservations.slice(0, PLAYBACK_TIMING_RECORD_LIMIT * 2)) {
      const start = observation.detail.eventStartMs;
      if ((observation.phase !== "event-timing" && observation.phase !== "long-task")
        || typeof start !== "number" || !Number.isFinite(start)
        || start < this.startedAtMs || start > cutoff) continue;
      this.append(observation.phase, observation.detail, this.finishedAtMs, "finish-drain");
    }
  }

  snapshot() {
    return {
      version: 1, clock: "page-performance-now-ms", mediaScope: "current-document", groupScope: "player-owned-media", observationWindowMs: PLAYBACK_TIMING_WINDOW_MS,
      atMsMeaning: "observed-at", observerEntryWindow: "startedAtMs..observationEndMs",
      startedAtMs: this.startedAtMs, deadlineMs: this.deadlineMs,
      observationEndMs: this.finishedAtMs === null ? null : Math.min(this.finishedAtMs, this.deadlineMs),
      finishedAtMs: this.finishedAtMs, finishReason: this.finishReason,
      state: this.finishedAtMs === null ? "recording" : "complete",
      recordLimit: PLAYBACK_TIMING_RECORD_LIMIT, droppedRecords: this.droppedRecords,
      unsupportedObservers: [...this.unsupportedObservers],
      milestones: Object.fromEntries(Object.entries(this.milestones).map(([name, captured]) => [name, captured ? "captured" : "not-captured"])),
      records: this.entries.map(entry => ({ ...entry })),
    };
  }
}

let activeRecording: PlaybackTimingRecording | null = null;

export function activatePlaybackTiming(recording: PlaybackTimingRecording) { activeRecording = recording; }
export function releasePlaybackTiming(recording: PlaybackTimingRecording) { if (activeRecording === recording) activeRecording = null; }

export function markPlaybackTiming(phase: PlaybackTimingPhase, detail?: PlaybackTimingDetail) {
  activeRecording?.mark(phase, detail);
}

/** Calls the same native method exactly once, with no prototype patches or async boundary. */
export function pauseWithPlaybackTiming(element: { pause(): void; readonly paused: boolean }, role: PlaybackTimingRole) {
  const recording = activeRecording;
  if (!recording) { element.pause(); return; }
  recording.mark("native-pause-call", { role, paused: element.paused });
  element.pause();
  recording.mark("native-pause-return", { role, paused: element.paused });
}

export function markPlaybackGroupState(elements: Array<{ readonly paused: boolean } | null>) {
  if (!activeRecording) return;
  let mediaCount = 0, allPaused = true;
  for (const element of elements) if (element) { mediaCount++; allPaused = allPaused && element.paused; }
  activeRecording.mark("group-state", { mediaCount, allPaused });
}
