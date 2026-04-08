"use client";

import { fmt } from "./math";
import { UploadControl } from "./UploadControl";
import type { UploadedVideoSource } from "./types";

type SourceVideoLibraryProps = {
  sources: UploadedVideoSource[];
  isPreparingVideos: boolean;
  onAppendVideos: (files: File[]) => void | Promise<void>;
  onReplaceVideos: (files: File[]) => void | Promise<void>;
  onRemoveVideo: (sourceId: number) => void;
};

export function SourceVideoLibrary({
  sources,
  isPreparingVideos,
  onAppendVideos,
  onReplaceVideos,
  onRemoveVideo,
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
        {sources.map((source, index) => (
          <div key={source.id} className="overflow-hidden rounded-[2px] border border-[#171717] bg-[#090909]">
            <div className="relative aspect-[16/9] bg-[#030303]">
              <video
                controls
                preload="metadata"
                poster={source.thumbnailUrl}
                src={source.videoUrl}
                className="absolute inset-0 h-full w-full object-cover"
              />
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
            <div className="truncate border-t border-[#141414] px-2 py-[5px] text-[9px] font-mono text-[#8b8b8b]">
              {source.name}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
