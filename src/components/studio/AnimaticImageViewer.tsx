"use client";

import { useEffect, useRef } from "react";
import type { H3StillImage } from "@/lib/h3StillJobStore";
import type { AnimaticShot } from "./stillAnimatic";
import { stillMediaUrl } from "./h3StillClient";
import { AnimaticTimingCard } from "./AnimaticShotIdentity";
import { Button } from "./ui";

/** Native modal focus/Escape handling; loads only the selected full-size image. */
export function AnimaticImageViewer({ shot, image, fps, position, count, onPrevious, onNext, onClose }: {
  shot: AnimaticShot; image?: H3StillImage; fps: number; position: number; count: number;
  onPrevious: () => void; onNext: () => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => { if (element?.open) element.close(); };
  }, []);
  return <dialog ref={dialog} aria-label={`${shot.id} image preview`} onCancel={onClose}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}
    onKeyDown={event => {
      if (event.key === "ArrowLeft") { event.preventDefault(); onPrevious(); }
      if (event.key === "ArrowRight") { event.preventDefault(); onNext(); }
    }}
    className="fixed inset-0 m-auto max-h-[calc(100dvh-1.5rem)] w-[calc(100vw-1.5rem)] max-w-6xl overflow-y-auto rounded-md border border-line bg-ink-0 p-3 text-fg-1 backdrop:bg-black/80 sm:p-5">
    <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-sm text-fg-0"><span className="font-mono">{shot.id}</span> · {shot.title}</h2>
        <p className="mt-1 text-xs text-fg-3">{shot.sceneId} · {(shot.startFrame / fps).toFixed(2)}–{(shot.endFrame / fps).toFixed(2)}s · {position + 1}/{count}</p></div>
      <div className="flex flex-wrap gap-2"><Button disabled={position === 0} onClick={onPrevious}>Previous image</Button>
        <Button disabled={position === count - 1} onClick={onNext}>Next image</Button><Button onClick={onClose}>Close image</Button></div>
    </header>
    {image ? <>
      {/* eslint-disable-next-line @next/next/no-img-element -- exact owned full-size still; one mounted image */}
      <img key={stillMediaUrl(image)} src={stillMediaUrl(image)} alt={`${shot.id}: ${shot.title}`} className="block max-h-[70dvh] w-full object-contain" />
    </> : <div className="aspect-video max-h-[70dvh]"><AnimaticTimingCard shot={shot} fps={fps} /></div>}
    <p className="mt-3 text-xs text-fg-3">{image ? "Saved image · pending review" : "Image not ready yet. It will appear here when saved."}</p>
    <details className="mt-3 text-sm"><summary className="cursor-pointer text-fg-2">Shot details</summary><p className="mt-2 text-fg-3">{shot.prompt}</p></details>
  </dialog>;
}
