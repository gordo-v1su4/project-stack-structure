"use client";
import { useCallback, useEffect, useState, type RefObject } from "react";
import type { PreparedReviewVideo } from "@/lib/preparedReviewVideoStore";
import { lookupVisibleReviewPoster, ReviewPosterQueueFullError } from "./reviewPosterRequests";
import { reviewVideoReference } from "./reviewHoverPreview";
import { subscribeReviewPoster, type ReviewPosterArrival } from "./reviewPosterArrivals";

export function useReviewPoster(videoUrl: string, enabled: boolean, root: RefObject<HTMLElement | null>) {
  const [result, setResult] = useState<{ url: string; value: ReviewPosterArrival } | null>(null);
  const poster = result?.url === videoUrl ? result.value : null;
  const remember = useCallback((value: PreparedReviewVideo) => {
    if (enabled) setResult({ url: videoUrl, value: { bucket: value.source.bucket, objectKey: value.source.objectKey, posterKey: value.artifacts.poster } });
  }, [enabled, videoUrl]);
  useEffect(() => {
    if (!enabled || !videoUrl || !root.current) return;
    let controller: AbortController | null = null, requested = false, disposed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe: (() => void) | undefined;
    const visible = (inside: boolean) => {
      if (disposed) return;
      if (!inside) { clearTimeout(retry); controller?.abort(); requested = false; unsubscribe?.(); unsubscribe = undefined; return; }
      const source = reviewVideoReference(videoUrl, window.location.origin);
      if (!unsubscribe && source) unsubscribe = subscribeReviewPoster(source, value => { if (!disposed) setResult({ url: videoUrl, value }); });
      if (poster) return;
      if (requested) return;
      requested = true;
      const current = new AbortController(); controller = current;
      void lookupVisibleReviewPoster(videoUrl, window.location.origin, current.signal).then(value => {
        if (!current.signal.aborted && value) remember(value);
      }).catch(error => {
        // A full-song strip can contain >64 visible cuts. Capacity is bounded,
        // but a visible cut must not be permanently dropped by that bound.
        if (error instanceof ReviewPosterQueueFullError && !current.signal.aborted && !disposed) {
          retry = setTimeout(() => { requested = false; visible(true); }, 500);
        }
        // Missing/failed derivatives retain the placeholder and explicit inspection.
      });
    };
    if (typeof IntersectionObserver === "undefined") { visible(true); return () => { disposed = true; clearTimeout(retry); controller?.abort(); unsubscribe?.(); }; }
    const observer = new IntersectionObserver(entries => { for (const entry of entries) visible(entry.isIntersecting); }, { rootMargin: "120px" });
    observer.observe(root.current);
    return () => { disposed = true; clearTimeout(retry); controller?.abort(); unsubscribe?.(); observer.disconnect(); };
  }, [enabled, videoUrl, poster, root, remember]);
  return { poster, remember };
}
