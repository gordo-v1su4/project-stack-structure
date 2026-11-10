"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { animaticImage, animaticShotAtTime, type StillAnimaticPlan } from "./stillAnimatic";
import { stillMediaUrl } from "./h3StillClient";
import { fmt } from "./math";
import { Button } from "./ui";
import { acquireMediaPlaybackOwnership } from "./mediaPlaybackOwnership";

/** The unretimed master is the only clock. Retain only current/next image elements. */
export function StillAnimaticPreview({ plan, context, audioUrl, onClose }: {
  plan: StillAnimaticPlan; context: string; audioUrl: string; onClose: () => void;
}) {
  const audio = useRef<HTMLAudioElement>(null), [time, setTime] = useState(0), [playing, setPlaying] = useState(false);
  const [error, setError] = useState(""), [loaded, setLoaded] = useState("");
  const [imageFailure, setImageFailure] = useState<{ url: string; message: string } | null>(null);
  const picture = useRef<HTMLImageElement>(null), dialog = useRef<HTMLElement>(null);
  const shot = animaticShotAtTime(plan, time), index = plan.shots.indexOf(shot), next = plan.shots[index + 1];
  const images = useMemo(() => new Map(plan.shots.map(s => [s.id, animaticImage(plan, s, context)])), [plan, context]);
  const image = images.get(shot.id), nextImage = next ? images.get(next.id) : undefined;
  const url = image ? stillMediaUrl(image) : "", nextUrl = nextImage ? stillMediaUrl(nextImage) : "";
  const ready = [...images.values()].filter(Boolean).length;
  const stale = context !== plan.contextSha256;
  const visibleError = stale ? "Story, timing or references changed. Reopen the current animatic." : error || (imageFailure?.url === url ? imageFailure.message : "");
  useEffect(() => acquireMediaPlaybackOwnership(), []);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  useEffect(() => { const frame = requestAnimationFrame(() => { if (picture.current?.complete && picture.current.naturalWidth > 0) setLoaded(url); }); return () => cancelAnimationFrame(frame); }, [url]);
  useEffect(() => {
    const element = audio.current; let frame = 0;
    function update() {
      if (element) { setTime(Math.min(plan.masterDuration, element.currentTime)); if (element.currentTime >= plan.masterDuration) element.pause(); }
      frame = requestAnimationFrame(update);
    }
    frame = requestAnimationFrame(update);
    return () => { cancelAnimationFrame(frame); element?.pause(); };
  }, [plan.masterDuration]);
  useEffect(() => {
    if (stale) audio.current?.pause();
  }, [stale]);
  async function toggle() {
    const element = audio.current; if (!element) return;
    if (!element.paused) { element.pause(); return; }
    if (ready !== plan.shots.length || loaded !== url || !audioUrl || context !== plan.contextSha256) return;
    try { setError(""); if (element.ended || element.currentTime >= plan.masterDuration) element.currentTime = 0; await element.play(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "The master could not start."); }
  }
  function seek(value: number) { if (audio.current) audio.current.currentTime = value; setTime(value); }
  return <section ref={dialog} role="dialog" aria-modal="true" aria-label="Full-song animatic preview" className="fixed inset-0 z-50 flex min-w-0 flex-col gap-3 overflow-y-auto bg-ink-0 p-4 md:p-8"
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key === "Escape") { audio.current?.pause(); onClose(); }
      if (event.key === "Tab") {
        const elements = dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled),input:not(:disabled),[tabindex='0']");
        const first = elements?.[0], last = elements?.[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg text-fg-0">Animatic · Preview mode</h2>
      <p className="text-sm text-fg-3">{ready}/{plan.shots.length} images · original master · stills awaiting review</p></div>
      <Button type="button" className="rounded-md border border-line px-3 py-2 text-fg-1" onClick={() => { audio.current?.pause(); onClose(); }}>Close preview</Button></header>
    <div className="relative flex min-h-0 flex-1 items-center justify-center bg-ink-1">
      {url ? <>
        {/* eslint-disable-next-line @next/next/no-img-element -- exact owned still pixels; bounded two-image preview */}
        <img ref={picture} key={url} src={url} alt={`${shot.id}: ${shot.prompt}`} className="max-h-full max-w-full object-contain"
          onLoad={() => { setLoaded(url); setImageFailure(current => current?.url === url ? null : current); }} onError={() => { audio.current?.pause(); setImageFailure({ url, message: `Image ${shot.id} could not be read. Seek to another image or reopen preview to retry.` }); }} />
        {/* eslint-disable-next-line @next/next/no-img-element -- bounded next-frame preparation */}
        {nextUrl && nextUrl !== url ? <img key={nextUrl} src={nextUrl} alt="" aria-hidden="true" className="hidden" /> : null}
      </> : <p className="p-6 text-warn">{shot.id} · current image is missing or stale</p>}
      <span className="absolute bottom-3 left-3 rounded-sm bg-ink-0 px-2 py-1 font-mono text-xs text-fg-1">{shot.id} · {shot.title}</span>
    </div>
    {visibleError ? <p role="alert" className="text-sm text-danger">{visibleError}</p> : null}
    <audio ref={audio} src={audioUrl} preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { setTime(plan.masterDuration); setPlaying(false); }}
      onLoadedMetadata={() => { if (audio.current && audio.current.duration + 0.001 < plan.masterDuration) setError("The stored master ends before this animatic."); }}
      onError={() => setError("The original master audio could not be read.")} />
    <div className="flex flex-wrap items-center gap-3"><Button type="button" className="rounded-md border border-accent px-4 py-2 text-accent" disabled={!playing && (ready !== plan.shots.length || loaded !== url || !audioUrl || Boolean(visibleError))} onClick={() => void toggle()}>{playing ? "Pause" : "Play animatic"}</Button>
      <span className="font-mono text-xs text-fg-2">{fmt(time)} / {fmt(plan.masterDuration)}</span>
      <label className="min-w-24 flex-1"><span className="sr-only">Animatic song position</span><input aria-label="Animatic song position" type="range" min={0} max={plan.masterDuration} step={1 / plan.fps} value={time} className="w-full accent-accent" onChange={e => seek(Number(e.target.value))} /></label>
    </div>
    <p className="max-h-20 shrink-0 overflow-y-auto break-words text-xs text-fg-3">{shot.prompt}</p>
  </section>;
}
