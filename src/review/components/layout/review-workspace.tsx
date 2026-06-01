"use client";

import { useEffect, useMemo } from "react";
import { AssetSidebar } from "@/review/components/sidebar/asset-sidebar";
import { MediaViewer } from "@/review/components/viewer/media-viewer";
import { CommentPanel } from "@/review/components/comments/comment-panel";
import { useAssetStore } from "@/review/lib/store/asset-store";
import type { UploadedVideoSource } from "@/components/studio/types";

/**
 * The DAILIES review surface, adapted to live inside the SVS Studio content
 * row (the studio supplies the header, tab-nav sidebar and status bar). It is
 * the pre-edit stage: ingest → scene-split → caption → comment → approve.
 *
 * Approved video assets are mapped to the studio's UploadedVideoSource shape
 * and pushed up via onApprovedSourcesChange so the editing tabs (Split / Join /
 * etc.) can consume the same clips.
 */
export function ReviewWorkspace({
  onApprovedSourcesChange,
}: {
  onApprovedSourcesChange?: (sources: UploadedVideoSource[]) => void;
}) {
  const assets = useAssetStore((s) => s.assets);

  const approved = useMemo<UploadedVideoSource[]>(
    () =>
      assets
        .filter((a) => {
          const v = a.versions[a.currentVersionIndex];
          return a.type === "video" && v?.status === "approved";
        })
        .map((a) => {
          const v = a.versions[a.currentVersionIndex]!;
          return {
            id: 0, // re-indexed by StudioApp on merge
            name: a.name,
            duration: v.duration,
            size: v.fileSize,
            thumbnailUrl: a.thumbnailOverride ?? a.scenes[0]?.thumbnailUrl ?? "",
            videoUrl: v.src,
          };
        }),
    [assets]
  );

  // Signature avoids firing the handoff on unrelated store changes.
  const signature = useMemo(
    () => approved.map((s) => `${s.name}:${s.size}:${s.duration.toFixed(3)}`).join("|"),
    [approved]
  );

  useEffect(() => {
    onApprovedSourcesChange?.(approved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return (
    <div className="flex flex-1 overflow-hidden">
      <AssetSidebar />
      <main className="flex flex-1 overflow-hidden">
        <MediaViewer />
      </main>
      <CommentPanel />
    </div>
  );
}
