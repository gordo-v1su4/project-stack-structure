"use client";

import {
  getMusicVideoShaderPreset,
  MUSIC_VIDEO_SHADER_PRESETS,
  SHADER_CUE_KINDS,
  type ShaderAccentKinds,
  type ShaderCueKind,
  type ShaderCueSync,
  type ShaderEffectCue,
} from "../shaderEffectPlan";
import type { BeatJoinAnalysis } from "../types";

type ShaderPresetSummary = {
  engine: string;
  shaders: Array<{ id: string; label: string; family: string; description: string }>;
};

const MAX_CUE_CHIPS = 12;

const ACCENT_LANES: Array<{ sync: ShaderCueSync; label: string }> = [
  { sync: "beat", label: "Beat accent" },
  { sync: "section", label: "Section accent" },
  { sync: "lyric", label: "Lyric accent" },
];

function formatCueRange(start: number, end: number) {
  return `${start.toFixed(2)}–${end.toFixed(2)}s`;
}

type ComposeTabProps = {
  analysis: BeatJoinAnalysis | null;
  storyGenerated: boolean;
  editSlotCount: number;
  storySegmentCount: number;
  lyricChunkCount: number;
  videoSourceCount: number;
  shaderPresetId: string;
  shaderPresetSummary: ShaderPresetSummary;
  shaderEffectCues?: ShaderEffectCue[];
  accentKinds?: ShaderAccentKinds;
  onAccentKindChange?: (sync: ShaderCueSync, kind: ShaderCueKind) => void;
  finalExportStatus: string;
  finalExportError: string | null;
  finalExportUrl: string | null;
  finalExportName: string | null;
  finalExportCueCount: number;
  finalExportDisabledReason: string | null;
  isFinalExporting: boolean;
  isShaderCaptureExporting: boolean;
  onShaderPresetId: (id: string) => void;
  onFinalExport: () => void;
  onWebGpuExport: () => void;
  onSelectStory: () => void;
};

