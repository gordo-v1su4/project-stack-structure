"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import type { H3StillImage } from "@/lib/h3StillJobStore";
import type { AnimaticShot } from "./stillAnimatic";
import { AnimaticTimingCard, animaticShotColor } from "./AnimaticShotIdentity";
import { mediaThumbnailUrl } from "./mediaThumbnailUrl";

/** Only nearby cards request a small viewing derivative, never the source PNG. */
export function AnimaticShotThumbnail({ shot, fps, image, selected, onSelect }: {
  shot: AnimaticShot; fps: number; image?: H3StillImage; selected: boolean; onSelect: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const element = useRef<HTMLLIElement>(null);
  const [visible, setVisible] = useState(false);
  const [failedUrl, setFailedUrl] = useState("");
  const src = image ? mediaThumbnailUrl(image) : "";
  useEffect(() => {
    const observer = new IntersectionObserver(entries => setVisible(entries.some(entry => entry.isIntersecting)), { rootMargin: "120px" });
    if (element.current) observer.observe(element.current);
    return () => observer.disconnect();
  }, []);
  return <li ref={element} className="min-w-0"><button type="button" onClick={onSelect} aria-pressed={selected}
    aria-label={`${shot.id}: ${shot.title} · ${((shot.endFrame - shot.startFrame) / fps).toFixed(2)} seconds`}
    title={shot.title}
    className={`block w-full overflow-hidden rounded-md border text-left focus-visible:outline-2 focus-visible:outline-accent ${selected ? "border-accent" : "border-line"}`}>
    <div className="relative aspect-video overflow-hidden" style={{ backgroundColor: animaticShotColor(shot.id) }}>
      {image && visible && failedUrl !== src ? <>
        {/* eslint-disable-next-line @next/next/no-img-element -- authenticated bounded viewing derivative */}
        <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailedUrl(src)} className="h-full w-full object-contain" />
        <span className="absolute bottom-1 left-1 rounded-sm border-l-4 bg-ink-0/90 px-1.5 py-0.5 font-mono text-xs text-fg-0"
          style={{ borderLeftColor: animaticShotColor(shot.id) }}>{shot.id}</span>
      </> : <AnimaticTimingCard shot={shot} fps={fps} compact />}
    </div>
    <div className="flex items-center justify-between gap-2 px-2 py-1 font-mono text-xs text-fg-3">
      <span>{((shot.endFrame - shot.startFrame) / fps).toFixed(2)}s</span>
      <span className="truncate">{failedUrl === src && src ? "Preview unavailable" : image ? "Image ready" : shot.record ? "Requested" : "Timing"}</span>
    </div>
  </button></li>;
}
