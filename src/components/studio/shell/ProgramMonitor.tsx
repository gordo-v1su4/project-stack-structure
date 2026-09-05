"use client";

import { PreviewPlayer } from "../PreviewPlayerComponent";
import type { BrowserPreviewPlayer, PreviewPlayerState, PreviewSegment } from "../previewPlayer";
import type { ShaderEffectCue } from "../shaderEffectPlan";
import { getPreviewAssetFileName } from "../studioUiState";
import type { BeatJoinAnalysis } from "../types";

export type MonitorEmptyState = {
  /** Editorial headline: the song title, or what to do first. */
  headline: string;
  /** Meta line under the headline: BPM · duration · sections, or a hint. */
  meta: string | null;
  /** The pipeline's next-step line for the current act. */
  next: string | null;
};

type ProgramMonitorProps = {
  previewPlayer: BrowserPreviewPlayer;
  browserPreviewSegments: PreviewSegment[];
  browserPreviewState: PreviewPlayerState;
  isBrowserPreviewActive: boolean;
  previewEffectCues: ShaderEffectCue[];
  audioTimeline: Pick<BeatJoinAnalysis, "waveform" | "beats" | "onsets" | "duration"> | null;
  masterAudioUrl: string | null;
  previewAssetKey: string | null;
  previewAssetUrl: string | null;
  empty: MonitorEmptyState;
  /** Focus mode lets the monitor take the whole column height. */
  focused: boolean;
  onToggleFocused: () => void;
  /** Ingest renders its drop zone inside the monitor. */
  children?: React.ReactNode;
};

/**
 * The program monitor is the hero on every act. It plays the prepared cut
 * when one exists, the rendered section asset otherwise, and carries a
 * cinematic empty state when nothing is prepared yet — never a dashed box.
 */
export function ProgramMonitor({
  previewPlayer,
  browserPreviewSegments,
  browserPreviewState,
  isBrowserPreviewActive,
  previewEffectCues,
  audioTimeline,
  masterAudioUrl,
  previewAssetKey,
  previewAssetUrl,
  empty,
  focused,
  onToggleFocused,
  children,
}: ProgramMonitorProps) {
  const showBrowserPreview = browserPreviewSegments.length > 0;
  const showFfmpegPreview = !showBrowserPreview && !isBrowserPreviewActive && Boolean(previewAssetUrl);
  const assetFileName = getPreviewAssetFileName(previewAssetKey);
  const current = browserPreviewSegments[browserPreviewState.currentIndex] ?? null;

  const hud = showBrowserPreview
    ? `${browserPreviewSegments.length} cuts · ${browserPreviewState.totalDuration.toFixed(1)}s${masterAudioUrl ? " · master audio" : ""}`
    : showFfmpegPreview
      ? assetFileName ?? "Rendered preview"
      : null;

  return (
    <section
      aria-label="Program monitor"
      className={`vt-monitor studio-grain relative w-full shrink-0 overflow-hidden rounded-[10px] bg-black ${focused ? "flex-1 min-h-0" : "aspect-video max-h-[42vh]"}`}
    >
      {showBrowserPreview ? (
        <PreviewPlayer
          variant="monitor"
          player={previewPlayer}
          segments={browserPreviewSegments}
          state={browserPreviewState}
          effectCues={previewEffectCues}
          audioTimeline={audioTimeline}
          isExpanded={focused}
          masterAudioUrl={masterAudioUrl}
        />
      ) : showFfmpegPreview && previewAssetUrl ? (
        <video key={previewAssetUrl} controls preload="metadata" src={previewAssetUrl} className="absolute inset-0 h-full w-full object-contain" />
      ) : (
        <EmptyState empty={empty}>{children}</EmptyState>
      )}

      {/* HUD: glass over video only. */}
      {hud ? (
        <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2">
          <span className="studio-hud rounded-md px-2 py-1 font-mono text-[10.5px] text-fg-1">
            {showBrowserPreview ? "Instant preview" : "Rendered"} · {hud}
          </span>
          {current ? (
            <span className="studio-hud max-w-[40vw] truncate rounded-md px-2 py-1 font-mono text-[10.5px] text-fg-2">{current.label}</span>
          ) : null}
        </div>
      ) : null}
      {showBrowserPreview ? (
        <button
          type="button"
          onClick={onToggleFocused}
          className="studio-hud absolute right-3 top-3 rounded-md px-2 py-1 text-[11px] text-fg-1 hover:text-fg-0"
        >
          {focused ? "Dock" : "Focus"}
        </button>
      ) : null}
    </section>
  );
}

function EmptyState({ empty, children }: { empty: MonitorEmptyState; children?: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex flex-col justify-end bg-[radial-gradient(120%_90%_at_50%_110%,oklch(0.22_0.02_45/0.55),transparent_60%),linear-gradient(180deg,oklch(0.12_0.004_60),oklch(0.09_0.004_60))] p-7">
      <div className="flex items-end justify-between gap-8">
        <div className="min-w-0">
          <h1 className="font-display text-[clamp(28px,3.6vw,52px)] leading-[0.98] text-fg-0">{empty.headline}</h1>
          {empty.meta ? <p className="mt-2 font-mono text-[11.5px] tracking-[0.02em] text-fg-2">{empty.meta}</p> : null}
        </div>
        {empty.next ? (
          <p className="max-w-[36ch] shrink-0 text-right text-[12.5px] leading-5 text-fg-2">
            <span className="font-display italic text-[15px] text-accent">Next · </span>
            {empty.next}
          </p>
        ) : null}
      </div>
      {children ? <div className="mt-5">{children}</div> : null}
    </div>
  );
}
