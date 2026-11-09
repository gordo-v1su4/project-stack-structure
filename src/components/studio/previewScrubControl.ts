import type { BrowserPreviewPlayer, PreviewPlayerState } from "./previewPlayer";

export type ScrubPlayer = Pick<BrowserPreviewPlayer, "getState" | "subscribe" | "seekToTime">;

export function formatPreviewScrubTime(seconds: number): string {
  const time = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const hundredths = Math.round(time * 100);
  return `${Math.floor(hundredths / 6000)}:${((hundredths % 6000) / 100).toFixed(2).padStart(5, "0")}`;
}

/** DOM-only playback feedback: no per-frame React state or project writes. */
export function bindPreviewScrubControl(player: ScrubPlayer, input: HTMLInputElement, clock: HTMLElement, frames = {
  request: (callback: FrameRequestCallback) => requestAnimationFrame(callback),
  cancel: (id: number) => cancelAnimationFrame(id),
}): () => void {
  let pendingTime: number | null = null;
  let frame: number | null = null;
  let dragging = false;
  let disposed = false;
  const duration = (state: PreviewPlayerState) => Number.isFinite(state.totalDuration) ? Math.max(0, state.totalDuration) : 0;
  const clamp = (time: number, end: number) => Math.min(end, Math.max(0, Number.isFinite(time) ? time : 0));
  const render = (state: PreviewPlayerState) => {
    const end = duration(state);
    input.max = String(end || 1);
    input.disabled = end <= 0 || state.segmentCount === 0;
    const time = clamp(pendingTime ?? (dragging ? Number(input.value) : state.currentTime), end);
    if (!dragging && pendingTime === null) input.value = String(time);
    input.setAttribute("aria-valuetext", `${formatPreviewScrubTime(time)} of ${formatPreviewScrubTime(end)}`);
    clock.textContent = `${formatPreviewScrubTime(time)} / ${formatPreviewScrubTime(end)}`;
  };
  const flush = () => {
    if (frame !== null) frames.cancel(frame);
    frame = null;
    if (disposed || pendingTime === null) return;
    const time = pendingTime;
    pendingTime = null;
    // The engine owns play/pause intent and cancellation of older seek work.
    void player.seekToTime(time).catch(() => { if (!disposed) render(player.getState()); });
  };
  const onInput = () => {
    if (input.disabled) return;
    pendingTime = clamp(Number(input.value), duration(player.getState()));
    render(player.getState());
    if (frame === null) frame = frames.request(flush);
  };
  const finish = () => { dragging = false; flush(); if (!disposed) render(player.getState()); };
  const start = (event: Event) => {
    dragging = true;
    try { input.setPointerCapture((event as PointerEvent).pointerId); } catch { /* Native keyboard/input events still work without pointer capture. */ }
  };
  const listeners: Array<[string, EventListener]> = [
    ["input", onInput], ["pointerdown", start], ["change", finish],
    ["pointerup", finish], ["pointercancel", finish], ["lostpointercapture", finish], ["blur", finish],
  ];
  for (const [event, listener] of listeners) input.addEventListener(event, listener);
  const unsubscribe = player.subscribe(render);
  render(player.getState());
  return () => {
    disposed = true;
    if (frame !== null) frames.cancel(frame);
    pendingTime = null;
    unsubscribe();
    for (const [event, listener] of listeners) input.removeEventListener(event, listener);
  };
}
