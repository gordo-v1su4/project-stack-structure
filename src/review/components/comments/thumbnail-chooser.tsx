"use client";

import { useState } from "react";
import { useAssetStore } from "@/review/lib/store/asset-store";
import { useViewerStore } from "@/review/lib/store/viewer-store";
import { createAnalysisVideo, grabThumbnail } from "@/review/lib/video/frame-grab";
import { timeToTimecode } from "@/review/lib/video/frame-utils";
import type { Asset } from "@/review/lib/store/types";

/**
 * Inline poster-frame picker. Operators choose which scene thumbnail (or the
 * live playhead frame) represents the asset in the browser list.
 */
export function ThumbnailChooser({
  asset,
  onClose,
}: {
  asset: Asset;
  onClose: () => void;
}) {
  const setThumbnail = useAssetStore((s) => s.setThumbnail);
  const currentTime = useViewerStore((s) => s.currentTime);
  const fps = useViewerStore((s) => s.fps);
  const version = asset.versions[asset.currentVersionIndex];
  const [grabbing, setGrabbing] = useState(false);

  const current = asset.thumbnailOverride ?? asset.scenes[0]?.thumbnailUrl;

  async function useCurrentFrame() {
    if (!version || asset.type !== "video") return;
    setGrabbing(true);
    try {
      const v = await createAnalysisVideo(version.src);
      const dataUrl = await grabThumbnail(v, currentTime);
      v.src = "";
      v.remove();
      setThumbnail(asset.id, dataUrl);
    } finally {
      setGrabbing(false);
    }
  }

  return (
    <div className="rounded-[2px] border border-[var(--border)] bg-[var(--bg-inset-deep)] p-2">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[9px] uppercase tracking-[0.22em] text-[var(--text-dim)]">
          Choose Poster
        </span>
        {asset.type === "video" && (
          <button
            onClick={useCurrentFrame}
            disabled={grabbing}
            className="rounded-[2px] border border-[var(--border)] px-1.5 py-0.5 font-mono text-[9px] tabular-nums text-[var(--text-mut)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-40"
          >
            {grabbing ? "GRABBING…" : `@ ${timeToTimecode(currentTime, fps || 30)}`}
          </button>
        )}
      </div>

      {asset.scenes.length > 0 ? (
        <div className="grid max-h-[180px] grid-cols-3 gap-1.5 overflow-y-auto">
          {asset.scenes.map((scene) => {
            const selected = current === scene.thumbnailUrl;
            return (
              <button
                key={scene.id}
                onClick={() => {
                  if (scene.thumbnailUrl)
                    setThumbnail(asset.id, scene.thumbnailUrl);
                }}
                className="relative aspect-video overflow-hidden rounded-[2px] border transition-colors"
                style={{
                  borderColor: selected ? "var(--accent)" : "var(--border-faint)",
                }}
              >
                {scene.thumbnailUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={scene.thumbnailUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                )}
                <span className="absolute bottom-0 left-0 bg-[var(--bg-well)]/80 px-1 font-mono text-[7px] tabular-nums text-[var(--text-2)]">
                  {timeToTimecode(scene.startTime, fps || 30).slice(3)}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="py-2 text-center font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--text-dim)]">
          {asset.type === "video"
            ? "Scenes not analyzed yet"
            : "Images use their own frame"}
        </p>
      )}

      <button
        onClick={onClose}
        className="mt-2 w-full rounded-[2px] border border-[var(--border)] py-1 text-[9px] uppercase tracking-[0.18em] text-[var(--text-mut)] transition-colors hover:text-[var(--text-2)]"
      >
        Done
      </button>
    </div>
  );
}
