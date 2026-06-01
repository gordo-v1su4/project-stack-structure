"use client";

import { useAssetStore } from "@/review/lib/store/asset-store";
import { useViewerStore } from "@/review/lib/store/viewer-store";
import { timeToTimecode } from "@/review/lib/video/frame-utils";

export function SceneStrip() {
  const asset = useAssetStore((s) =>
    s.assets.find((a) => a.id === s.activeAssetId)
  );
  const fps = useViewerStore((s) => s.fps);
  const currentTime = useViewerStore((s) => s.currentTime);
  const requestSeek = useViewerStore((s) => s.requestSeek);

  if (!asset || asset.type !== "video") return null;

  const captioning = asset.analysisStage === "captioning";
  const scenes = asset.scenes;

  if (scenes.length === 0) {
    if (asset.analysisStage === "detecting") {
      return (
        <div className="border-t border-[var(--border)] px-1 py-2">
          <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--text-dim)]">
            Detecting scenes…
          </p>
        </div>
      );
    }
    return null;
  }

  return (
    <div className="border-t border-[var(--border)] pt-2">
      <div className="flex items-center justify-between px-1 pb-1.5">
        <span className="text-[9px] uppercase tracking-[0.22em] text-[var(--text-dim)]">
          Shots · {scenes.length}
        </span>
        {captioning && (
          <span className="font-mono text-[9px] tabular-nums text-[var(--gold)]">
            CAPTIONING {Math.round(asset.analysisProgress * 100)}%
          </span>
        )}
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {scenes.map((scene) => {
          const active =
            currentTime >= scene.startTime && currentTime < scene.endTime;
          return (
            <button
              key={scene.id}
              onClick={() => requestSeek(scene.startTime)}
              className="group flex w-[112px] shrink-0 flex-col gap-1 rounded-[2px] border p-1 text-left transition-colors"
              style={{
                borderColor: active ? "var(--accent)" : "var(--border-faint)",
                background: active ? "#131313" : "var(--bg-inset)",
              }}
            >
              <div className="relative aspect-video w-full overflow-hidden rounded-[1px] bg-[var(--bg-well)]">
                {scene.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={scene.thumbnailUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : null}
                <span className="absolute bottom-0.5 left-0.5 rounded-[1px] bg-[var(--bg-well)]/80 px-1 font-mono text-[8px] tabular-nums text-[var(--text-2)]">
                  {timeToTimecode(scene.startTime, fps)}
                </span>
              </div>

              {scene.meta?.shotType && (
                <span className="truncate font-mono text-[8px] uppercase tracking-[0.1em] text-[var(--accent-ghost)]">
                  {scene.meta.shotType}
                </span>
              )}

              <p className="line-clamp-2 text-[9px] leading-tight text-[var(--text-2)]">
                {scene.caption ||
                  (captioning ? (
                    <span className="text-[var(--text-dim)]">analyzing…</span>
                  ) : (
                    <span className="text-[var(--text-dim)]">—</span>
                  ))}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
