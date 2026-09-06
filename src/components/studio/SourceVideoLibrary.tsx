"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { fmt } from "./math";
import { UploadControl } from "./UploadControl";
import { Button } from "./ui";
import type { UploadedVideoSource } from "./types";

type SourceVideoLibraryProps = {
  sources: UploadedVideoSource[];
  isPreparingVideos: boolean;
  onAppendVideos: (files: File[]) => void | Promise<void>;
  onReplaceVideos: (files: File[]) => void | Promise<void>;
  onRemoveVideo: (sourceId: number) => void;
  onRerunCaptions?: (sourceId: number) => void;
  captionsDisabled?: boolean;
  activeSourceIds?: number[];
};

export function SourceVideoLibrary({
  sources,
  isPreparingVideos,
  onAppendVideos,
  onReplaceVideos,
  onRemoveVideo,
  onRerunCaptions,
  captionsDisabled = false,
  activeSourceIds = [],
}: SourceVideoLibraryProps) {
  const [previewSourceId, setPreviewSourceId] = useState<number | null>(null);
  const previewSource = sources.find((source) => source.id === previewSourceId) ?? null;

  return (
    <div className="border border-[#1a1a1a] rounded-[2px] bg-[#0b0b0b] p-2">
      <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-[0.16em] text-[#444]">
        <span>Uploaded Sources</span>
        <div className="flex items-center gap-2">
          <UploadControl
            accept="video/*"
            multiple
            variant="button"
            title=""
            detail=""
            actionLabel={isPreparingVideos ? "Processing..." : "Add Videos"}
            disabled={isPreparingVideos}
            onFiles={onAppendVideos}
          />
          <UploadControl
            accept="video/*"
            multiple
            variant="button"
            title=""
            detail=""
            actionLabel={isPreparingVideos ? "Processing..." : "Replace All"}
            disabled={isPreparingVideos}
            onFiles={onReplaceVideos}
          />
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-5">
        {sources.map((source) => {
          const isActiveSource = activeSourceIds.includes(source.id);
          const sceneCount = source.scenes?.length ?? 0;
          const captionCount = countSceneCaptions(source);
          const previewImage = getSourcePreviewImage(source);
          const statusLabel = source.sceneStatus === "ready"
            ? `PYSCENEDETECT · ${sceneCount} SCENE${sceneCount === 1 ? "" : "S"}`
            : source.sceneStatus === "failed"
              ? "SCENE DETECTION ERROR"
              : source.sceneStatus === "detecting"
                ? "DETECTING SCENES"
                : "SCENES PENDING";
          return (
          <div key={source.id} className={`overflow-hidden rounded-[2px] border bg-[#090909] transition-colors ${
            isActiveSource ? "border-[#e05c00] shadow-[0_0_0_1px_#e05c0044]" : "border-[#171717]"
          }`}>
            <div className="relative aspect-[16/9] bg-[#030303]">
              {previewImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewImage}
                  alt={source.name}
                  className="absolute inset-0 h-full w-full object-cover"
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-[9px] uppercase tracking-[0.14em] text-[#444]">
                  Preview pending
                </div>
              )}
              <button
                type="button"
                onClick={() => setPreviewSourceId(source.id)}
                className="group absolute inset-0 z-[5] flex items-center justify-center bg-black/0 text-transparent transition-colors hover:bg-black/35 hover:text-white focus-visible:bg-black/35 focus-visible:text-white focus-visible:outline-none"
                aria-label={`Preview S${source.id + 1} ${source.name}`}
              >
                <span className="rounded-[2px] border border-white/30 bg-black/70 px-2 py-1 text-[8px] uppercase tracking-[0.14em] opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                  Play source
                </span>
              </button>
              <button
                type="button"
                onClick={() => onRemoveVideo(source.id)}
                className="absolute right-[6px] top-[6px] z-10 rounded-[2px] border border-[#2a2a2a] bg-[#000000b8] px-1.5 py-[1px] text-[9px] font-semibold text-[#d8d8d8] hover:border-[#505050] hover:text-white"
                aria-label={`Remove ${source.name}`}
                title={`Remove ${source.name}`}
              >
                ×
              </button>
              <div className="pointer-events-none absolute left-[6px] top-[6px] rounded-[2px] bg-[#00000088] px-1 py-[2px] text-[8px] font-mono text-[#d8d8d8]">
                S{source.id + 1}
              </div>
              <div className="pointer-events-none absolute bottom-[6px] right-[6px] rounded-[2px] bg-[#00000088] px-1 py-[2px] text-[8px] font-mono text-[#b8b8b8]">
                {fmt(source.duration)}
              </div>
            </div>
            <div className="border-t border-[#141414] px-2 py-[5px]">
              <div className="truncate text-[9px] font-mono text-[#8b8b8b]">{source.name}</div>
              <div className={`mt-1 text-[8px] font-mono uppercase tracking-[0.12em] ${source.sceneStatus === "failed" ? "text-[#d24b3f]" : "text-[#e05c00]"}`}>
                {statusLabel}
              </div>
              <div className={`mt-1 text-[8px] font-mono uppercase tracking-[0.12em] ${source.captionStatus === "failed" ? "text-[#7b5b48]" : "text-[#6f6f6f]"}`}>
                {source.captionStatus === "captioning"
                  ? `CAPTIONING · ${captionCount}/${Math.max(sceneCount, 1)}`
                  : source.captionStatus === "ready"
                    ? `CAPTIONED · ${captionCount}/${sceneCount}`
                    : source.captionStatus === "failed"
                      ? "CAPTIONS FAILED"
                      : source.captionManifestUrl
                        ? "CAPTIONS STORED"
                        : "CAPTIONS PENDING"}
              </div>
              {source.sceneError ? <div className="mt-1 truncate text-[8px] text-[#7b5b48]" title={source.sceneError}>{source.sceneError}</div> : null}
              {source.captionError ? <div className="mt-1 truncate text-[8px] text-[#7b5b48]" title={source.captionError}>{source.captionError}</div> : null}
              {onRerunCaptions ? (
                <Button
                  size="sm"
                  className="mt-2 w-full"
                  aria-label={`Rerun captions for S${source.id + 1} ${source.name}`}
                  onClick={() => onRerunCaptions(source.id)}
                  disabled={captionsDisabled || isPreparingVideos || source.sceneStatus !== "ready" || !sceneCount || source.captionStatus === "captioning"}
                >
                  {source.captionStatus === "captioning" ? "Captioning…" : "Rerun captions"}
                </Button>
              ) : null}
            </div>
          </div>
          );
        })}
      </div>

      {previewSource ? <SourceVideoPreviewDialog source={previewSource} onClose={() => setPreviewSourceId(null)} /> : null}
    </div>
  );
}

