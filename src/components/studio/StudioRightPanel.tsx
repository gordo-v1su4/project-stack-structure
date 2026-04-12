"use client";

import { LOG } from "./constants";
import { PreviewPlayer } from "./PreviewPlayerComponent";
import type { BrowserPreviewPlayer } from "./previewPlayer";
import type { PreviewPlayerState, PreviewSegment } from "./previewPlayer";
import { getPreviewAssetFileName } from "./studioUiState";
import type { ShuffleMode, Tab } from "./types";

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
}: StudioRightPanelProps) {
  const previewAssetFileName = getPreviewAssetFileName(previewAssetKey);
  const showBrowserPreview = isBrowserPreviewActive && browserPreviewSegments.length > 0 && previewPlayer;
  const showFfmpegPreview = !isBrowserPreviewActive && previewAssetUrl;
  const segmentCountLabel = browserPreviewSegments.length > 0
    ? `${browserPreviewSegments.length} segments · ${browserPreviewState?.totalDuration.toFixed(1) ?? "0"}s`
    : null;

  return (
    <aside className="w-52 shrink-0 border-l border-[#181818] bg-[#0c0c0c] flex flex-col overflow-y-auto">
      <div className="border-b border-[#181818] p-3">
        <div className="mb-2 text-[9px] uppercase tracking-[0.22em] text-[#343434]">Live Readout</div>
        <div className="space-y-[5px]">
          {readout.map(([k, v]) => (
            <div key={String(k)} className="flex justify-between items-center">
              <span className="text-[10px] text-[#434343]">{k}</span>
              <span className="font-mono text-[11px] text-[#e05c00]">{v}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="border-b border-[#181818] p-3">
        <div className="mb-2 text-[9px] uppercase tracking-[0.22em] text-[#343434]">Output Pipeline</div>
        <div className="border border-[#181818] bg-[#080808] rounded-[2px] px-2 py-[5px] font-mono text-[10px] text-[#484848] mb-2">
          /output/processed_v1/
        </div>
        <div className="grid grid-cols-2 gap-2">
          {[
            ["QUEUE", "00:00"],
            ["CORES", "16384"],
          ].map(([k, v]) => (
            <div key={k} className="border border-[#181818] bg-[#090909] rounded-[2px] p-2">
              <div className="text-[9px] text-[#303030] mb-[2px]">{k}</div>
              <div className={`font-mono text-[12px] ${k === "CORES" ? "text-[#e05c00]" : "text-[#777]"}`}>{v}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="border-b border-[#181818] p-3">
        <div className="mb-2 text-[9px] uppercase tracking-[0.22em] text-[#343434]">Ranking Preview</div>
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

      <div className="border-b border-[#181818] p-3">
        <div className="mb-2 text-[9px] uppercase tracking-[0.22em] text-[#343434]">
          {showBrowserPreview ? "Sequential Preview" : "Prepared Preview"}
        </div>
        {showBrowserPreview && browserPreviewState ? (
          <PreviewPlayer
            player={previewPlayer}
            segments={browserPreviewSegments}
            state={browserPreviewState}
          />
        ) : showFfmpegPreview ? (
          <div className="space-y-2">
            <video
              key={previewAssetUrl}
              controls
              preload="metadata"
              src={previewAssetUrl}
              className="aspect-video w-full rounded-[2px] border border-[#181818] bg-[#050505]"
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

      <div className="border-b border-[#181818] p-3 flex-1">
        <div className="mb-2 text-[9px] uppercase tracking-[0.22em] text-[#343434]">Terminal</div>
        <div className="space-y-[4px]">
          {LOG.map((l, i) => (
            <div key={i} className="font-mono text-[9px] leading-tight">
              <span className="text-[#e05c0099]">[{l.tag}]</span> <span style={{ color: l.col }}>{l.msg}</span>
            </div>
          ))}
          <div className="font-mono text-[9px] text-[#2e2e2e] mt-1 animate-pulse">&gt; WAITING_FOR_OPERATOR_INPUT_</div>
        </div>
      </div>

      <div className="p-3">
        <div className="mb-1 text-[9px] uppercase tracking-[0.22em] text-[#343434]">Tip</div>
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
              Enable <span className="text-[#e05c00]">CUDA SM_120</span> for 4× faster encode than CPU on RTX 5090.
            </>
          )}
        </p>
      </div>
    </aside>
  );
}
