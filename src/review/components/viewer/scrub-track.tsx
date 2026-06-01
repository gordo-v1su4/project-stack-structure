"use client";

import { useMemo, useRef, useState } from "react";
import { useViewerStore } from "@/review/lib/store/viewer-store";
import { useAssetStore } from "@/review/lib/store/asset-store";
import { useCommentStore } from "@/review/lib/store/comment-store";
import { timeToTimecode } from "@/review/lib/video/frame-utils";

export function ScrubTrack() {
  const trackRef = useRef<HTMLDivElement>(null);
  const currentTime = useViewerStore((s) => s.currentTime);
  const duration = useViewerStore((s) => s.duration);
  const fps = useViewerStore((s) => s.fps);
  const requestSeek = useViewerStore((s) => s.requestSeek);

  const asset = useAssetStore((s) =>
    s.assets.find((a) => a.id === s.activeAssetId)
  );
  const version = asset?.versions[asset.currentVersionIndex];
  const allComments = useCommentStore((s) => s.comments);
  const comments = useMemo(
    () =>
      version ? allComments.filter((c) => c.versionId === version.id) : [],
    [allComments, version]
  );

  const [dragging, setDragging] = useState(false);
  const [hoverTime, setHoverTime] = useState<number | null>(null);

  const pct = duration > 0 ? (currentTime / duration) * 100 : 0;

  function timeFromEvent(e: React.MouseEvent | MouseEvent): number {
    const el = trackRef.current;
    if (!el || duration <= 0) return 0;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min((e.clientX - rect.left) / rect.width, 1));
    return ratio * duration;
  }

  function startDrag(e: React.MouseEvent) {
    setDragging(true);
    requestSeek(timeFromEvent(e));
    const move = (ev: MouseEvent) => requestSeek(timeFromEvent(ev));
    const up = () => {
      setDragging(false);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  if (!version || version.duration === 0) return null;

  return (
    <div className="relative px-1 pt-3 pb-1">
      {/* hover tooltip */}
      {hoverTime != null && !dragging && (
        <div
          className="pointer-events-none absolute -top-1 z-10 -translate-x-1/2 rounded-[2px] border border-[var(--border)] bg-[var(--bg-inset-deep)] px-1.5 py-0.5 font-mono text-[9px] tabular-nums text-[var(--text-2)]"
          style={{ left: `${(hoverTime / duration) * 100}%` }}
        >
          {timeToTimecode(hoverTime, fps)}
        </div>
      )}

      <div
        ref={trackRef}
        onMouseDown={startDrag}
        onMouseMove={(e) => setHoverTime(timeFromEvent(e))}
        onMouseLeave={() => setHoverTime(null)}
        className="group relative h-[3px] cursor-pointer bg-[#1a1a1a]"
      >
        {/* played portion */}
        <div
          className="absolute inset-y-0 left-0 bg-[var(--accent)]"
          style={{ width: `${pct}%` }}
        />

        {/* scene cut ticks */}
        {asset?.scenes.map((scene) =>
          scene.startTime > 0 ? (
            <div
              key={scene.id}
              className="absolute top-1/2 h-[7px] w-[1px] -translate-y-1/2 bg-[var(--text-mut)]"
              style={{ left: `${(scene.startTime / duration) * 100}%` }}
            />
          ) : null
        )}

        {/* comment pins */}
        {comments.map((c) =>
          c.timecode != null ? (
            <button
              key={c.id}
              title={c.body}
              onClick={(e) => {
                e.stopPropagation();
                requestSeek(c.timecode!);
              }}
              className="absolute top-1/2 h-[5px] w-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--accent)] hover:scale-150"
              style={{ left: `${(c.timecode / duration) * 100}%` }}
            />
          ) : null
        )}

        {/* playhead handle */}
        <div
          className="absolute top-1/2 h-[20px] w-[8px] -translate-x-1/2 -translate-y-1/2 border border-[#484848] bg-[#2a2a2a]"
          style={{ left: `${pct}%` }}
        />
      </div>
    </div>
  );
}
