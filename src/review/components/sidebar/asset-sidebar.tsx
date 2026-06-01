"use client";

import { useRef, useState } from "react";
import { useAssetStore } from "@/review/lib/store/asset-store";
import { AssetList } from "./asset-list";
import { StatusDot } from "@/review/components/shared/status-pill";
import { UploadIcon } from "@/review/components/shared/icons";
import type { ReviewStatus } from "@/review/lib/store/types";

const FILTERS: Array<{ key: ReviewStatus | "all"; label: string }> = [
  { key: "all", label: "All" },
  { key: "in-review", label: "Review" },
  { key: "needs-changes", label: "Changes" },
  { key: "approved", label: "Approved" },
];

export function AssetSidebar() {
  const [filter, setFilter] = useState<ReviewStatus | "all">("all");
  const fileRef = useRef<HTMLInputElement>(null);
  const versionRef = useRef<HTMLInputElement>(null);

  const addFiles = useAssetStore((s) => s.addFiles);
  const addVersion = useAssetStore((s) => s.addVersion);
  const assetCount = useAssetStore((s) => s.assets.length);
  const asset = useAssetStore((s) =>
    s.assets.find((a) => a.id === s.activeAssetId)
  );
  const selectVersion = useAssetStore((s) => s.selectVersion);

  return (
    <aside className="flex w-52 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-panel)]">
      {/* project header */}
      <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-[11px]">
        <div className="flex flex-col gap-[3px]">
          <span className="text-[9px] uppercase tracking-[0.22em] text-[var(--text-dim)]">
            Review Queue
          </span>
          <span className="font-mono text-[11px] tabular-nums text-[var(--text-2)]">
            {assetCount} {assetCount === 1 ? "asset" : "assets"}
          </span>
        </div>
        <button
          onClick={() => fileRef.current?.click()}
          title="Ingest assets"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[2px] border border-[var(--border)] text-[var(--text-mut)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
        >
          <UploadIcon width={12} height={12} />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="video/*,image/*"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) void addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {/* filter row */}
      <div className="flex border-b border-[var(--border)] px-1">
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className="relative flex-1 py-2.5 text-[9.5px] uppercase tracking-[0.03em] transition-colors"
              style={{ color: active ? "var(--text-hi)" : "var(--text-mut)" }}
            >
              {f.label}
              {active && (
                <span className="absolute inset-x-2 bottom-0 h-[2px] bg-[var(--accent)]" />
              )}
            </button>
          );
        })}
      </div>

      {/* asset list */}
      <AssetList filter={filter} />

      {/* versions strip */}
      {asset && (
        <div className="border-t border-[var(--border)] p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[9px] uppercase tracking-[0.22em] text-[var(--text-dim)]">
              Versions
            </span>
            <button
              onClick={() => versionRef.current?.click()}
              className="text-[9px] uppercase tracking-[0.14em] text-[var(--text-mut)] transition-colors hover:text-[var(--accent)]"
            >
              + Add
            </button>
            <input
              ref={versionRef}
              type="file"
              accept="video/*,image/*"
              hidden
              onChange={(e) => {
                if (e.target.files?.[0])
                  void addVersion(asset.id, e.target.files[0]);
                e.target.value = "";
              }}
            />
          </div>
          <div className="flex flex-col gap-0.5">
            {[...asset.versions]
              .map((v, i) => ({ v, i }))
              .reverse()
              .map(({ v, i }) => {
                const selected = i === asset.currentVersionIndex;
                return (
                  <button
                    key={v.id}
                    onClick={() => selectVersion(asset.id, i)}
                    className="flex items-center justify-between rounded-[2px] px-2 py-1.5 transition-colors"
                    style={{
                      background: selected ? "var(--bg-inset)" : undefined,
                    }}
                  >
                    <span
                      className="font-mono text-[11px] tabular-nums"
                      style={{
                        color: selected ? "var(--accent)" : "var(--text-2)",
                      }}
                    >
                      {v.label}
                    </span>
                    <span className="font-mono text-[9px] tabular-nums text-[var(--text-dim)]">
                      {new Date(v.createdAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                    <StatusDot status={v.status} />
                  </button>
                );
              })}
          </div>
        </div>
      )}
    </aside>
  );
}
