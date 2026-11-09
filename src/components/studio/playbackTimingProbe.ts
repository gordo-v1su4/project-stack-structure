import { activatePlaybackTiming, PlaybackTimingRecording, PLAYBACK_TIMING_WINDOW_MS, releasePlaybackTiming, type PlaybackTimingAction, type PlaybackTimingObservation } from "./playbackTiming";

export function playbackTimingOptedIn(search: string) { return new URLSearchParams(search).get("playbackTiming") === "1"; }

/** Install only for the explicit query opt-in. No automatic start or media actions. */
export function installPlaybackTimingProbe(window: Window & typeof globalThis, controls: { start: HTMLButtonElement; finish: HTMLButtonElement; status: HTMLElement; output: HTMLElement }) {
  if (!playbackTimingOptedIn(window.location.search)) return () => {};
  const { start, finish, status, output } = controls;
  let cleanupRecording: (() => void) | null = null;
  output.textContent = JSON.stringify({ version: 1, state: "armed", observationWindowMs: PLAYBACK_TIMING_WINDOW_MS });
  finish.disabled = true;

  const begin = () => {
    if (cleanupRecording) return; // An active window cannot be extended by another Start.
    const recording = new PlaybackTimingRecording(() => window.performance.now());
    activatePlaybackTiming(recording);
    const frames = new Set<number>();
    const observers: Array<{ observer: PerformanceObserver; collect: (entries: PerformanceEntry[]) => PlaybackTimingObservation[] }> = [];
    let frameSamples = 0;
    start.disabled = true;
    finish.disabled = false;
    status.textContent = "Recording for at most 20 seconds. The probe does not start playback.";
    output.textContent = JSON.stringify({ version: 1, state: "recording", observationWindowMs: PLAYBACK_TIMING_WINDOW_MS, startedAtMs: recording.startedAtMs, deadlineMs: recording.deadlineMs });

    const normalizeTimestamp = (value: number) => {
      if (!Number.isFinite(value) || value < 0) return undefined;
      const now = window.performance.now();
      // Some engines use an epoch event timestamp; convert it to the page clock.
      const normalized = value > now + 60_000 ? value - window.performance.timeOrigin : value;
      return Number.isFinite(normalized) && normalized >= 0 && normalized <= now + 1 ? normalized : undefined;
    };
    const actionOf = (target: EventTarget | null): PlaybackTimingAction | undefined => {
      if (!(target instanceof window.Element)) return undefined;
      const action = target.closest("[data-playback-action]")?.getAttribute("data-playback-action");
      return action === "toggle" || action === "stop" || action === "rewind" ? action : undefined;
    };
    const sampleFrames = (action: PlaybackTimingAction) => {
      if (frameSamples++ >= 8 || !recording.recording) return;
      const first = window.requestAnimationFrame(() => {
        frames.delete(first);
        if (!recording.recording) return;
        recording.mark("next-frame", { action }); // rAF runs before rendering: not proof of paint completion.
        const second = window.requestAnimationFrame(() => {
          frames.delete(second);
          recording.mark("following-frame", { action });
        });
        frames.add(second);
      });
      frames.add(first);
    };
    const onInput = (event: Event) => {
      if (!recording.recording) return;
      let action = actionOf(event.target);
      if (event.type === "keydown") {
        const key = event as KeyboardEvent;
        if (key.altKey || key.ctrlKey || key.metaKey || key.repeat) return;
        if (event.target instanceof window.Element && event.target.closest("input, textarea, select, [contenteditable='true']")) return;
        action = key.key === " " ? "toggle" : key.key === "k" || key.key === "K" ? "stop" : undefined;
      }
      if (!action) return;
      recording.mark("input-capture", { action, event: event.type as "click" | "pointerdown" | "keydown", eventStartMs: normalizeTimestamp(event.timeStamp) });
      if (event.type !== "pointerdown") sampleFrames(action);
    };
    const onMedia = (event: Event) => {
      const target = event.target;
      if (!(target instanceof window.HTMLMediaElement)) return;
      const role = target.getAttribute("data-master-audio") === "true" ? "master-audio" : target.tagName === "VIDEO" ? "video" : "audio";
      recording.mark("media-event", { role, event: event.type as "playing" | "pause" | "waiting" | "stalled", paused: target.paused, eventStartMs: normalizeTimestamp(event.timeStamp) });
    };
    for (const type of ["pointerdown", "click", "keydown"]) window.document.addEventListener(type, onInput, true);
    for (const type of ["playing", "pause", "waiting", "stalled"]) window.document.addEventListener(type, onMedia, true);

    const Observer = (window as Window & { PerformanceObserver?: typeof PerformanceObserver }).PerformanceObserver;
    for (const type of ["event", "longtask"] as const) {
      if (!Observer?.supportedEntryTypes?.includes(type)) { recording.unsupported(type); continue; }
      try {
        const collect = (entries: PerformanceEntry[]) => {
          const observations: PlaybackTimingObservation[] = [];
          for (const entry of entries.slice(0, 256)) {
            if (entry.startTime < recording.startedAtMs || entry.startTime > recording.deadlineMs) continue;
            let observation: PlaybackTimingObservation | undefined;
            if (type === "longtask") observation = { phase: "long-task", detail: { eventStartMs: entry.startTime, durationMs: entry.duration } };
            else {
              if (!["pointerdown", "click", "keydown"].includes(entry.name)) continue;
              const timing = entry as PerformanceEventTiming & { interactionId?: number };
              const action = actionOf(timing.target);
              if (action) observation = { phase: "event-timing", detail: { action, event: entry.name as "pointerdown" | "click" | "keydown", eventStartMs: entry.startTime, durationMs: entry.duration,
                processingStartMs: timing.processingStart, processingEndMs: timing.processingEnd, interactionId: timing.interactionId } };
            }
            if (!observation) continue;
            observations.push(observation);
          }
          return observations;
        };
        const observer = new Observer(list => {
          if (!cleanupRecording) return;
          const observations = collect(list.getEntries());
          for (let index = 0; index < observations.length; index++) {
            const observation = observations[index];
            if (recording.mark(observation.phase, observation.detail)) continue;
            // Observer delivery can beat a delayed deadline timer. Finish now
            // with the consumed batch instead of losing its in-window entries.
            end("deadline", observations.slice(index));
            break;
          }
        });
        observer.observe(type === "event" ? { type, buffered: true, durationThreshold: 16 } as PerformanceObserverInit : { type, buffered: true });
        observers.push({ observer, collect });
      } catch { recording.unsupported(type); }
    }

    const finishHandler = () => end("manual");
    const end = (reason: "deadline" | "manual" | "unmount", delivered: readonly PlaybackTimingObservation[] = []) => {
      if (!cleanupRecording) return;
      cleanupRecording = null;
      finish.removeEventListener("click", finishHandler);
      window.clearTimeout(timer);
      for (const frame of frames) window.cancelAnimationFrame(frame);
      const pendingObservations = [...delivered];
      for (const { observer, collect } of observers) {
        try { pendingObservations.push(...collect(observer.takeRecords())); } catch { /* No arbitrary observer errors enter the report. */ }
        observer.disconnect();
      }
      for (const type of ["pointerdown", "click", "keydown"]) window.document.removeEventListener(type, onInput, true);
      for (const type of ["playing", "pause", "waiting", "stalled"]) window.document.removeEventListener(type, onMedia, true);
      recording.finish(reason, pendingObservations);
      releasePlaybackTiming(recording);
      // Publish once, after the measured actions. No per-event DOM/React updates.
      output.textContent = JSON.stringify(recording.snapshot());
      status.textContent = "Capture complete. rAF markers show frame opportunities, not proven paint completion. Automation roundtrip is separate.";
      start.disabled = false;
      finish.disabled = true;
    };
    finish.addEventListener("click", finishHandler);
    cleanupRecording = () => end("unmount");
    const timer = window.setTimeout(() => end("deadline"), PLAYBACK_TIMING_WINDOW_MS);
  };
  start.addEventListener("click", begin);
  return () => {
    cleanupRecording?.();
    start.removeEventListener("click", begin);
  };
}
