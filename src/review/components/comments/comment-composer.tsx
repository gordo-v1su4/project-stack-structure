"use client";

import { useState } from "react";
import { useViewerStore } from "@/review/lib/store/viewer-store";
import { useAssetStore } from "@/review/lib/store/asset-store";
import { useCommentStore } from "@/review/lib/store/comment-store";
import { timeToTimecode, timeToFrame } from "@/review/lib/video/frame-utils";

export function CommentComposer() {
  const [body, setBody] = useState("");
  const [pinned, setPinned] = useState(true);

  const currentTime = useViewerStore((s) => s.currentTime);
  const fps = useViewerStore((s) => s.fps);
  const mode = useViewerStore((s) => s.mode);
  const annotateArmed = useViewerStore((s) => s.annotateArmed);
  const setAnnotateArmed = useViewerStore((s) => s.setAnnotateArmed);

  const asset = useAssetStore((s) =>
    s.assets.find((a) => a.id === s.activeAssetId)
  );
  const version = asset?.versions[asset.currentVersionIndex];
  const addComment = useCommentStore((s) => s.addComment);

  const isVideo = mode === "video";

  function post() {
    if (!body.trim() || !asset || !version) return;
    addComment({
      assetId: asset.id,
      versionId: version.id,
      timecode: isVideo && pinned ? currentTime : null,
      frame: isVideo && pinned ? timeToFrame(currentTime, fps || 30) : null,
      author: "Operator",
      body: body.trim(),
      annotationId: null,
    });
    setBody("");
  }

  if (!version) return null;

  return (
    <div className="border-b border-[var(--border)] p-3">
      {/* pin chip */}
      <div className="mb-2 flex items-center gap-2">
        <button
          onClick={() => setPinned((p) => !p)}
          disabled={!isVideo}
          className="rounded-[2px] border px-1.5 py-0.5 font-mono text-[9px] tabular-nums transition-colors"
          style={{
            borderColor: pinned && isVideo ? "var(--accent)" : "var(--border)",
            color:
              pinned && isVideo ? "var(--accent)" : "var(--text-mut)",
          }}
        >
          {isVideo && pinned
            ? `@ ${timeToTimecode(currentTime, fps || 30)}`
            : "general"}
        </button>
        {isVideo && (
          <button
            onClick={() => setAnnotateArmed(!annotateArmed)}
            className="rounded-[2px] border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.14em] transition-colors"
            style={{
              borderColor: annotateArmed ? "var(--accent)" : "var(--border)",
              color: annotateArmed ? "var(--accent)" : "var(--text-mut)",
            }}
          >
            Annotate
          </button>
        )}
      </div>

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) post();
        }}
        placeholder="Leave a note…"
        rows={2}
        className="w-full resize-none rounded-[2px] border border-[var(--border)] bg-[var(--bg-inset-deep)] px-2 py-1.5 font-mono text-[11px] text-[var(--text)] placeholder:text-[var(--text-mut)] focus:border-[var(--accent)] focus:outline-none"
      />

      <button
        onClick={post}
        disabled={!body.trim()}
        className="mt-2 w-full rounded-[2px] py-1.5 text-[10px] uppercase tracking-[0.18em] transition-colors disabled:opacity-40"
        style={{
          background: body.trim() ? "var(--accent)" : "var(--bg-inset)",
          color: body.trim() ? "#0a0a0a" : "var(--text-mut)",
        }}
      >
        Post
      </button>
    </div>
  );
}
