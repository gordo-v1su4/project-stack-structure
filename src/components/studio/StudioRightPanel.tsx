"use client";

import { PreviewPlayer } from "./PreviewPlayerComponent";
import type { BrowserPreviewPlayer } from "./previewPlayer";
import type { PreviewPlayerState, PreviewSegment } from "./previewPlayer";
import type { ShaderEffectCue } from "./shaderEffectPlan";
import { getPreviewAssetFileName } from "./studioUiState";
import type { BeatJoinAnalysis, ShuffleMode, Tab } from "./types";

type StudioRightPanelProps = {
  readout: [string, string | number][];
  tab: Tab;
  shuffleMode: ShuffleMode;
  manifestSegmentCount?: number;
  rankedSegmentIds?: string[];
  previewAssetKey?: string | null;
  previewAssetUrl?: string | null;
  previewPlayer?: BrowserPreviewPlayer;
  browserPreviewSegments?: PreviewSegment[];
  browserPreviewState?: PreviewPlayerState;
  isBrowserPreviewActive?: boolean;
  previewEffectCues?: ShaderEffectCue[];
  audioTimeline?: Pick<BeatJoinAnalysis, "waveform" | "beats" | "onsets" | "duration"> | null;
  isPreviewExpanded?: boolean;
  onTogglePreviewExpanded?: () => void;
  isDockCollapsed?: boolean;
  onToggleDockCollapsed?: () => void;
  masterAudioUrl?: string | null;
  finalExportStatus?: string;
  finalExportUrl?: string | null;
  finalExportName?: string | null;
  finalExportCueCount?: number;
  finalExportDisabledReason?: string | null;
  isFinalExporting?: boolean;
  isShaderCaptureExporting?: boolean;
  onFinalExport?: () => void;
  onWebGpuExport?: () => void;
  audioStatus?: string;
  videoStatus?: string;
  draftStatus?: string;
  nextHint?: string | null;
};

