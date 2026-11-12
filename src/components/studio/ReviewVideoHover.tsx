"use client";
import { useEffect, useRef, useState, type ReactNode, type ButtonHTMLAttributes, type FocusEvent } from "react";
import { createPortal } from "react-dom";
import type { PreparedReviewVideo } from "@/lib/preparedReviewVideoStore";
import { canStartPassiveMediaPlayback, registerPassiveMediaPlayback } from "./mediaPlaybackOwnership";
import { hoverPreview, loadHoverReviewVideo, reviewArtifactUrl, reviewProxyWindow } from "./reviewHoverPreview";
import { useReviewPoster } from "./useReviewPoster";

/** Video waits for dwell; optional visible posters use bounded read-only lookups. */
export function ReviewVideoHover({ videoUrl, start = 0, end, children, className = "", showStatus = true, buttonProps, hideChildrenWhenReady = false, floating = false, contextKey, previewLabel, posterWhenVisible = false }: {
  videoUrl: string; start?: number; end?: number; children: ReactNode; className?: string; showStatus?: boolean;
  buttonProps?: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "className" | "onPointerEnter" | "onPointerLeave" | "onFocusCapture" | "onBlurCapture">;
  hideChildrenWhenReady?: boolean;
  floating?: boolean; contextKey?: string; previewLabel?: string;
  posterWhenVisible?: boolean;
}) {
  const owner = useRef({}), root = useRef<HTMLElement>(null), video = useRef<HTMLVideoElement>(null), stop = useRef<() => void>(() => {});
  const [hovered, setHovered] = useState(false), [focused, setFocused] = useState(false);
  const [result, setResult] = useState<{ url: string; value: PreparedReviewVideo } | null>(null), [status, setStatus] = useState("");
  const [anchor, setAnchor] = useState<{ left: number; top: number; width: number } | null>(null);
  const prepared = result?.url === videoUrl ? result.value : null;
  const { poster, remember } = useReviewPoster(videoUrl, posterWhenVisible, root);
  const wanted = hovered || focused;
  useEffect(() => {
    if (!wanted || !videoUrl) return;
    const controller = new AbortController();
    const reset = () => {
      controller.abort();
      if (video.current) { video.current.pause(); video.current.removeAttribute("src"); video.current.load(); }
      setResult(null); setStatus(""); setAnchor(null);
    };
    stop.current = reset;
    const release = hoverPreview.claim(owner.current, reset);
    const pause = () => reset();
    const visibility = () => { if (document.hidden) reset(); };
    const focusChanged = (event: globalThis.FocusEvent) => { if (!root.current?.contains(event.target as Node)) reset(); };
    window.addEventListener("blur", pause); window.addEventListener("pagehide", pause);
    window.addEventListener("resize", pause); document.addEventListener("scroll", pause, true);
    document.addEventListener("visibilitychange", visibility);
    document.addEventListener("focusin", focusChanged);
    const timer = setTimeout(() => {
      if (controller.signal.aborted || !hoverPreview.owns(owner.current)) return;
      if (!canStartPassiveMediaPlayback()) { setStatus("Song playback active"); return; }
      if (floating && root.current) {
        const rect = root.current.getBoundingClientRect(), width = Math.min(320, window.innerWidth - 16), height = width * 9 / 16;
        setAnchor({ left: Math.max(8, Math.min(window.innerWidth - width - 8, rect.left + rect.width / 2 - width / 2)),
          top: rect.bottom + height + 16 <= window.innerHeight ? rect.bottom + 8 : Math.max(8, rect.top - height - 8), width });
      }
      setStatus("Loading preview");
      void loadHoverReviewVideo(videoUrl, window.location.origin, controller.signal, () => { if (!controller.signal.aborted) setStatus("Preparing preview"); }).then(value => {
        if (controller.signal.aborted) return;
        if (!canStartPassiveMediaPlayback()) { setStatus("Song playback active"); return; }
        if (value) remember(value);
        setResult(value ? { url: videoUrl, value } : null); setStatus(value ? "Preview ready" : "Preview not ready · inspect clip");
      }).catch(() => { if (!controller.signal.aborted) setStatus("Preview unavailable · inspect clip"); });
    }, 280);
    return () => {
      clearTimeout(timer); reset(); release();
      window.removeEventListener("blur", pause); window.removeEventListener("pagehide", pause); document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("resize", pause); document.removeEventListener("scroll", pause, true);
      document.removeEventListener("focusin", focusChanged);
    };
  }, [wanted, videoUrl, floating, contextKey, remember]);

  useEffect(() => {
    const element = video.current;
    if (!prepared || !element) return;
    const range = reviewProxyWindow(prepared.metadata, start, end);
    if (!range) return;
    const release = registerPassiveMediaPlayback(element, () => stop.current());
    let disposed = false;
    const play = () => {
      if (disposed || !hoverPreview.owns(owner.current)) return;
      element.currentTime = range.start;
      void element.play().catch(() => { if (!disposed && hoverPreview.owns(owner.current)) setStatus("Preview ready · inspect clip"); });
    };
    const loop = () => { if (!disposed && element.currentTime >= range.end - 0.015) play(); };
    const error = () => { if (!disposed) { element.pause(); setStatus("Preview unavailable · inspect clip"); } };
    const playing = () => { if (!disposed && hoverPreview.owns(owner.current)) setStatus("Silent preview"); };
    element.muted = true;
    element.addEventListener("loadedmetadata", play); element.addEventListener("timeupdate", loop); element.addEventListener("ended", play); element.addEventListener("error", error);
    element.addEventListener("playing", playing);
    element.src = reviewArtifactUrl(prepared, "proxy"); element.load();
    return () => {
      disposed = true; release(); element.pause(); element.removeAttribute("src"); element.load();
      element.removeEventListener("loadedmetadata", play); element.removeEventListener("timeupdate", loop); element.removeEventListener("ended", play); element.removeEventListener("error", error);
      element.removeEventListener("playing", playing);
    };
  }, [prepared, start, end]);

  const handlers = { onPointerEnter: () => setHovered(true), onPointerLeave: () => setHovered(false),
    onFocusCapture: (event: FocusEvent<HTMLElement>) => setFocused(event.target instanceof HTMLElement && event.target.matches(":focus-visible")),
    onBlurCapture: (event: FocusEvent<HTMLElement>) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false); } };
  const displayStatus = prepared && !reviewProxyWindow(prepared.metadata, start, end) ? "Trim unavailable · inspect clip" : status;
  const player = prepared ? <video ref={video} muted playsInline preload="none" aria-hidden className="pointer-events-none absolute inset-0 h-full w-full bg-ink-0 object-contain" poster={reviewArtifactUrl(prepared, "poster")} /> : null;
  const floatingPreview = floating && anchor && status ? createPortal(<span aria-hidden className="pointer-events-none overflow-hidden rounded-md border border-line-2 bg-ink-0 shadow-lg"
    style={{ position: "fixed", zIndex: 80, ...anchor, aspectRatio: "16 / 9" }}>
    {player}<span className="absolute inset-x-0 bottom-0 truncate bg-ink-0/85 px-2 py-1 text-xs text-fg-1">{previewLabel ? `${previewLabel} · ` : ""}{displayStatus}</span>
  </span>, document.body) : null;
  const content = <>
    {poster ? (
      // eslint-disable-next-line @next/next/no-img-element -- authenticated prepared WebP only
      <img src={reviewArtifactUrl(poster, "poster")} alt="" loading="lazy" decoding="async" className="pointer-events-none absolute inset-0 h-full w-full object-contain" />
    ) : null}
    {floating ? floatingPreview : player}
    {!(prepared || poster) || !hideChildrenWhenReady ? children : null}
    {showStatus && displayStatus ? <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-ink-0/85 px-1 py-0.5 text-[10px] text-fg-2">{displayStatus}</span> : null}
  </>;
  return buttonProps ? <button {...buttonProps} {...handlers} ref={element => { root.current = element; }} className={`overflow-hidden ${className}`}>{content}</button>
    : <span {...handlers} ref={element => { root.current = element; }} className={`relative block overflow-hidden ${className}`}>{content}</span>;
}
