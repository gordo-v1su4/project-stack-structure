"use client";

import { fmt } from "../math";
import { ParamSlider } from "../ParamSlider";
import { SourceVideoTimeline } from "../SourceVideoTimeline";
import type { SourceClipSpan, SourceTimelineSegment } from "../sourceTimeline";
import { UploadControl } from "../UploadControl";
import type { BeatJoinAnalysis, UploadedVideoSource } from "../types";

type BeatSplitTabProps = {
  playhead: number;
  bpm: number;
  barsPerSeg: number;
  splitMode: "beats" | "onsets";
  analysis: BeatJoinAnalysis | null;
  audioStatus: string;
  audioError: string | null;
  isPreparingAudio: boolean;
  videoSources: UploadedVideoSource[];
  videoStatus: string;
  videoError: string | null;
  isPreparingVideos: boolean;
  sourceClips: SourceClipSpan[];
  segments: SourceTimelineSegment[];
  sensitivity: number;
  activeClip: number;
  onAudioUpload: (files: File[]) => void | Promise<void>;
  onVideoUpload: (files: File[]) => void | Promise<void>;
  onBarsPerSeg: (v: number) => void;
  onSensitivity: (v: number) => void;
  onSplitMode: (v: "beats" | "onsets") => void;
  onActiveClip: (i: number) => void;
};

