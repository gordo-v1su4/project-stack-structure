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
  /** Footage frames (scene thumbnails) that back the empty state as a contact sheet. */
  frames: string[];
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
      className={`vt-monitor studio-grain relative w-full shrink-0 overflow-hidden rounded-[10px] bg-black ${
        focused ? "flex-1 min-h-0" : showBrowserPreview || showFfmpegPreview ? "aspect-video max-h-[42vh]" : "h-[clamp(180px,26vh,300px)]"
      }`}
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
  const frames = empty.frames.slice(0, 16);
  const rows = frames.length > 4 ? 2 : 1;
  const cols = Math.max(1, Math.ceil(frames.length / rows));
  return (
    <div className="absolute inset-0 flex flex-col justify-end bg-[linear-gradient(180deg,oklch(0.12_0.004_60),oklch(0.09_0.004_60))]">
      {frames.length ? (
        // Contact sheet of the footage: the room is never empty once media exists.
        <div
          aria-hidden
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}
          className="absolute inset-0 grid gap-px opacity-[0.55] [mask-image:linear-gradient(180deg,oklch(0_0_0/0.9),oklch(0_0_0/0.25)_70%,transparent)]"
        >
          {frames.map((src, index) => (
            // eslint-disable-next-line @next/next/no-img-element -- object URLs and gateway thumbnails
            <img key={`${src}-${index}`} src={src} alt="" className="h-full w-full object-cover saturate-[0.85]" />
          ))}
        </div>
      ) : (
        <div aria-hidden className="absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_110%,oklch(0.22_0.02_45/0.55),transparent_60%)]" />
      )}
      <div className="relative flex items-end justify-between gap-8 p-6">
        <div className="min-w-0">
          <h1 className="font-display text-[clamp(26px,3vw,44px)] leading-[0.98] text-fg-0 [text-shadow:0_1px_18px_oklch(0_0_0/0.6)]">{empty.headline}</h1>
          {empty.meta ? <p className="mt-2 font-mono text-[12px] tracking-[0.02em] text-fg-1">{empty.meta}</p> : null}
        </div>
        {empty.next ? (
          <p className="max-w-[36ch] shrink-0 text-right text-[13px] leading-5 text-fg-1">
            <span className="font-display italic text-[16px] text-accent">Next · </span>
            {empty.next}
          </p>
        ) : null}
      </div>
      {children ? <div className="relative px-6 pb-6">{children}</div> : null}
    </div>
  );
}
