"use client";

import { useState } from "react";
import type { Comment } from "@/review/lib/store/types";
import { useViewerStore } from "@/review/lib/store/viewer-store";
import { useCommentStore } from "@/review/lib/store/comment-store";
import { timeToTimecode } from "@/review/lib/video/frame-utils";
import { CheckIcon } from "@/review/components/shared/icons";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function CommentCard({ comment }: { comment: Comment }) {
  const fps = useViewerStore((s) => s.fps);
  const requestSeek = useViewerStore((s) => s.requestSeek);
  const toggleResolved = useCommentStore((s) => s.toggleResolved);
  const [hover, setHover] = useState(false);

  if (comment.resolved) {
    return (
      <button
        onClick={() => toggleResolved(comment.id)}
        className="flex w-full items-center gap-2 px-1 py-1 text-left"
      >
        <CheckIcon width={10} height={10} className="text-[var(--ok)]" />
        <span className="truncate text-[10px] text-[var(--text-dim)] line-through">
          {comment.body}
        </span>
      </button>
    );
  }

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="rounded-[2px] border border-[var(--border-faint)] bg-[var(--bg-inset)] p-2"
    >
      <div className="mb-1 flex items-center gap-2">
        <span className="flex h-[18px] w-[18px] items-center justify-center rounded-[2px] bg-[#1c1c1c] font-mono text-[9px] text-[var(--text-2)]">
          {initials(comment.author)}
        </span>
        <span className="text-[10px] text-[var(--text-2)]">
          {comment.author}
        </span>
        {comment.timecode != null ? (
          <button
            onClick={() => requestSeek(comment.timecode!)}
            className="font-mono text-[10px] tabular-nums text-[var(--accent)] hover:underline"
          >
            {timeToTimecode(comment.timecode, fps || 30)}
          </button>
        ) : (
          <span className="font-mono text-[10px] text-[var(--text-dim)]">
            general
          </span>
        )}
        <span className="ml-auto font-mono text-[9px] text-[var(--text-dim)]">
          {new Date(comment.createdAt).toLocaleTimeString(undefined, {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>

      <p className="text-[11px] leading-relaxed text-[var(--text)]">
        {comment.body}
      </p>

      {comment.annotationId && (
        <span className="mt-1 inline-block font-mono text-[9px] text-[var(--text-mut)]">
          ◳ annotation
        </span>
      )}

      {hover && (
        <div className="mt-1.5 flex gap-3 border-t border-[var(--border-soft)] pt-1.5">
          <button className="text-[9px] uppercase tracking-[0.1em] text-[var(--text-mut)] hover:text-[var(--text-2)]">
            Reply
          </button>
          <button
            onClick={() => toggleResolved(comment.id)}
            className="text-[9px] uppercase tracking-[0.1em] text-[var(--text-mut)] hover:text-[var(--ok)]"
          >
            Resolve
          </button>
        </div>
      )}
    </div>
  );
}
