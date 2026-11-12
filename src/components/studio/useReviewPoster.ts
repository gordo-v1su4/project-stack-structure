"use client";
import { useCallback, useEffect, useState, type RefObject } from "react";
import type { PreparedReviewVideo } from "@/lib/preparedReviewVideoStore";
import { lookupVisibleReviewPoster } from "./reviewPosterRequests";

export function useReviewPoster(videoUrl: string, enabled: boolean, root: RefObject<HTMLElement | null>) {
  const [result, setResult] = useState<{ url: string; value: PreparedReviewVideo } | null>(null);
  const poster = result?.url === videoUrl ? result.value : null;
  const remember = useCallback((value: PreparedReviewVideo) => {
    if (enabled) setResult({ url: videoUrl, value });
  }, [enabled, videoUrl]);
  useEffect(() => {
    if (!enabled || !videoUrl || poster || !root.current) return;
    let controller: AbortController | null = null, requested = false, disposed = false;
    const visible = (inside: boolean) => {
      if (disposed) return;
      if (!inside) { controller?.abort(); requested = false; return; }
      if (requested) return;
      requested = true;
      const current = new AbortController(); controller = current;
      void lookupVisibleReviewPoster(videoUrl, window.location.origin, current.signal).then(value => {
        if (!current.signal.aborted && value) remember(value);
      }).catch(() => { /* The labeled placeholder and explicit inspection remain available. */ });
    };
    if (typeof IntersectionObserver === "undefined") { visible(true); return () => { disposed = true; controller?.abort(); }; }
    const observer = new IntersectionObserver(entries => { for (const entry of entries) visible(entry.isIntersecting); }, { rootMargin: "120px" });
    observer.observe(root.current);
    return () => { disposed = true; controller?.abort(); observer.disconnect(); };
  }, [enabled, videoUrl, poster, root, remember]);
  return { poster, remember };
}
