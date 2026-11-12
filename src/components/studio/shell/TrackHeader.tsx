"use client";
import { reviewPreviewHref, type ReviewStage } from "../reviewPreviewContext";
import type { SongRange } from "../reviewSelection";

type TrackHeaderProps = {
  headline: string;
  meta: string | null;
  next?: string | null;
  previewProjectId?: string | null;
  previewShotId?: string;
  previewRanges?: SongRange[];
  previewStage?: ReviewStage;
};

/** Compact song identity above the beat spine — workspace chrome, not a hero title. */
export function TrackHeader({ headline, meta, next, previewProjectId, previewShotId, previewRanges, previewStage }: TrackHeaderProps) {
  return (
    <header className="flex shrink-0 items-baseline justify-between gap-4 pb-1">
      <div className="min-w-0">
        <h1 className="truncate font-mono text-[13px] font-medium tracking-[0.01em] text-fg-3">{headline}</h1>
        {meta ? <p className="mt-0.5 font-mono text-[11px] text-fg-4">{meta}</p> : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-3">
      {next ? (
        <p className="max-w-[28ch] shrink-0 text-right text-[11px] leading-4 text-fg-4">
          <span className="text-fg-3">Next · </span>
          {next}
        </p>
      ) : null}
      {previewProjectId ? <a href={reviewPreviewHref(previewProjectId, { shotId: previewShotId, ranges: previewRanges, stage: previewStage })} target="_blank" rel="noopener noreferrer"
        className="rounded-md border border-accent bg-accent-tint px-3 py-2 text-xs font-medium text-fg-0 hover:bg-accent-lo focus-visible:outline-2 focus-visible:outline-accent">Preview</a> : null}
      </div>
    </header>
  );
}
