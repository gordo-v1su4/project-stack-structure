"use client";

import { PreviewPlayer } from "./PreviewPlayerComponent";
import type { BrowserPreviewPlayer, PreviewPlayerState, PreviewSegment } from "./previewPlayer";
import type { ShaderEffectCue } from "./shaderEffectPlan";
import { getPreviewAssetFileName } from "./studioUiState";
import type { BeatJoinAnalysis } from "./types";
import { Button, Kicker } from "./ui";

type PreviewDockProps = {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  expanded: boolean;
  onToggleExpanded: () => void;
  previewPlayer: BrowserPreviewPlayer;
  browserPreviewSegments: PreviewSegment[];
  browserPreviewState: PreviewPlayerState;
  isBrowserPreviewActive: boolean;
  previewEffectCues: ShaderEffectCue[];
  audioTimeline: Pick<BeatJoinAnalysis, "waveform" | "beats" | "onsets" | "duration"> | null;
  masterAudioUrl: string | null;
  previewAssetKey: string | null;
  previewAssetUrl: string | null;
};

/**
 * Persistent preview player docked under the stage. Only prepared assets
 * play here: an instant browser preview when segments are ready, or the
 * rendered FFmpeg section asset. Nothing else lives in the dock.
 */
export function PreviewDock({
  collapsed,
  onToggleCollapsed,
  expanded,
  onToggleExpanded,
  previewPlayer,
  browserPreviewSegments,
  browserPreviewState,
  isBrowserPreviewActive,
  previewEffectCues,
  audioTimeline,
  masterAudioUrl,
  previewAssetKey,
  previewAssetUrl,
}: PreviewDockProps) {
  const showBrowserPreview = browserPreviewSegments.length > 0;
  const showFfmpegPreview = !showBrowserPreview && !isBrowserPreviewActive && Boolean(previewAssetUrl);
  const assetFileName = getPreviewAssetFileName(previewAssetKey);
  const summary = showBrowserPreview
    ? `${browserPreviewSegments.length} cuts · ${browserPreviewState.totalDuration.toFixed(1)}s${masterAudioUrl ? " · master audio" : ""}`
    : showFfmpegPreview
      ? assetFileName ?? "Rendered preview"
      : "No prepared preview yet";

  const hasContent = showBrowserPreview || showFfmpegPreview;

  // With nothing to play the dock is a one-line hint; it only takes space once a preview exists.
  if (collapsed || !hasContent) {
    return (
      <div className="flex h-9 w-full shrink-0 items-center justify-between border-t border-line bg-ink-1 px-4">
        <div className="flex items-center gap-3">
          <Kicker>Preview</Kicker>
          <span className="truncate font-mono text-[11px] text-fg-3">
            {hasContent ? summary : "Nothing prepared yet · a stage's Preview button renders a playable cut here"}
          </span>
        </div>
        {hasContent ? (
          <Button size="sm" variant="ghost" onClick={onToggleCollapsed} aria-label="Show preview">
            Show ▴
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <aside
      aria-label="Preview"
      className={`flex w-full shrink-0 flex-col border-t border-line bg-ink-1 transition-[height] duration-200 ${expanded ? "h-[min(68vh,760px)]" : "h-[220px]"}`}
    >
      <div className="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-line px-4">
        <div className="flex min-w-0 items-center gap-3">
          <Kicker tone={showBrowserPreview || showFfmpegPreview ? "accent" : undefined}>
            {showBrowserPreview ? "Instant preview" : showFfmpegPreview ? "Rendered preview" : "Preview"}
          </Kicker>
          <span className="truncate font-mono text-[11px] text-fg-3">{summary}</span>
        </div>
        <div className="flex items-center gap-1">
          {showBrowserPreview ? (
            <Button size="sm" variant="ghost" onClick={onToggleExpanded}>
              {expanded ? "Dock" : "Focus"}
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={onToggleCollapsed} aria-label="Hide preview">
            Hide ▾
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden px-4 py-3">
        {showBrowserPreview ? (
          <PreviewPlayer
            player={previewPlayer}
            segments={browserPreviewSegments}
            state={browserPreviewState}
            effectCues={previewEffectCues}
            audioTimeline={audioTimeline}
            isExpanded={expanded}
            masterAudioUrl={masterAudioUrl}
          />
        ) : showFfmpegPreview && previewAssetUrl ? (
          <video
            key={previewAssetUrl}
            controls
            preload="metadata"
            src={previewAssetUrl}
            className="mx-auto h-full max-h-full rounded-md border border-line bg-black object-contain"
          />
        ) : (
          <div className="flex h-full items-center justify-center rounded-md border border-dashed border-line-2 bg-ink-0 text-[12px] text-fg-3">
            Use a stage&apos;s Preview button to prepare a playable cut.
          </div>
        )}
      </div>
    </aside>
  );
}
