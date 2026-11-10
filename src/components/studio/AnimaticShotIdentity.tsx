import type { AnimaticShot } from "./stillAnimatic";

/** A shot keeps its color across timing cards, thumbnails and footage labels. */
export function animaticShotColor(id: string) {
  const number = /^A(\d+)$/.exec(id)?.[1];
  const value = number ? Number(number) : [...id].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 360, 0);
  return `hsl(${value * 31 % 360} 45% 20%)`;
}

export function AnimaticTimingCard({ shot, fps, compact = false }: { shot: AnimaticShot; fps: number; compact?: boolean }) {
  return <div className="flex h-full w-full min-w-0 flex-col items-center justify-center gap-2 overflow-hidden p-3 text-center text-fg-0" style={{ backgroundColor: animaticShotColor(shot.id) }}>
    <span className={compact ? "font-mono text-xl" : "font-display text-[clamp(3rem,12vw,9rem)] leading-none"}>{shot.id}</span>
    {!compact ? <><span className="max-w-lg text-sm">{shot.title}</span><span className="font-mono text-xs">{((shot.endFrame - shot.startFrame) / fps).toFixed(2)}s · frames {shot.startFrame}–{shot.endFrame}</span></> : null}
  </div>;
}

/** View-only identity; this never changes or burns labels into exported pixels. */
export function AnimaticShotOverlay({ shot, fps, aboveControls = false }: { shot: AnimaticShot; fps: number; aboveControls?: boolean }) {
  return <div className={`pointer-events-none absolute ${aboveControls ? "bottom-16" : "bottom-3"} left-3 z-10 max-w-[calc(100%-1.5rem)] rounded-sm border-l-4 bg-ink-0/90 px-3 py-2 text-fg-0`} style={{ borderLeftColor: animaticShotColor(shot.id) }}>
    <p className="break-words text-sm"><span className="font-mono font-medium">{shot.id}</span> · {shot.title}</p>
    <p className="mt-1 font-mono text-xs text-fg-2">{shot.sceneId} · {(shot.startFrame / fps).toFixed(2)}–{(shot.endFrame / fps).toFixed(2)}s · frames {shot.startFrame}–{shot.endFrame}</p>
  </div>;
}
