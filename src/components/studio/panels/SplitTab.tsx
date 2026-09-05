"use client";

import { useMemo, useState } from "react";
import { fmt } from "../math";
import { SourceVideoTimeline } from "../SourceVideoTimeline";
import type { SourceClipSpan, SourceTimelineSegment, SplitMode } from "../sourceTimeline";
import { UploadControl } from "../UploadControl";
import type { BeatJoinAnalysis, DetectedSceneSegment, UploadedVideoSource } from "../types";

type SplitTabProps = {
  playhead: number;
  clipDur: number;
  mode: SplitMode;
  analysis: BeatJoinAnalysis | null;
  videoSources: UploadedVideoSource[];
  videoStatus: string;
  videoError: string | null;
  isPreparingVideos: boolean;
  sourceClips: SourceClipSpan[];
  segments: SourceTimelineSegment[];
  activeClip: number;
  onVideoUpload: (files: File[]) => void | Promise<void>;
  onClipDur: (v: number) => void;
  onModeChange: (mode: SplitMode) => void;
  onActiveClip: (i: number) => void;
};

type ReadinessTone = "ready" | "processing" | "failed" | "waiting";

type SplitModeOption = {
  mode: SplitMode;
  label: string;
  description: string;
  needsScenes: boolean;
  needsAudio: boolean;
};

const SPLIT_MODE_OPTIONS: SplitModeOption[] = [
  { mode: "scene", label: "Scene", description: "Use the visual scene changes already detected in the source footage.", needsScenes: true, needsAudio: false },
  { mode: "onset", label: "Rhythm", description: "Create cut windows from grouped musical attacks—not every beat.", needsScenes: false, needsAudio: true },
  { mode: "scene-onset", label: "Scene + Rhythm", description: "Preserve visual scenes and add musical cut points inside them.", needsScenes: true, needsAudio: true },
];

const CUT_PACE_OPTIONS = [
  { label: "Relaxed", clipDur: 10, detail: "Fewer, longer windows" },
  { label: "Balanced", clipDur: 6, detail: "Grouped rhythm windows" },
  { label: "Fast", clipDur: 2, detail: "More short windows" },
] as const;

