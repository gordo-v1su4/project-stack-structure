"use client";

import { useMemo, useState } from "react";
import { useAssetStore } from "@/review/lib/store/asset-store";
import { useCommentStore } from "@/review/lib/store/comment-store";
import { CommentComposer } from "./comment-composer";
import { CommentCard } from "./comment-card";
import { ThumbnailChooser } from "./thumbnail-chooser";
import { PosterIcon, TrashIcon, CheckIcon } from "@/review/components/shared/icons";
import type { ReviewStatus } from "@/review/lib/store/types";

const STATUS_ACTIONS: Array<{
  key: ReviewStatus;
  label: string;
  color: string;
}> = [
  { key: "approved", label: "Approve", color: "var(--ok)" },
  { key: "needs-changes", label: "Changes", color: "var(--reject)" },
  { key: "in-review", label: "Review", color: "var(--text-mut)" },
];

export function CommentPanel() {
  const asset = useAssetStore((s) =>
    s.assets.find((a) => a.id === s.activeAssetId)
  );
  const setStatus = useAssetStore((s) => s.setStatus);
  const deleteAsset = useAssetStore((s) => s.deleteAsset);
  const version = asset?.versions[asset.currentVersionIndex];

  const allComments = useCommentStore((s) => s.comments);
  const comments = useMemo(
    () =>
      version
        ? allComments
            .filter((c) => c.versionId === version.id)
            .sort((a, b) => a.createdAt - b.createdAt)
        : [],
    [allComments, version]
  );

  const [chooserOpen, setChooserOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const current = version?.status;

  return (
    <aside className="flex w-96 shrink-0 flex-col overflow-hidden border-l border-[var(--border)] bg-[var(--bg-panel)]">
      {/* asset header + actions */}
      {asset ? (
        <div className="border-b border-[var(--border)] p-3">
          <div className="mb-2.5 flex items-center justify-between gap-2">
            <div className="flex min-w-0 flex-col">
              <span className="text-[9px] uppercase tracking-[0.22em] text-[var(--text-dim)]">
                Asset
              </span>
              <span className="truncate font-mono text-[11px] text-[var(--text-hi)]">
                {asset.name}
              </span>
            </div>
            <div className="flex shrink-0 gap-1.5">
              <button
                onClick={() => {
                  setChooserOpen((o) => !o);
                  setConfirmDelete(false);
                }}
                title="Choose poster frame"
                className="flex items-center gap-1.5 rounded-[2px] border px-2 py-1.5 text-[9px] uppercase tracking-[0.14em] transition-colors"
                style={{
                  borderColor: chooserOpen ? "var(--accent)" : "var(--border)",
                  color: chooserOpen ? "var(--accent)" : "var(--text-mut)",
                }}
              >
                <PosterIcon width={12} height={12} />
                Poster
              </button>
              <button
                onClick={() => {
                  if (confirmDelete) {
                    deleteAsset(asset.id);
                    setConfirmDelete(false);
                  } else {
                    setConfirmDelete(true);
                    setChooserOpen(false);
                  }
                }}
                onMouseLeave={() => setConfirmDelete(false)}
                title="Discard asset"
                className="flex items-center gap-1.5 rounded-[2px] border px-2 py-1.5 text-[9px] uppercase tracking-[0.14em] transition-colors"
                style={{
                  borderColor: confirmDelete
                    ? "var(--reject)"
                    : "var(--border)",
                  color: confirmDelete ? "#ededed" : "var(--text-mut)",
                  background: confirmDelete ? "var(--reject)" : "transparent",
                }}
              >
                <TrashIcon width={12} height={12} />
                {confirmDelete ? "Confirm" : "Discard"}
              </button>
            </div>
          </div>

          {chooserOpen && (
            <ThumbnailChooser
              asset={asset}
              onClose={() => setChooserOpen(false)}
            />
          )}
        </div>
      ) : null}

      {/* status actions */}
      <div className="border-b border-[var(--border)] p-3">
        <span className="mb-2 block text-[9px] uppercase tracking-[0.22em] text-[var(--text-dim)]">
          Review Status
        </span>
        <div className="flex gap-1.5">
          {STATUS_ACTIONS.map((a) => {
            const active = current === a.key;
            const filledText = a.key === "in-review" ? "#0a0a0a" : "#ededed";
            return (
              <button
                key={a.key}
                onClick={() => asset && setStatus(asset.id, a.key)}
                disabled={!asset}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-[2px] py-2.5 text-[10px] uppercase tracking-[0.14em] transition-colors disabled:opacity-40"
                style={{
                  border: `1px solid ${active ? a.color : "var(--border)"}`,
                  background: active ? a.color : "transparent",
                  color: active ? filledText : a.color,
                }}
              >
                {a.key === "approved" ? (
                  <CheckIcon width={11} height={11} />
                ) : (
                  <span
                    className="h-[5px] w-[5px] rounded-full"
                    style={{ background: active ? filledText : a.color }}
                  />
                )}
                {a.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* composer */}
      <CommentComposer />

      {/* thread */}
      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        <span className="text-[9px] uppercase tracking-[0.22em] text-[var(--text-dim)]">
          Comments {comments.length > 0 ? `· ${comments.length}` : ""}
        </span>
        {comments.length === 0 ? (
          <p className="text-[10px] leading-relaxed text-[var(--text-dim)]">
            {asset
              ? "No notes yet. Park the playhead and leave one."
              : "Select an asset to review."}
          </p>
        ) : (
          comments.map((c) => <CommentCard key={c.id} comment={c} />)
        )}
      </div>
    </aside>
  );
}
