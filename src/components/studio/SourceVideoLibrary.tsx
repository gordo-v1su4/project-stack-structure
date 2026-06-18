"use client";

import { fmt } from "./math";
import { buildFallbackSceneSegments } from "./sceneSplit";
import { UploadControl } from "./UploadControl";
import type { UploadedVideoSource } from "./types";

type SourceVideoLibraryProps = {
  sources: UploadedVideoSource[];
  isPreparingVideos: boolean;
  onAppendVideos: (files: File[]) => void | Promise<void>;
  onReplaceVideos: (files: File[]) => void | Promise<void>;
  onRemoveVideo: (sourceId: number) => void;
  activeSourceIds?: number[];
};

export function SourceVideoLibrary({
  sources,
  isPreparingVideos,
  onAppendVideos,
  onReplaceVideos,
  onRemoveVideo,
  activeSourceIds = [],
}: SourceVideoLibraryProps) {
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

      <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-4">
        {sources.map((source, index) => {
          const isActiveSource = activeSourceIds.includes(source.id);
          const sceneCount = source.scenes?.length ?? 0;
          const captionCount = countSceneCaptions(source);
          const statusLabel = source.sceneStatus === "ready"
            ? `PYSCENEDETECT · ${sceneCount} SCENE${sceneCount === 1 ? "" : "S"}`
            : source.sceneStatus === "fallback"
              ? `FALLBACK · ${sceneCount || buildFallbackSceneSegments(source).length} SCENE${(sceneCount || buildFallbackSceneSegments(source).length) === 1 ? "" : "S"}`
              : source.sceneStatus === "detecting"
                ? "DETECTING SCENES"
                : "SCENES PENDING";
          return (
          <div key={source.id} className={`overflow-hidden rounded-[2px] border bg-[#090909] transition-colors ${
            isActiveSource ? "border-[#e05c00] shadow-[0_0_0_1px_#e05c0044]" : "border-[#171717]"
          }`}>
            <div className="relative aspect-[16/9] bg-[#030303]">
              {source.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={source.thumbnailUrl}
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
                onClick={() => onRemoveVideo(source.id)}
                className="absolute right-[6px] top-[6px] z-10 rounded-[2px] border border-[#2a2a2a] bg-[#000000b8] px-1.5 py-[1px] text-[9px] font-semibold text-[#d8d8d8] hover:border-[#505050] hover:text-white"
                aria-label={`Remove ${source.name}`}
                title={`Remove ${source.name}`}
              >
                ×
              </button>
              <div className="pointer-events-none absolute left-[6px] top-[6px] rounded-[2px] bg-[#00000088] px-1 py-[2px] text-[8px] font-mono text-[#d8d8d8]">
                S{index + 1}
              </div>
              <div className="pointer-events-none absolute bottom-[6px] right-[6px] rounded-[2px] bg-[#00000088] px-1 py-[2px] text-[8px] font-mono text-[#b8b8b8]">
                {fmt(source.duration)}
              </div>
            </div>
            <div className="border-t border-[#141414] px-2 py-[5px]">
              <div className="truncate text-[9px] font-mono text-[#8b8b8b]">{source.name}</div>
              <div className={`mt-1 text-[8px] font-mono uppercase tracking-[0.12em] ${source.sceneStatus === "fallback" ? "text-[#b96c43]" : "text-[#e05c00]"}`}>
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
            </div>
          </div>
          );
        })}
      </div>
    </div>
  );
}

function countSceneCaptions(source: UploadedVideoSource) {
  return source.scenes?.filter((scene) => Boolean(scene.caption)).length ?? 0;
}
