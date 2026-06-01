"use client";

import { useEffect } from "react";

type RVFCVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (
    cb: (now: number, meta: { mediaTime: number }) => void
  ) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

/**
 * Drive a per-frame callback off requestVideoFrameCallback when available,
 * falling back to rAF. Used to keep the viewer store's currentTime in sync at
 * frame granularity while the video plays.
 */
export function useVideoFrame(
  video: HTMLVideoElement | null,
  onFrame: (mediaTime: number) => void,
  active: boolean
) {
  useEffect(() => {
    if (!video || !active) return;
    const v = video as RVFCVideo;
    let handle = 0;
    let rafId = 0;
    let stopped = false;

    if (v.requestVideoFrameCallback) {
      const tick = (_now: number, meta: { mediaTime: number }) => {
        if (stopped) return;
        onFrame(meta.mediaTime);
        handle = v.requestVideoFrameCallback!(tick);
      };
      handle = v.requestVideoFrameCallback(tick);
      return () => {
        stopped = true;
        v.cancelVideoFrameCallback?.(handle);
      };
    }

    const rafTick = () => {
      if (stopped) return;
      onFrame(video.currentTime);
      rafId = requestAnimationFrame(rafTick);
    };
    rafId = requestAnimationFrame(rafTick);
    return () => {
      stopped = true;
      cancelAnimationFrame(rafId);
    };
  }, [video, onFrame, active]);
}
