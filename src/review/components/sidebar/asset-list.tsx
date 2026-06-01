"use client";

import { useAssetStore } from "@/review/lib/store/asset-store";
import { StatusDot } from "@/review/components/shared/status-pill";
import { timeToClock } from "@/review/lib/video/frame-utils";
import type { Asset, ReviewStatus } from "@/review/lib/store/types";

function assetThumb(asset: Asset): string | undefined {
  if (asset.thumbnailOverride) return asset.thumbnailOverride;
  if (asset.type === "image") return asset.versions[0]?.src;
  return asset.scenes[0]?.thumbnailUrl;
}

function assetStatus(asset: Asset): ReviewStatus {
  return asset.versions[asset.currentVersionIndex]?.status ?? "in-review";
}

export function AssetList({ filter }: { filter: ReviewStatus | "all" }) {
  const assets = useAssetStore((s) => s.assets);
  const activeAssetId = useAssetStore((s) => s.activeAssetId);
  const setActive = useAssetStore((s) => s.setActive);

  const visible = assets.filter(
    (a) => filter === "all" || assetStatus(a) === filter
  );

  if (visible.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <p className="text-center font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--text-dim)]">
          {assets.length === 0 ? "No assets ingested" : "No matching assets"}
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {visible.map((asset) => {
        const selected = asset.id === activeAssetId;
        const version = asset.versions[asset.currentVersionIndex];
        const thumb = assetThumb(asset);
        const status = assetStatus(asset);
        return (
          <button
            key={asset.id}
            onClick={() => setActive(asset.id)}
            className="flex w-full items-stretch gap-2 px-2 py-2 text-left transition-colors"
            style={{ background: selected ? "#131313" : undefined }}
            onMouseEnter={(e) => {
              if (!selected) e.currentTarget.style.background = "#0f0f0f";
            }}
            onMouseLeave={(e) => {
              if (!selected) e.currentTarget.style.background = "";
            }}
          >
            {/* accent bar */}
            <span
              className="w-[2px] shrink-0 self-stretch rounded-full"
              style={{ background: selected ? "var(--accent)" : "transparent" }}
            />

            {/* thumbnail */}
            <div className="relative h-[36px] w-[64px] shrink-0 overflow-hidden rounded-[2px] bg-[var(--bg-well)]">
              {thumb ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={thumb}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : null}
              <span className="absolute bottom-0 left-0 bg-[var(--bg-well)]/80 px-1 font-mono text-[8px] text-[var(--text-mut)]">
                {asset.type === "image" ? "IMG" : "MOV"}
              </span>
            </div>

            {/* meta */}
            <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
              <span
                className="truncate text-[12px] font-medium"
                style={{
                  color: selected ? "var(--text-hi)" : "var(--text-2)",
                }}
              >
                {asset.name}
              </span>
              <span className="truncate font-mono text-[10px] tabular-nums text-[var(--text-dim)]">
                {version?.label}
                {version?.fps ? ` · ${version.fps}` : ""}
                {version?.duration ? ` · ${timeToClock(version.duration)}` : ""}
              </span>
            </div>

            <span className="flex items-center pr-1">
              <StatusDot status={status} />
            </span>
          </button>
        );
      })}
    </div>
  );
}