export function BeatSplitTab({
  playhead,
  bpm,
  barsPerSeg,
  splitMode,
  analysis,
  audioStatus,
  audioError,
  isPreparingAudio,
  videoSources,
  videoStatus,
  videoError,
  isPreparingVideos,
  sourceClips,
  segments,
  sensitivity,
  activeClip,
  onAudioUpload,
  onVideoUpload,
  onBarsPerSeg,
  onSensitivity,
  onSplitMode,
  onActiveClip,
}: BeatSplitTabProps) {
  const totalDuration = sourceClips[sourceClips.length - 1]?.end ?? 0;
  const barDuration = (60 / Math.max(1, bpm)) * 4;
  const estimatedBars = Math.max(1, Math.round(totalDuration / barDuration));
  const hasSources = videoSources.length > 0;
  const hasAnalysis = analysis !== null;
  const markerPreview = buildMarkerPreview({
    analysis,
    splitMode,
    targetEvents: barsPerSeg,
    density: sensitivity / 100,
  });

  return (
    <>
      {hasSources ? (
        <div className="space-y-3">
          <SourceVideoTimeline
            sources={videoSources}
            playhead={playhead}
            label={`A/V SOURCE · ${sourceClips.length} CLIP${sourceClips.length === 1 ? "" : "S"} STITCHED · ${fmt(totalDuration)}`}
            height={124}
          />
          <div className="grid gap-3 md:grid-cols-2">
            <div className="border border-[#1a1a1a] rounded-[2px] bg-[#0b0b0b] p-2">
              <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.16em] text-[#444]">
                <span>Source Clips</span>
                <UploadControl
                  accept="video/*"
                  multiple
                  variant="button"
                  title=""
                  detail=""
                  actionLabel={isPreparingVideos ? "Processing..." : "Replace Videos"}
                  disabled={isPreparingVideos}
                  onFiles={onVideoUpload}
                />
              </div>
            </div>
            <div className="border border-[#1a1a1a] rounded-[2px] bg-[#0b0b0b] p-2">
              <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.16em] text-[#444]">
                <span>Beat Sync Audio</span>
                <UploadControl
                  accept="audio/*"
                  variant="button"
                  title=""
                  detail=""
                  actionLabel={isPreparingAudio ? "Processing..." : hasAnalysis ? "Replace Audio" : "Upload Audio"}
                  disabled={isPreparingAudio}
                  onFiles={onAudioUpload}
                />
              </div>
              <div className="mt-2 text-[10px] font-mono text-[#6c6c6c]">{audioStatus}</div>
              {audioError ? <div className="mt-1 text-[10px] text-[#b96c43]">{audioError}</div> : null}
            </div>
          </div>
        </div>
      ) : (
        <div className="border border-[#1e1e1e] rounded-[2px] bg-[#070707] p-4">
          <div className="text-[10px] uppercase tracking-[0.18em] text-[#3a3a3a] mb-3">Beat Split Source</div>
          <UploadControl
            accept="video/*"
            multiple
            title="Beat Split needs uploaded video first."
            detail="Drop one or more video clips here. We will stitch them, extract thumbnails, and then slice the combined source using beat split logic."
            actionLabel={isPreparingVideos ? "Processing Videos..." : "Upload Video Clips"}
            disabled={isPreparingVideos}
            isProcessing={isPreparingVideos}
            status={videoStatus}
            error={videoError}
            onFiles={onVideoUpload}
          />
        </div>
      )}

      {hasAnalysis ? (
        <div className="border border-[#1a1a1a] rounded-[2px] bg-[#090909] p-2">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.16em] text-[#444]">
            <span>Split Marker Preview</span>
            <span className="font-mono text-[#666]">
              {markerPreview.activeCount}/{markerPreview.markers.length} kept
            </span>
          </div>
          <div className="relative mt-2 h-10 border border-[#121212] bg-[#060606] overflow-hidden">
            {markerPreview.markers.map((marker, index) => (
              <div
                key={`${marker.time}-${index}`}
                className="absolute bottom-0 w-[1px]"
                style={{
                  left: `${marker.position * 100}%`,
                  height: `${Math.max(20, marker.strength * 100)}%`,
                  background: marker.active ? "#ef7600" : "#3b3b3b",
                  opacity: marker.active ? 1 : 0.55,
                }}
              />
            ))}
          </div>
          <div className="mt-2 text-[10px] uppercase tracking-[0.12em] text-[#555]">
            {splitMode === "beats"
              ? "Variation shifts which beat groups land as segment boundaries."
              : "Density keeps the strongest onsets and fades weaker candidates first."}
          </div>
        </div>
      ) : (
        <div className="border border-[#1a1a1a] rounded-[2px] bg-[#0b0b0b] p-4">
          <UploadControl
            accept="audio/*"
            title="Beat Split needs the song too."
            detail="Upload the same audio track here or in Beat Join. Beat mode and onset mode both use that analysis to decide where the cuts land."
            actionLabel={isPreparingAudio ? "Processing Audio..." : "Upload Audio for Sync"}
            disabled={isPreparingAudio}
            isProcessing={isPreparingAudio}
            status={audioStatus}
            error={audioError}
            onFiles={onAudioUpload}
          />
        </div>
      )}

      <div className="border border-[#1a1a1a] rounded-[2px] bg-[#0c0c0c] overflow-hidden">
        <div className="flex items-center gap-4 px-3 py-2 border-b border-[#181818] text-[10px]">
          <span className="uppercase tracking-[0.18em] text-[#404040]">Beat Segments</span>
          <span className="font-mono text-[#555]">
            MODE <span className="text-[#e05c00]">{splitMode}</span>
          </span>
          <span className="font-mono text-[#555]">
            TARGET <span className="text-[#e05c00]">{barsPerSeg}</span>
          </span>
          <span className="font-mono text-[#555]">
            SEGS <span className="text-[#666]">{segments.length}</span>
          </span>
        </div>
        {hasSources ? (
          <div className="relative h-12 bg-[#070707] flex">
            {segments.map((segment, i) => (
              <div
                key={i}
                className={`relative border-r border-[#0d0d0d] cursor-pointer flex-shrink-0 transition-colors ${
                  i === activeClip
                    ? "bg-[#e05c0025]"
                    : analysis
                      ? splitMode === "onsets"
                        ? "bg-[#120a06]"
                        : "bg-[#0f0d08]"
                      : i % 2 === 0
                        ? "bg-[#0f0f0f]"
                        : "bg-[#0b0b0b]"
                }`}
                style={{ width: `${(segment.duration / Math.max(totalDuration, 0.001)) * 100}%` }}
                onClick={() => onActiveClip(i)}
              >
                {i === activeClip && <div className="absolute top-0 left-0 right-0 h-[2px] bg-[#e05c00]" />}
                <span className="absolute top-[4px] left-[4px] text-[8px] font-mono text-[#555]">
                  {formatSourceRefs(segment.sourceClipIds)}
                </span>
                <span className="absolute bottom-[3px] right-[3px] text-[7px] font-mono text-[#383838]">
                  {segment.duration.toFixed(1)}s
                </span>
              </div>
            ))}
            <div className="absolute inset-y-0 w-[1px] bg-[#e05c00]" style={{ left: `${playhead * 100}%` }} />
          </div>
        ) : (
          <div className="px-3 py-4 text-[10px] uppercase tracking-[0.14em] text-[#4f4f4f]">
            Upload video clips to calculate beat segments.
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="border border-[#1a1a1a] rounded-[2px] bg-[#0c0c0c] p-3">
          <div className="mb-1 text-[10px] uppercase tracking-[0.2em] text-[#404040]">Detection Params</div>
          <div className="mb-3 flex gap-2">
            {(["beats", "onsets"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => onSplitMode(mode)}
                className={`border rounded-[2px] px-3 py-1 text-[10px] uppercase tracking-[0.14em] ${
                  splitMode === mode ? "border-[#e05c00] text-[#e05c00] bg-[#e05c0012]" : "border-[#1e1e1e] text-[#666]"
                }`}
              >
                {mode === "beats" ? "Beat Mode" : "Onset Mode"}
              </button>
            ))}
          </div>
          <ParamSlider
            label={splitMode === "beats" ? "Beats / Segment" : "Onsets / Segment"}
            value={barsPerSeg}
            min={2}
            max={8}
            step={1}
            onChange={onBarsPerSeg}
          />
          <ParamSlider
            label={splitMode === "beats" ? "Variation" : "Density"}
            value={sensitivity}
            min={0}
            max={100}
            step={1}
            unit="%"
            onChange={onSensitivity}
          />
        </div>
        <div className="border border-[#1a1a1a] rounded-[2px] bg-[#0c0c0c] p-3">
          <div className="mb-1 text-[10px] uppercase tracking-[0.2em] text-[#404040]">Analysis Result</div>
          <div className="space-y-[4px]">
            {[
              ["Detected BPM", hasAnalysis ? Math.round(deriveDisplayBpm(analysis.beats, bpm)) : bpm],
              ["Audio sync", hasAnalysis ? "Live" : "Missing"],
              ["Estimated bars", estimatedBars],
              ["Segments", segments.length],
            ].map(([k, v]) => (
              <div key={String(k)} className="flex justify-between text-[11px] border-b border-[#141414] pb-1">
                <span className="text-[#484848]">{k}</span>
                <span className="font-mono text-[#e05c00]">{v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function formatSourceRefs(sourceClipIds: number[]) {
  if (!sourceClipIds.length) return "S0";
  if (sourceClipIds.length === 1) return `S${sourceClipIds[0] + 1}`;
  const first = sourceClipIds[0] ?? 0;
  const last = sourceClipIds[sourceClipIds.length - 1] ?? first;
  return `S${first + 1}-${last + 1}`;
}

function buildMarkerPreview(params: {
  analysis: BeatJoinAnalysis | null;
  splitMode: "beats" | "onsets";
  targetEvents: number;
  density: number;
}) {
  const { analysis, splitMode, targetEvents, density } = params;
  if (!analysis || analysis.duration <= 0) {
    return { markers: [], activeCount: 0 };
  }

  const duration = analysis.duration;
  if (splitMode === "beats") {
    const beats = uniqueSortedTimes(analysis.beats, duration);
    const target = clamp(Math.round(targetEvents), 1, 8);
    const markers = beats.map((time, index) => ({
      time,
      position: time / duration,
      strength: 0.65,
      active: index % target === 0,
    }));
    return { markers, activeCount: markers.filter((marker) => marker.active).length };
  }

  const onsets = uniqueSortedTimes(analysis.onsets, duration).map((time) => ({
    time,
    strength: clamp(sampleSeries(analysis.energy, duration, time) * 0.62 + sampleSeries(analysis.waveform, duration, time) * 0.38, 0.05, 1),
  }));
  const keepRatio = 0.35 + density * 0.65;
  const threshold = [...onsets].sort((left, right) => right.strength - left.strength)[Math.max(0, Math.floor(onsets.length * keepRatio) - 1)]?.strength ?? 0;
  const markers = onsets.map((onset) => ({
    time: onset.time,
    position: onset.time / duration,
    strength: onset.strength,
    active: onset.strength >= threshold,
  }));
  return { markers, activeCount: markers.filter((marker) => marker.active).length };
}

function uniqueSortedTimes(values: number[], duration: number) {
  return values
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= duration)
    .sort((left, right) => left - right)
    .filter((time, index, all) => index === 0 || Math.abs(time - all[index - 1]) > 0.015);
}

function deriveDisplayBpm(beats: number[], fallback: number) {
  if (beats.length < 2) return fallback;
  const intervals = beats
    .slice(1)
    .map((time, index) => time - beats[index])
    .filter((interval) => interval > 0.02)
    .sort((left, right) => left - right);
  const interval = intervals[Math.floor(intervals.length / 2)];
  return interval ? 60 / interval : fallback;
}

function sampleSeries(values: number[], duration: number, time: number) {
  if (!values.length || duration <= 0) return 0;
  const index = clamp(Math.floor((time / duration) * (values.length - 1)), 0, values.length - 1);
  return clamp(values[index] ?? 0, 0, 1);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