export function SplitTab({
  playhead,
  clipDur,
  mode,
  analysis,
  videoSources,
  videoStatus,
  videoError,
  isPreparingVideos,
  sourceClips,
  segments,
  activeClip,
  onVideoUpload,
  onClipDur,
  onModeChange,
  onActiveClip,
}: SplitTabProps) {
  const [captionSearch, setCaptionSearch] = useState("");
  const totalDuration = sourceClips[sourceClips.length - 1]?.end ?? 0;
  const hasSources = videoSources.length > 0;
  const stats = getSplitStats(videoSources);
  const selectedSegment = segments[activeClip];
  const selectedCut = selectedSegment ? describeSegment(selectedSegment, activeClip, videoSources, sourceClips) : null;
  const visibleMode = mode === "beat" ? "onset" : mode === "scene-beat" ? "scene-onset" : mode;
  const activeMode = SPLIT_MODE_OPTIONS.find((option) => option.mode === visibleMode) ?? SPLIT_MODE_OPTIONS[0]!;
  const eventsPerCut = Math.max(1, Math.round(clipDur / 2));
  const splitReady = hasSources && segments.length > 0;
  const durationSummary = summarizeDurations(segments);
  const railWidth = getCutMapRailWidth(totalDuration);
  const visibleCuts = useMemo(
    () =>
      segments
        .map((segment, index) => describeSegment(segment, index, videoSources, sourceClips))
        .filter((cut) => matchesCutSearch(captionSearch, cut)),
    [captionSearch, segments, sourceClips, videoSources],
  );

  return (
    <div className="space-y-3">
      <section className="rounded-[2px] border border-[#1a1a1a] bg-[#0b0b0b] p-3">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-[#e05c00]">Create source cut windows</div>
            <div className="mt-1 max-w-4xl text-[11px] leading-5 text-[#707070]">
              Choose how the uploaded source footage becomes searchable edit windows. These are candidates for Match—not the final edit sequence.
            </div>
          </div>
          <div className={`rounded-[2px] border px-3 py-2 font-mono text-[10px] ${splitReady ? "border-[#245c2c] text-[#79c779]" : "border-[#402018] text-[#e05c00]"}`}>
            {splitReady ? `${segments.length} candidate window${segments.length === 1 ? "" : "s"}` : getModeWaitLabel(activeMode, stats, analysis)}
          </div>
        </div>

        <div className="grid gap-2 lg:grid-cols-3">
          {SPLIT_MODE_OPTIONS.map((option) => {
            const readiness = getModeReadiness(option, { hasSources, stats, analysis });
            const isActive = option.mode === visibleMode;
            return (
              <button
                key={option.mode}
                type="button"
                onClick={() => onModeChange(option.mode)}
                className={`rounded-[2px] border p-3 text-left transition-colors ${
                  isActive
                    ? "border-[#e05c00] bg-[#170c05]"
                    : "border-[#202020] bg-[#080808] hover:border-[#383838]"
                }`}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className={`text-[10px] uppercase tracking-[0.16em] ${isActive ? "text-[#e05c00]" : "text-[#9a9a9a]"}`}>{option.label}</span>
                  <span className={`h-2 w-2 ${getToneColor(readiness.tone, "dot")}`} />
                </div>
                <div className="text-[10px] leading-4 text-[#656565]">{option.description}</div>
                <div className={`mt-2 font-mono text-[8px] uppercase tracking-[0.1em] ${getToneColor(readiness.tone, "text")}`}>{readiness.label}</div>
              </button>
            );
          })}
        </div>

      </section>

      {hasSources ? (
        <SourceVideoTimeline
          sources={videoSources}
          playhead={playhead}
          label={buildSourceLabel(videoSources, sourceClips.length, totalDuration, visibleMode, segments.length)}
          height={86}
        />
      ) : (
        <div className="border border-[#1e1e1e] rounded-[2px] bg-[#070707] p-4">
          <div className="text-[10px] uppercase tracking-[0.18em] text-[#3a3a3a] mb-3">Source Video</div>
          <UploadControl
            accept="video/*"
            multiple
            title="No source video loaded yet."
            detail="Drag video clips here or click to choose files. Videos upload to RustFS, then scene detection and captions feed Split, Match, and Join."
            actionLabel={isPreparingVideos ? "Processing Videos..." : "Upload Video Clips"}
            disabled={isPreparingVideos}
            isProcessing={isPreparingVideos}
            status={videoStatus}
            error={videoError}
            onFiles={onVideoUpload}
          />
        </div>
      )}

      <section className="rounded-[2px] border border-[#1a1a1a] bg-[#0b0b0b] p-3">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-[#e05c00]">Cut map</div>
            <div className="mt-1 text-[11px] text-[#606060]">
              Cut numbers are candidate windows, not frames. Scroll horizontally to inspect dense results; switching strategy redraws this map immediately.
            </div>
          </div>
          {visibleMode === "scene" ? <div className="rounded-[2px] border border-[#244429] px-3 py-2 text-[9px] uppercase tracking-[0.12em] text-[#72a97a]">Original scene boundaries</div> : (
            <div className="flex gap-1.5" aria-label="Cut pace">
              {CUT_PACE_OPTIONS.map((option) => {
                const active = Math.abs(clipDur - option.clipDur) <= 1;
                return <button key={option.label} type="button" title={option.detail} onClick={() => onClipDur(option.clipDur)} className={`rounded-[2px] border px-3 py-2 text-[8px] uppercase tracking-[0.12em] ${active ? "border-[#e05c00] bg-[#170c05] text-[#e05c00]" : "border-[#242424] text-[#777] hover:border-[#444]"}`}>{option.label}</button>;
              })}
            </div>
          )}
        </div>

        <div className="mb-2 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[9px] text-[#666]">
          <span><b className="font-normal text-[#aaa]">{segments.length}</b> windows</span>
          <span><b className="font-normal text-[#aaa]">{durationSummary.average.toFixed(2)}s</b> average</span>
          <span><b className="font-normal text-[#aaa]">{durationSummary.minimum.toFixed(2)}s</b> shortest</span>
          <span><b className="font-normal text-[#aaa]">{durationSummary.maximum.toFixed(2)}s</b> longest</span>
          {visibleMode !== "scene" ? <span>{eventsPerCut} grouped events/window</span> : null}
          <span>fixed timeline scale</span>
        </div>

        {segments.length ? (
          <div className="overflow-x-auto rounded-[2px] border border-[#1a1a1a] bg-[#050505] pb-1">
            <div className="relative flex h-16" style={{ width: `${railWidth}px` }}>
              {segments.map((segment, i) => {
                const cut = describeSegment(segment, i, videoSources, sourceClips);
                return (
                  <button
                    key={`${segment.id}-${segment.start}-${segment.end}`}
                    type="button"
                    title={`Cut ${i + 1} · ${cut.sourceTimeLabel} · ${segment.duration.toFixed(2)}s`}
                    className={`relative flex-shrink-0 border-r border-[#0d0d0d] text-left transition-colors ${i === activeClip ? "bg-[#e05c0040]" : cut.tone === "ready" ? "bg-[#0b1810] hover:bg-[#102415]" : cut.tone === "failed" ? "bg-[#190a08] hover:bg-[#24100d]" : "bg-[#101010] hover:bg-[#171717]"}`}
                    style={{ width: `${(segment.duration / Math.max(totalDuration, 0.001)) * 100}%` }}
                    onClick={() => onActiveClip(i)}
                  >
                    {i === activeClip ? <div className="absolute inset-x-0 top-0 h-[2px] bg-[#e05c00]" /> : null}
                    <span className={`absolute left-1 top-1 h-[5px] w-[5px] ${getToneColor(cut.tone, "dot")}`} />
                    <span className="absolute bottom-1 left-1 font-mono text-[8px] text-[#777]">{i + 1}</span>
                    <span className="absolute right-1 top-1 truncate font-mono text-[7px] text-[#555]">{cut.shortSourceLabel}</span>
                  </button>
                );
              })}
              <div className="pointer-events-none absolute inset-y-0 w-[1px] bg-[#e05c00]" style={{ left: `${playhead * 100}%` }} />
            </div>
          </div>
        ) : (
          <div className="rounded-[2px] border border-dashed border-[#2a1d16] bg-[#080604] px-3 py-6 text-center">
            <div className="text-[10px] uppercase tracking-[0.16em] text-[#d24b3f]">No split cuts ready</div>
            <div className="mt-2 text-[11px] text-[#777]">{getModeWaitLabel(activeMode, stats, analysis)}</div>
          </div>
        )}
      </section>

      <div className="grid gap-3 xl:grid-cols-[320px_1fr]">
        <section className="rounded-[2px] border border-[#1a1a1a] bg-[#0b0b0b] p-3">
          <div className="mb-3 text-[10px] uppercase tracking-[0.18em] text-[#e05c00]">Selected cut</div>
          {selectedCut ? (
            <CutInspector cut={selectedCut} />
          ) : (
            <div className="rounded-[2px] border border-dashed border-[#202020] bg-[#070707] px-3 py-8 text-center text-[10px] uppercase tracking-[0.14em] text-[#4f4f4f]">
              Select a ready split cut.
            </div>
          )}
        </section>

        <section className="rounded-[2px] border border-[#1a1a1a] bg-[#0b0b0b] p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-[#e05c00]">Candidate cut table</div>
              <div className="mt-1 text-[11px] text-[#606060]">Repeated captions mean multiple rhythm windows came from the same detected visual scene.</div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={captionSearch}
                onChange={(event) => setCaptionSearch(event.target.value)}
                placeholder="Search scene captions, tags, actions…"
                className="w-64 rounded-[2px] border border-[#242424] bg-[#060606] px-3 py-2 font-mono text-[10px] text-[#d0d0d0] outline-none placeholder:text-[#444] focus:border-[#e05c00]"
              />
              <div className="font-mono text-[10px] text-[#777]">{visibleCuts.length}/{segments.length} cuts</div>
            </div>
          </div>
          {segments.length && visibleCuts.length ? (
            <div className="max-h-[560px] overflow-auto rounded-[2px] border border-[#171717] bg-[#070707]">
              <table className="w-full min-w-[720px] table-fixed border-collapse text-left">
                <thead className="sticky top-0 z-10 bg-[#0d0d0d] text-[8px] uppercase tracking-[0.13em] text-[#5f5f5f]">
                  <tr><th className="w-[10%] border-b border-[#202020] px-3 py-2 font-medium">Cut</th><th className="w-[24%] border-b border-[#202020] px-3 py-2 font-medium">Source time</th><th className="w-[10%] border-b border-[#202020] px-3 py-2 font-medium">Length</th><th className="w-[56%] border-b border-[#202020] px-3 py-2 font-medium">Detected scene caption</th></tr>
                </thead>
                <tbody>
                  {visibleCuts.slice(0, 100).map((cut) => (
                    <tr key={`${cut.segment.id}-${cut.segment.start}-${cut.segment.end}`} className={cut.index === activeClip ? "bg-[#160d08]" : "odd:bg-[#080808]"}>
                      <td className="border-b border-[#151515] px-3 py-2"><button type="button" onClick={() => onActiveClip(cut.index)} className="font-mono text-[9px] text-[#e05c00] hover:underline">{cut.index + 1}</button></td>
                      <td className="border-b border-[#151515] px-3 py-2 font-mono text-[9px] text-[#888]">{cut.sourceTimeLabel}</td>
                      <td className="border-b border-[#151515] px-3 py-2 font-mono text-[9px] text-[#aaa]">{cut.segment.duration.toFixed(2)}s</td>
                      <td className="border-b border-[#151515] px-3 py-2 text-[9px] leading-4 text-[#8f8f8f]"><span className={`mr-2 inline-block h-1.5 w-1.5 ${getToneColor(cut.tone, "dot")}`} />{cut.captionText}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {visibleCuts.length > 100 ? <div className="border-t border-[#171717] px-3 py-2 text-[9px] text-[#555]">Showing the first 100 of {visibleCuts.length} matches. Refine the search to narrow the table.</div> : null}
            </div>
          ) : segments.length ? (
            <div className="rounded-[2px] border border-dashed border-[#202020] bg-[#070707] px-3 py-10 text-center text-[10px] uppercase tracking-[0.14em] text-[#4f4f4f]">
              No cuts match that caption search.
            </div>
          ) : (
            <div className="rounded-[2px] border border-dashed border-[#202020] bg-[#070707] px-3 py-10 text-center text-[10px] uppercase tracking-[0.14em] text-[#4f4f4f]">
              Split output appears here after this mode has its required media.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export function getCutMapRailWidth(totalDuration: number) {
  return Math.max(960, Math.ceil(Math.max(0, totalDuration) * 8));
}

type SegmentCut = ReturnType<typeof describeSegment>;

function CutInspector({ cut }: { cut: SegmentCut }) {
  return (
    <div className="space-y-3">
      <div className="relative aspect-video overflow-hidden rounded-[2px] border border-[#181818] bg-[#050505]">
        {cut.thumbnailUrl ? <ThumbnailFill src={cut.thumbnailUrl} /> : null}
        <div className="absolute left-2 top-2 rounded-[2px] bg-[#000000aa] px-2 py-1 font-mono text-[9px] text-[#e05c00]">CUT {cut.index + 1}</div>
        <div className="absolute bottom-2 right-2 rounded-[2px] bg-[#000000aa] px-2 py-1 font-mono text-[9px] text-[#d0d0d0]">{cut.sourceTimeLabel}</div>
      </div>
      <div className={`rounded-[2px] border p-3 ${getToneColor(cut.tone, "panel")}`}>
        <div className={`mb-2 text-[9px] uppercase tracking-[0.14em] ${getToneColor(cut.tone, "text")}`}>{cut.statusLabel}</div>
        <div className="text-[11px] leading-5 text-[#b0b0b0]">{cut.captionText}</div>
        <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-[9px] text-[#666]">
          <div>Source: <span className="text-[#999]">{cut.shortSourceLabel}</span></div>
          <div>Dur: <span className="text-[#999]">{cut.segment.duration.toFixed(2)}s</span></div>
          <div>Scene: <span className="text-[#999]">{cut.scene?.label ?? "unmapped"}</span></div>
          <div>Match: <span className={cut.tone === "ready" ? "text-[#79c779]" : "text-[#d24b3f]"}>{cut.tone === "ready" ? "searchable" : "needs caption"}</span></div>
        </div>
        <CaptionBadges scene={cut.scene} />
      </div>
    </div>
  );
}

function CaptionBadges({ scene }: { scene: DetectedSceneSegment | null }) {
  if (!scene?.captionMode && !scene?.captionSource && !scene?.captionModel) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-1 font-mono text-[8px] uppercase tracking-[0.1em] text-[#555]">
      {scene.captionMode ? <span className="rounded-[2px] border border-[#1c1c1c] px-1 py-[1px]">{scene.captionMode}</span> : null}
      {scene.captionSource ? <span className="rounded-[2px] border border-[#1c1c1c] px-1 py-[1px]">{scene.captionSource}</span> : null}
      {scene.captionModel ? <span className="max-w-full truncate rounded-[2px] border border-[#1c1c1c] px-1 py-[1px]" title={scene.captionModel}>{scene.captionModel}</span> : null}
    </div>
  );
}

function matchesCutSearch(query: string, cut: SegmentCut) {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);
  if (!terms.length) return true;

  const scene = cut.scene;
  const haystack = [
    cut.source?.name,
    cut.sourceLabel,
    cut.statusLabel,
    cut.captionText,
    scene?.label,
    scene?.caption,
    scene?.captionError,
    scene?.captionSource,
    scene?.captionMode,
    scene?.captionModel,
    scene?.captionMeta?.caption,
    scene?.captionMeta?.shotType,
    scene?.captionMeta?.action,
    scene?.captionMeta?.setting,
    scene?.captionMeta?.lighting,
    scene?.captionMeta?.timeOfDay,
    scene?.captionMeta?.weather,
    ...(scene?.captionMeta?.subjects ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return terms.every((term) => haystack.includes(term));
}

function getSplitStats(sources: UploadedVideoSource[]) {
  return sources.reduce(
    (acc, source) => {
      const scenes = source.scenes ?? [];
      acc.sceneCount += scenes.length;
      acc.captionReady += scenes.filter((scene) => Boolean(scene.caption)).length;
      acc.captionTotal += scenes.length;
      if (source.sceneStatus === "detecting") acc.detecting += 1;
      if (source.sceneStatus === "failed") acc.sceneFailed += 1;
      if (source.captionStatus === "captioning") acc.captioning += 1;
      if (source.captionStatus === "failed") acc.captionFailed += 1;
      return acc;
    },
    { sceneCount: 0, captionReady: 0, captionTotal: 0, detecting: 0, sceneFailed: 0, captioning: 0, captionFailed: 0 },
  );
}

function ThumbnailFill({ src }: { src: string }) {
  const escapedSrc = src.replace(/(["\\])/g, "\\$1");
  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 bg-cover bg-center"
      style={{ backgroundImage: `url("${escapedSrc}")` }}
    />
  );
}

function getModeReadiness(option: SplitModeOption, state: { hasSources: boolean; stats: ReturnType<typeof getSplitStats>; analysis: BeatJoinAnalysis | null }) {
  if (!state.hasSources) return { tone: "waiting" as const, label: "upload videos" };
  if (option.needsScenes) {
    if (state.stats.sceneFailed) return { tone: "failed" as const, label: "scene error" };
    if (state.stats.sceneCount === 0) return { tone: state.stats.detecting ? "processing" as const : "waiting" as const, label: state.stats.detecting ? "detecting" : "needs scenes" };
  }
  if (option.needsAudio && !state.analysis) return { tone: "waiting" as const, label: "needs audio" };
  return { tone: "ready" as const, label: "ready" };
}

function getModeWaitLabel(option: SplitModeOption, stats: ReturnType<typeof getSplitStats>, analysis: BeatJoinAnalysis | null) {
  if (option.needsScenes && stats.sceneCount === 0) return stats.detecting ? "Waiting for scene detection to finish." : "Scene detection has not returned cuts for this mode.";
  if (option.needsAudio && !analysis) return "Upload and analyze the master song before using a rhythm strategy.";
  return "Upload videos or select a mode with ready prerequisites.";
}

function describeSegment(segment: SourceTimelineSegment, index: number, sources: UploadedVideoSource[], sourceClips: SourceClipSpan[]) {
  const sourceId = segment.sourceClipIds[0] ?? -1;
  const source = sources.find((candidate) => candidate.id === sourceId);
  const shortSourceLabel = formatSourceRefs(segment.sourceClipIds);
  const scene = resolveScene(segment, source, sourceClips);
  const captionError = scene?.captionError ?? source?.captionError ?? null;
  const caption = scene?.caption ?? null;
  const tone: ReadinessTone = captionError ? "failed" : caption ? "ready" : scene ? "waiting" : "processing";
  const statusLabel = captionError ? "Caption failed" : caption ? "Caption ready" : scene ? "Caption pending" : "Scene unmapped";

  return {
    index,
    segment,
    source,
    scene,
    tone,
    statusLabel,
    shortSourceLabel,
    sourceLabel: segment.sceneLabel ? `${shortSourceLabel} · ${segment.sceneLabel}` : scene ? `${shortSourceLabel} · ${scene.label}` : shortSourceLabel,
    sourceTimeLabel: formatSourceTimeLabel(segment, sourceClips),
    thumbnailUrl: segment.thumbnailUrl ?? scene?.thumbnailUrl ?? source?.thumbnailUrl,
    captionText: captionError ?? caption ?? "No caption text returned for this cut yet.",
  };
}

function formatSourceTimeLabel(segment: SourceTimelineSegment, sourceClips: SourceClipSpan[]) {
  if (segment.sourceClipIds.length !== 1) return `${formatSourceRefs(segment.sourceClipIds)} · crosses source boundary`;
  const sourceId = segment.sourceClipIds[0] ?? -1;
  const span = sourceClips.find((clip) => clip.id === sourceId);
  if (!span) return `${formatSourceRefs(segment.sourceClipIds)} · ${fmt(segment.start)}–${fmt(segment.end)}`;
  const start = Math.max(0, segment.start - span.start);
  const end = Math.min(span.duration, Math.max(start, segment.end - span.start));
  return `${formatSourceRefs(segment.sourceClipIds)} · ${fmt(start)}–${fmt(end)}`;
}

function summarizeDurations(segments: SourceTimelineSegment[]) {
  if (!segments.length) return { average: 0, minimum: 0, maximum: 0 };
  let total = 0;
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = 0;
  for (const segment of segments) {
    total += segment.duration;
    minimum = Math.min(minimum, segment.duration);
    maximum = Math.max(maximum, segment.duration);
  }
  return { average: total / segments.length, minimum, maximum };
}

function resolveScene(segment: SourceTimelineSegment, source: UploadedVideoSource | undefined, sourceClips: SourceClipSpan[]): DetectedSceneSegment | null {
  if (!source?.scenes?.length) return null;
  if (segment.sceneId !== undefined && segment.sceneId !== null) {
    const exact = source.scenes.find((scene) => scene.id === segment.sceneId);
    if (exact) return exact;
  }
  const sourceId = segment.sourceClipIds[0] ?? -1;
  const span = sourceClips.find((clip) => clip.id === sourceId);
  if (!span) return null;
  const localMidpoint = Math.max(0, Math.min(source.duration, ((segment.start + segment.end) / 2) - span.start));
  return source.scenes.find((scene) => localMidpoint >= scene.start && localMidpoint <= scene.end) ?? null;
}

function buildSourceLabel(sources: UploadedVideoSource[], sourceClipCount: number, totalDuration: number, mode: SplitMode, segmentCount: number) {
  const sceneCount = sources.reduce((total, source) => total + (source.scenes?.length ?? 0), 0);
  const hasFailed = sources.some((source) => source.sceneStatus === "failed");
  const provenance = hasFailed
    ? "SCENE DETECTION ERROR"
    : sceneCount > 0
      ? `PYSCENEDETECT · ${sceneCount} DETECTED SCENE${sceneCount === 1 ? "" : "S"}`
      : "SCENE DETECTION PENDING";

  return `SOURCE · ${sourceClipCount} VIDEO${sourceClipCount === 1 ? "" : "S"} · ${formatModeLabel(mode)} · ${segmentCount} CUTS · ${provenance} · ${fmt(totalDuration)}`;
}

function formatModeLabel(mode: SplitMode) {
  switch (mode) {
    case "scene":
      return "SCENE";
    case "beat":
      return "RHYTHM";
    case "onset":
      return "RHYTHM";
    case "scene-beat":
      return "SCENE+RHYTHM";
    case "scene-onset":
      return "SCENE+RHYTHM";
  }
}

function formatSourceRefs(sourceClipIds: number[]) {
  if (!sourceClipIds.length) return "S0";
  if (sourceClipIds.length === 1) return `S${sourceClipIds[0] + 1}`;
  const first = sourceClipIds[0] ?? 0;
  const last = sourceClipIds[sourceClipIds.length - 1] ?? first;
  return `S${first + 1}-${last + 1}`;
}

function getToneColor(tone: ReadinessTone, part: "dot" | "text" | "panel") {
  switch (tone) {
    case "ready":
      return part === "dot" ? "bg-[#3a8a3a]" : part === "text" ? "text-[#79c779]" : "border-[#245c2c] bg-[#071007]";
    case "processing":
      return part === "dot" ? "bg-[#e05c00]" : part === "text" ? "text-[#e05c00]" : "border-[#5a2d13] bg-[#100905]";
    case "failed":
      return part === "dot" ? "bg-[#d24b3f]" : part === "text" ? "text-[#d24b3f]" : "border-[#5a1f1a] bg-[#120706]";
    case "waiting":
      return part === "dot" ? "bg-[#555]" : part === "text" ? "text-[#777]" : "border-[#252525] bg-[#080808]";
  }
}