export function StudioRightPanel({
  readout,
  tab,
  shuffleMode,
  manifestSegmentCount = 0,
  rankedSegmentIds = [],
  previewAssetKey = null,
  previewAssetUrl = null,
  previewPlayer,
  browserPreviewSegments = [],
  browserPreviewState,
  isBrowserPreviewActive = false,
  previewEffectCues = [],
  audioTimeline = null,
  isPreviewExpanded = false,
  onTogglePreviewExpanded,
  isDockCollapsed = false,
  onToggleDockCollapsed,
  masterAudioUrl = null,
  finalExportStatus = "Final export waits for a generated story preview and master audio.",
  finalExportUrl = null,
  finalExportName = null,
  finalExportCueCount = 0,
  finalExportDisabledReason = null,
  isFinalExporting = false,
  isShaderCaptureExporting = false,
  onFinalExport,
  onWebGpuExport,
  audioStatus = "",
  videoStatus = "",
  draftStatus = "",
  nextHint = null,
}: StudioRightPanelProps) {
  if (isDockCollapsed) {
    return (
      <div className="flex h-7 w-full shrink-0 items-center justify-between border-t border-[#181818] bg-[#0c0c0c] px-3">
        <span className="text-[8px] uppercase tracking-[0.22em] text-[#555]">Studio panels · {tab}</span>
        <button
          type="button"
          onClick={onToggleDockCollapsed}
          title="Expand studio panels"
          className="rounded-[2px] border border-[#2a2a2a] px-2 py-[2px] text-[8px] uppercase tracking-[0.12em] text-[#9a9a9a] hover:border-[#e05c00] hover:text-[#e05c00]"
        >
          ▲ Expand
        </button>
      </div>
    );
  }

  const previewAssetFileName = getPreviewAssetFileName(previewAssetKey);
  const showBrowserPreview = browserPreviewSegments.length > 0 && previewPlayer;
  const showFfmpegPreview = !showBrowserPreview && !isBrowserPreviewActive && previewAssetUrl;
  const segmentCountLabel = browserPreviewSegments.length > 0
    ? `${browserPreviewSegments.length} segments · ${browserPreviewState?.totalDuration.toFixed(1) ?? "0"}s`
    : null;

  return (
    <aside
      className={`${isPreviewExpanded
        ? "h-[min(68vh,760px)] grid-cols-1"
        : "h-[145px] grid-cols-[minmax(150px,0.6fr)_minmax(170px,0.65fr)_minmax(190px,0.75fr)_minmax(420px,2.35fr)_minmax(190px,0.7fr)_minmax(160px,0.55fr)]"
      } relative grid w-full shrink-0 items-start overflow-hidden border-t border-[#181818] bg-[#0c0c0c] transition-[height] duration-200`}
    >
      <button
        type="button"
        onClick={onToggleDockCollapsed}
        title="Minimize studio panels"
        className="absolute right-2 top-1 z-10 rounded-[2px] border border-[#2a2a2a] bg-[#0c0c0c] px-1.5 py-[1px] text-[8px] uppercase tracking-[0.12em] text-[#666] hover:border-[#e05c00] hover:text-[#e05c00]"
      >
        ▼
      </button>
      <div className={`${isPreviewExpanded ? "hidden" : "block"} min-w-0 border-r border-[#181818] p-2.5`}>
        <div className="mb-1.5 text-[8px] uppercase tracking-[0.22em] text-[#343434]">Live Readout</div>
        <div className="space-y-[5px]">
          {readout.map(([k, v]) => (
            <div key={String(k)} className="flex justify-between items-center">
              <span className="text-[10px] text-[#434343]">{k}</span>
              <span className="font-mono text-[11px] text-[#e05c00]">{v}</span>
            </div>
          ))}
        </div>
      </div>

      <div className={`${isPreviewExpanded ? "hidden" : "block"} min-w-0 border-r border-[#181818] p-2.5`}>
        <div className="mb-1.5 text-[8px] uppercase tracking-[0.22em] text-[#343434]">Next Step</div>
        <div className="rounded-[2px] border border-[#1d1208] bg-[#0d0803] px-2 py-[6px] text-[10px] leading-relaxed text-[#c07a3f]">
          {nextHint ?? "Work through the stages left to right; every stage dot turns green when it is ready."}
        </div>
        <div className="mt-2 font-mono text-[9px] text-[#4d4d4d] break-all" title={draftStatus}>
          {draftStatus || "Draft autosave idle"}
        </div>
      </div>

      <div className={`${isPreviewExpanded ? "hidden" : "block"} min-w-0 border-r border-[#181818] p-2.5`}>
        <div className="mb-1.5 text-[8px] uppercase tracking-[0.22em] text-[#343434]">Ranking Preview</div>
        <div className="space-y-[5px] text-[10px]">
          <div className="flex justify-between items-center">
            <span className="text-[#434343]">Manifest Segments</span>
            <span className="font-mono text-[#e05c00]">{manifestSegmentCount}</span>
          </div>
          <div>
            <div className="mb-1 text-[#434343]">Top Ranked</div>
            <div className="flex flex-wrap gap-1">
              {rankedSegmentIds.length ? (
                rankedSegmentIds.map((id) => (
                  <span key={id} className="border border-[#181818] bg-[#090909] px-2 py-1 font-mono text-[10px] text-[#777]">
                    {id}
                  </span>
                ))
              ) : (
                <span className="text-[#383838]">Awaiting analyzed segments</span>
              )}
            </div>
          </div>
          {previewAssetFileName && previewAssetFileName !== "browser-preview" ? (
            <div className="font-mono text-[9px] text-[#4d4d4d] break-all">{previewAssetFileName}</div>
          ) : null}
        </div>
      </div>

      <div className={`min-w-0 self-start border-r border-[#181818] ${isPreviewExpanded ? "col-span-full h-full overflow-hidden p-3" : "p-2.5"}`}>
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
          <div className="text-[9px] uppercase tracking-[0.22em] text-[#343434]">
            {showBrowserPreview ? "Instant Preview" : "Prepared Preview"}
          </div>
          {showBrowserPreview ? (
            <button
              type="button"
              onClick={onTogglePreviewExpanded}
              className="rounded-[2px] border border-[#242424] px-2 py-1 text-[8px] uppercase tracking-[0.12em] text-[#777] hover:border-[#e05c00] hover:text-[#e05c00]"
            >
              {isPreviewExpanded ? "Dock Preview" : "Focus Preview"}
            </button>
          ) : null}
        </div>
        {showBrowserPreview && browserPreviewState ? (
          <div className={isPreviewExpanded ? "space-y-2" : "space-y-1.5"}>
            <div className={`${isPreviewExpanded ? "flex" : "hidden"} flex-wrap items-center gap-2 rounded-[2px] border border-[#151515] bg-[#070707] px-2 py-1`}>
              <span
                className={`rounded-[2px] border px-2 py-1 text-[8px] uppercase tracking-[0.12em] ${
                  masterAudioUrl
                    ? "border-[#3a8a3a] text-[#79c779]"
                    : "border-[#242424] text-[#555]"
                }`}
              >
                {masterAudioUrl ? "Master audio live" : "No master audio"}
              </span>
              <span className="font-mono text-[8px] uppercase tracking-[0.1em] text-[#4d4d4d]">Master track leads sync</span>
            </div>
            <div className={`${isPreviewExpanded ? "block" : "hidden"} rounded-[2px] border border-[#151515] bg-[#060606] p-2`}>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={onFinalExport}
                  disabled={Boolean(finalExportDisabledReason) || !onFinalExport}
                  title={finalExportDisabledReason ?? undefined}
                  className={`rounded-[2px] px-2 py-1 text-[8px] font-semibold uppercase tracking-[0.12em] ${
                    finalExportDisabledReason || !onFinalExport
                      ? "bg-[#252525] text-[#646464] cursor-not-allowed"
                      : "bg-[#3a8a3a] text-white hover:bg-[#327832]"
                  }`}
                >
                  {isFinalExporting ? "Exporting..." : "Export MP4"}
                </button>
                <button
                  type="button"
                  onClick={onWebGpuExport}
                  disabled={Boolean(finalExportDisabledReason) || !onWebGpuExport}
                  title={finalExportDisabledReason ?? "Records the live WebGPU shader canvas, then muxes master audio to MP4."}
                  className={`rounded-[2px] px-2 py-1 text-[8px] font-semibold uppercase tracking-[0.12em] ${
                    finalExportDisabledReason || !onWebGpuExport
                      ? "bg-[#252525] text-[#646464] cursor-not-allowed"
                      : "bg-[#e05c00] text-white hover:bg-[#c94f00]"
                  }`}
                >
                  {isShaderCaptureExporting ? "Capturing WebGPU..." : "Export WebGPU"}
                </button>
                {finalExportUrl ? (
                  <a
                    href={finalExportUrl}
                    download={finalExportName ?? "stack-structure-final.mp4"}
                    className="rounded-[2px] border border-[#3a8a3a] px-2 py-1 text-[8px] font-semibold uppercase tracking-[0.12em] text-[#79c779] hover:bg-[#123512]"
                  >
                    Download {finalExportName ?? "MP4"}
                  </a>
                ) : null}
              </div>
              <div className="font-mono text-[8px] uppercase tracking-[0.1em] text-[#555]">
                {finalExportStatus}{finalExportCueCount ? ` · ${finalExportCueCount} cues` : ""}
              </div>
            </div>
            <PreviewPlayer
              player={previewPlayer}
              segments={browserPreviewSegments}
              state={browserPreviewState}
              effectCues={previewEffectCues}
              audioTimeline={audioTimeline}
              isExpanded={isPreviewExpanded}
              masterAudioUrl={masterAudioUrl}
            />
          </div>
        ) : showFfmpegPreview ? (
          <div className="space-y-2">
            <video
              key={previewAssetUrl}
              controls
              preload="metadata"
              src={previewAssetUrl}
              className="aspect-video w-full rounded-[2px] border border-[#181818] bg-black object-contain"
            />
            <div className="font-mono text-[9px] text-[#4d4d4d]">
              {previewAssetFileName ?? "Preview ready"}
            </div>
          </div>
        ) : (
          <div className="rounded-[2px] border border-dashed border-[#181818] bg-[#090909] px-2 py-4 text-[10px] text-[#383838]">
            Run a preview pass to prepare a playable section asset.
          </div>
        )}
        {segmentCountLabel && showBrowserPreview ? (
          <div className="mt-1 font-mono text-[9px] text-[#4d4d4d]">{segmentCountLabel}</div>
        ) : null}
      </div>

      <div className={`${isPreviewExpanded ? "hidden" : "block"} min-w-0 border-r border-[#181818] p-2.5`}>
        <div className="mb-1.5 text-[8px] uppercase tracking-[0.22em] text-[#343434]">Activity</div>
        <div className="space-y-[4px]">
          {[
            ["AUDIO", audioStatus],
            ["VIDEO", videoStatus],
            ["EXPORT", finalExportStatus],
          ]
            .filter(([, message]) => Boolean(message))
            .map(([tag, message]) => (
              <div key={tag} className="font-mono text-[9px] leading-tight">
                <span className="text-[#e05c0099]">[{tag}]</span>{" "}
                <span className="text-[#555]" title={message}>
                  {truncateMessage(message ?? "", 96)}
                </span>
              </div>
            ))}
        </div>
      </div>

      <div className={`${isPreviewExpanded ? "hidden" : "block"} min-w-0 p-2.5`}>
        <div className="mb-1 text-[8px] uppercase tracking-[0.22em] text-[#343434]">Tip</div>
        <p className="text-[10px] leading-relaxed text-[#383838]">
          {tab === "shuffle" && shuffleMode === "motion" ? (
            <>
              <span className="text-[#e05c00]">Lookahead 4–5</span> yields best motion continuity. Use Precise analysis for final render.
            </>
          ) : tab === "shuffle" && shuffleMode === "color" ? (
            <>
              <span className="text-[#e05c00]">Sunset</span> gradient works best on warm-toned footage. Match end/start palette for seamless cuts.
            </>
          ) : tab === "ramp" ? (
            <>
              Use <span className="text-[#e05c00]">Dynamic</span> with drop slowdown &lt;0.5 for cinematic music video pacing.
            </>
          ) : tab === "beatjoin" ? (
            <>
              Set <span className="text-[#e05c00]">Onset Boost</span> above 0.6 for punchy drum-reactive cuts on EDM.
            </>
          ) : (
            <>
              Upload the song and clips in <span className="text-[#e05c00]">Ingest</span>, generate the{" "}
              <span className="text-[#e05c00]">Story</span> plan, then review matches before export.
            </>
          )}
        </p>
      </div>
    </aside>
  );
}

function truncateMessage(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}
