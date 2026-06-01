/**
 * Frame / timecode math. All numeric display in the UI is mono + tabular-nums,
 * and timecodes are SMPTE-style HH:MM:SS:FF based on the asset's fps.
 */

const STANDARD_FPS = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60];

/** Snap a measured fps to the nearest broadcast-standard rate. */
export function normalizeFps(measured: number): number {
  if (!Number.isFinite(measured) || measured <= 0) return 30;
  let best = STANDARD_FPS[0];
  let bestDelta = Infinity;
  for (const f of STANDARD_FPS) {
    const d = Math.abs(f - measured);
    if (d < bestDelta) {
      bestDelta = d;
      best = f;
    }
  }
  return best;
}

export function timeToFrame(time: number, fps: number): number {
  return Math.round(time * fps);
}

export function frameToTime(frame: number, fps: number): number {
  return frame / fps;
}

const pad = (n: number, w = 2) => String(Math.max(0, Math.floor(n))).padStart(w, "0");

/** seconds -> "HH:MM:SS:FF" */
export function timeToTimecode(seconds: number, fps: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const totalFrames = Math.round(seconds * fps);
  const fpsInt = Math.round(fps);
  const ff = totalFrames % fpsInt;
  const totalSecs = Math.floor(totalFrames / fpsInt);
  const ss = totalSecs % 60;
  const mm = Math.floor(totalSecs / 60) % 60;
  const hh = Math.floor(totalSecs / 3600);
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}:${pad(ff)}`;
}

/** seconds -> "MM:SS" for compact rows. */
export function timeToClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const ss = Math.floor(seconds % 60);
  const mm = Math.floor(seconds / 60);
  return `${pad(mm)}:${pad(ss)}`;
}

export function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