const SOURCE_PREVIEW_FRAME_RATE = 24;

export function getSourcePreviewImage(source: UploadedVideoSource) {
  const scene = source.scenes?.[0];
  return source.thumbnailUrl
    || scene?.firstFrameUrl
    || scene?.middleFrameUrl
    || scene?.lastFrameUrl
    || scene?.thumbnailUrl;
}

export function formatSourceFrameReadout(currentTime: number, duration: number, frameRate = SOURCE_PREVIEW_FRAME_RATE) {
  const safeCurrentTime = Number.isFinite(currentTime) ? Math.max(0, currentTime) : 0;
  const safeDuration = Number.isFinite(duration) ? Math.max(0, duration) : 0;
  return {
    time: `${safeCurrentTime.toFixed(2)}s / ${safeDuration.toFixed(2)}s`,
    frame: `Frame ${Math.floor(safeCurrentTime * frameRate)} / ${Math.floor(safeDuration * frameRate)} · ${frameRate} fps`,
  };
}

function SourceVideoPreviewDialog({ source, onClose }: { source: UploadedVideoSource; onClose: () => void }) {
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(source.duration);
  const readout = formatSourceFrameReadout(currentTime, duration);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  if (typeof document === "undefined") return null;

  // The animated Ingest container establishes a containing block for fixed
  // children. Portal to the body so scroll position cannot offset the modal.
  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/85 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Preview S${source.id + 1} ${source.name}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-[760px] overflow-hidden rounded-[3px] border border-[#2a2a2a] bg-[#080808] shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-[#1b1b1b] px-3 py-2">
          <div className="min-w-0">
            <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#e05c00]">S{source.id + 1} · Source preview</div>
            <div className="mt-1 truncate font-mono text-[9px] text-[#686868]" title={source.name}>{source.name}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-[2px] border border-[#2a2a2a] px-2 py-1 text-[10px] text-[#aaa] hover:border-[#e05c00] hover:text-white"
            aria-label="Close source preview"
          >
            ×
          </button>
        </div>
        <div className="bg-black p-2">
          <video
            src={source.videoUrl}
            poster={getSourcePreviewImage(source)}
            controls
            preload="metadata"
            playsInline
            className="aspect-video max-h-[62vh] w-full bg-black object-contain"
            onLoadedMetadata={(event) => {
              setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : source.duration);
            }}
            onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
            onSeeked={(event) => setCurrentTime(event.currentTarget.currentTime)}
          >
            Your browser does not support video playback.
          </video>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-[#1b1b1b] px-3 py-2 font-mono text-[9px] uppercase tracking-[0.12em] text-[#777]">
          <span>{readout.time}</span>
          <span>{readout.frame}</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function countSceneCaptions(source: UploadedVideoSource) {
  return source.scenes?.filter((scene) => Boolean(scene.caption)).length ?? 0;
}