export function ComposeTab({
  analysis,
  storyGenerated,
  editSlotCount,
  storySegmentCount,
  lyricChunkCount,
  videoSourceCount,
  shaderPresetId,
  shaderPresetSummary,
  shaderEffectCues = [],
  accentKinds = {},
  onAccentKindChange,
  finalExportStatus,
  finalExportError,
  finalExportUrl,
  finalExportName,
  finalExportCueCount,
  finalExportDisabledReason,
  isFinalExporting,
  isShaderCaptureExporting,
  onShaderPresetId,
  onFinalExport,
  onWebGpuExport,
  onSelectStory,
}: ComposeTabProps) {
  const readyChecks = [
    { label: "Master song", value: analysis ? `${analysis.duration.toFixed(1)}s` : "Missing", ready: Boolean(analysis) },
    { label: "Story edit plan", value: storyGenerated ? `${editSlotCount} slots` : "Generate Story", ready: storyGenerated && editSlotCount > 0 },
    { label: "Preview cuts", value: storySegmentCount ? `${storySegmentCount} segments` : "No cuts", ready: storySegmentCount > 0 },
    { label: "Lyric timing", value: lyricChunkCount ? `${lyricChunkCount} chunks` : "Optional", ready: lyricChunkCount > 0 },
    { label: "Source clips", value: videoSourceCount ? `${videoSourceCount} clips` : "Missing", ready: videoSourceCount > 0 },
  ];

  return (
    <div className="space-y-3">
      <section className="rounded-[2px] border border-[#1a1a1a] bg-[#0b0b0b] p-3">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-[#e05c00]">Compose / export</div>
            <div className="mt-1 max-w-3xl text-[11px] leading-relaxed text-[#6d6d6d]">
              This is the final assembly workspace. Story remains for ingest, lyrics, and story points; Compose uses that contract to preview the
              full music-video timeline, choose synced shader treatment, and render downloadable MP4s.
            </div>
          </div>
          <button
            type="button"
            onClick={onSelectStory}
            className="rounded-[2px] border border-[#242424] px-3 py-2 text-[9px] uppercase tracking-[0.14em] text-[#777] hover:border-[#e05c00] hover:text-[#e05c00]"
          >
            Back to Story
          </button>
        </div>

        <div className="grid gap-2 md:grid-cols-5">
          {readyChecks.map((check) => (
            <div key={check.label} className={`rounded-[2px] border p-3 ${check.ready ? "border-[#1f281f] bg-[#071007]" : "border-[#231818] bg-[#100707]"}`}>
              <div className={`text-[8px] uppercase tracking-[0.16em] ${check.ready ? "text-[#3a8a3a]" : "text-[#b96c43]"}`}>
                {check.ready ? "Ready" : "Needed"}
              </div>
              <div className="mt-1 text-[11px] text-[#9a9a9a]">{check.label}</div>
              <div className="mt-1 font-mono text-[10px] text-[#5c5c5c]">{check.value}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-[2px] border border-[#1a1a1a] bg-[#0b0b0b] p-3">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-[#e05c00]">Shader treatment</div>
            <div className="mt-1 max-w-3xl text-[11px] leading-relaxed text-[#6d6d6d]" data-treatment-explanation>
              {getMusicVideoShaderPreset(shaderPresetId).description} Synced cues are derived from story segments, beat/onset markers, section
              energy, and lyric chunks; the same cue timeline drives both the browser preview and the final MP4 export.
            </div>
          </div>
          <select
            value={shaderPresetId}
            onChange={(event) => onShaderPresetId(event.target.value)}
            className="rounded-[2px] border border-[#242424] bg-[#050505] px-2 py-2 text-[10px] text-[#bdbdbd] outline-none focus:border-[#e05c00]"
          >
            {MUSIC_VIDEO_SHADER_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>{preset.label}</option>
            ))}
          </select>
        </div>

        <div className="mb-2 grid gap-2 md:grid-cols-3">
          {ACCENT_LANES.map(({ sync, label }) => {
            const preset = getMusicVideoShaderPreset(shaderPresetId);
            const resolvedKind = accentKinds[sync] ?? preset[`${sync}Kind` as keyof typeof preset] as ShaderCueKind;
            return (
              <label key={sync} className="flex items-center justify-between gap-2 rounded-[2px] border border-[#171717] bg-[#070707] px-2 py-1.5">
                <span className="text-[8px] uppercase tracking-[0.16em] text-[#555]">{label}</span>
                <select
                  data-accent-select={sync}
                  value={resolvedKind}
                  onChange={(event) => onAccentKindChange?.(sync, event.target.value as ShaderCueKind)}
                  className="rounded-[2px] border border-[#242424] bg-[#050505] px-1.5 py-1 font-mono text-[9px] text-[#bdbdbd] outline-none focus:border-[#e05c00]"
                >
                  {SHADER_CUE_KINDS.map((kind) => (
                    <option key={kind} value={kind}>{kind}</option>
                  ))}
                </select>
              </label>
            );
          })}
        </div>

        {shaderEffectCues.length ? (
          <div className="mb-2 flex flex-wrap items-center gap-1" data-cue-chip-row>
            {shaderEffectCues.slice(0, MAX_CUE_CHIPS).map((cue) => (
              <span
                key={cue.id}
                data-cue-chip={cue.id}
                title={`${cue.kind} · ${cue.sync} · ${formatCueRange(cue.start, cue.end)} · intensity ${cue.intensity.toFixed(2)}`}
                className={`rounded-[2px] border px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.08em] ${
                  cue.sync === "beat"
                    ? "border-[#3a2410] bg-[#140b03] text-[#e08a3f]"
                    : cue.sync === "lyric"
                      ? "border-[#14301a] bg-[#04120a] text-[#79c779]"
                      : "border-[#101826] bg-[#04070f] text-[#6f9fd8]"
                }`}
              >
                {cue.kind} · {cue.sync}
              </span>
            ))}
            {shaderEffectCues.length > MAX_CUE_CHIPS ? (
              <span className="font-mono text-[8px] text-[#555]">+{shaderEffectCues.length - MAX_CUE_CHIPS} more</span>
            ) : null}
          </div>
        ) : null}

        <div className="rounded-[2px] border border-[#171717] bg-[#070707] p-2">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[8px] uppercase tracking-[0.16em] text-[#e05c00]">Stutter shader runtime</span>
            <span className="font-mono text-[9px] text-[#747474]">{shaderPresetSummary.engine}</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {shaderPresetSummary.shaders.map((shader) => (
              <span
                key={shader.id}
                title={shader.description}
                className="rounded-[2px] border border-[#202020] px-2 py-1 text-[8px] uppercase tracking-[0.1em] text-[#8f8f8f]"
              >
                {shader.label} · {shader.family}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-[2px] border border-[#1a1a1a] bg-[#0b0b0b] p-3">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-[#e05c00]">Final render</div>
            <div className="mt-1 text-[11px] text-[#6d6d6d]">
              Server MP4 uses the explicit ffmpeg export shader path. WebGPU MP4 records the live shader canvas and muxes it with the master track.
            </div>
          </div>
          {finalExportCueCount ? <div className="font-mono text-[10px] text-[#e05c00]">{finalExportCueCount} synced cues</div> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onFinalExport}
            disabled={Boolean(finalExportDisabledReason)}
            title={finalExportDisabledReason ?? undefined}
            className={`rounded-[2px] px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] ${
              finalExportDisabledReason
                ? "bg-[#252525] text-[#646464] cursor-not-allowed"
                : "bg-[#3a8a3a] text-white hover:bg-[#327832]"
            }`}
          >
            {isFinalExporting ? "Exporting..." : "Export Final MP4"}
          </button>
          <button
            type="button"
            onClick={onWebGpuExport}
            disabled={Boolean(finalExportDisabledReason)}
            title={finalExportDisabledReason ?? "Records the live WebGPU shader canvas, then muxes master audio to MP4."}
            className={`rounded-[2px] px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] ${
              finalExportDisabledReason
                ? "bg-[#252525] text-[#646464] cursor-not-allowed"
                : "bg-[#e05c00] text-white hover:bg-[#c94f00]"
            }`}
          >
            {isShaderCaptureExporting ? "Capturing WebGPU..." : "Export WebGPU MP4"}
          </button>
          {finalExportUrl ? (
            <a
              href={finalExportUrl}
              download={finalExportName ?? "stack-structure-final.mp4"}
              className="rounded-[2px] border border-[#3a8a3a] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#79c779] hover:bg-[#123512]"
            >
              Download {finalExportName ?? "MP4"}
            </a>
          ) : null}
        </div>
        <div className="mt-2 font-mono text-[9px] text-[#555]">{finalExportStatus}</div>
        {finalExportError ? <div className="mt-2 text-[10px] text-[#b96c43]">{finalExportError}</div> : null}
      </section>
    </div>
  );
}
