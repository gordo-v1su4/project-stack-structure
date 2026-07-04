"use client";

import { useMemo, useState } from "react";
import { fmt } from "../math";
import { ParamSlider } from "../ParamSlider";
import type { BeatJoinAnalysis, ColorGradient, ColorPaletteSwatch, MotionDescriptor } from "../types";
import { buildAdaptiveCueMap, type AdaptiveCueMap } from "../adaptiveCueMap";
import type { MusicVideoProject, SemanticClipMatch, VideoMoment } from "../musicVideoProject";
import { MatchCandidateRail } from "./MatchCandidateRail";
import { getDisplayCaption } from "./matchCaptions";
import { MATCH_MODE_DETAILS, MATCH_MODE_LABELS, getMatchModeLabel, getMatchModeScore, type MatchMode } from "./matchModes";

export type { MatchMode } from "./matchModes";

type MatchTabProps = {
  project: MusicVideoProject | null;
  analysis: BeatJoinAnalysis | null;
  storyGenerated: boolean;
  matchMode: MatchMode;
  onsetDensity: number;
  lyricCueBlend: number;
  lyricMergeWindow: number;
  colorGradient: ColorGradient;
  onMatchMode: (mode: MatchMode) => void;
  onOnsetDensity: (value: number) => void;
  onLyricCueBlend: (value: number) => void;
  onLyricMergeWindow: (value: number) => void;
  onColorGradient: (gradient: ColorGradient) => void;
  onSelectStory: () => void;
  onSelectSplit: () => void;
};

export function MatchTab({
  project,
  analysis,
  storyGenerated,
  matchMode,
  onsetDensity,
  lyricCueBlend,
  lyricMergeWindow,
  colorGradient,
  onMatchMode,
  onOnsetDensity,
  onLyricCueBlend,
  onLyricMergeWindow,
  onColorGradient,
  onSelectStory,
  onSelectSplit,
}: MatchTabProps) {
  const [boardView, setBoardView] = useState<"detail" | "thumbs">("detail");
  const hasLyrics = Boolean(project?.lyricChunks.length);
  const hasCaptions = Boolean(project?.videoMoments.some((moment) => moment.caption));
  const ready = storyGenerated && hasLyrics && hasCaptions;
  const momentsById = new Map((project?.videoMoments ?? []).map((moment) => [moment.id, moment]));
  const sectionsById = new Map((project?.storySections ?? []).map((section) => [section.id, section]));
  const cueMap = useMemo(() => buildAdaptiveCueMap({
    analysis,
    project,
    density: onsetDensity / 100,
    lyricBlend: lyricCueBlend / 100,
    lyricMergeWindowSeconds: lyricMergeWindow,
  }), [analysis, lyricCueBlend, lyricMergeWindow, onsetDensity, project]);
  const matchedItems = project?.editPlan.timelineItems ?? [];
  const weakCount = matchedItems.filter((item) => (item.semanticMatch?.score ?? 0) < 0.45).length;
  const holeCount = matchedItems.filter((item) => !item.videoMomentId).length;

  return (
    <div className="space-y-3">
      <section className="rounded-[2px] border border-[#1a1a1a] bg-[#0b0b0b] p-3">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-[#e05c00]">Match lyrics, story, music cues, and captioned clips</div>
            <div className="mt-1 max-w-4xl text-[11px] leading-5 text-[#6d6d6d]">
              Match chooses what belongs where. Split proves scene cuts; this board compares story/lyrics, captions, motion edges, color continuity, and section-level music cues before Join assembles the sequence.
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onSelectStory} className="rounded-[2px] border border-[#242424] px-3 py-2 text-[9px] uppercase tracking-[0.14em] text-[#9a9a9a] hover:border-[#e05c00] hover:text-[#e05c00]">Story</button>
            <button type="button" onClick={onSelectSplit} className="rounded-[2px] border border-[#242424] px-3 py-2 text-[9px] uppercase tracking-[0.14em] text-[#9a9a9a] hover:border-[#e05c00] hover:text-[#e05c00]">Split</button>
          </div>
        </div>

        <div className="grid gap-2 md:grid-cols-5">
          <GateCard label="Story" ready={storyGenerated} value={storyGenerated ? `${project?.storySections.length ?? 0} sections` : "Generate Story"} />
          <GateCard label="Lyrics" ready={hasLyrics} value={hasLyrics ? `${project?.lyricChunks.length ?? 0} SRT chunks` : "Waiting for stem"} />
          <GateCard label="Video captions" ready={hasCaptions} value={hasCaptions ? `${project?.videoMoments.filter((moment) => moment.caption).length ?? 0} captioned moments` : "Waiting for captions"} />
          <GateCard label="Cut blocks" ready={cueMap.chunks.length > 0} value={cueMap.chunks.length ? `${cueMap.chunks.length} blocks · ${cueMap.onsetActiveCount} music · ${cueMap.lyricActiveCount} lyric` : "Waiting for song"} />
          <GateCard label="Findings" ready={ready && weakCount === 0 && holeCount === 0} value={ready ? `${weakCount} weak · ${holeCount} holes` : "Locked"} />
        </div>
      </section>

      <section className="rounded-[2px] border border-[#1a1a1a] bg-[#0b0b0b] p-3">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-[#e05c00]">Adaptive music + lyric cut blocks</div>
            <div className="mt-1 text-[11px] text-[#6d6d6d]">Orange markers are music onsets. Cyan markers are SRT phrase boundaries. Density and blend snap in 5% steps. The merge window snaps in 0.5s steps so lyric cuts can lock to nearby music cuts without double-counting.</div>
          </div>
          <div className="grid min-w-[320px] flex-1 gap-2 md:min-w-[640px] md:grid-cols-3 md:gap-3">
            <ParamSlider label="Cut Density" value={onsetDensity} min={5} max={100} step={5} unit="%" layout="stack" onChange={onOnsetDensity} />
            <ParamSlider label="SRT Blend" value={lyricCueBlend} min={0} max={100} step={5} unit="%" accent="#32c7d7" layout="stack" onChange={onLyricCueBlend} />
            <ParamSlider label="Merge Window" value={lyricMergeWindow} min={0} max={5} step={0.5} unit="s" accent="#75d767" layout="stack" onChange={onLyricMergeWindow} />
          </div>
        </div>
        <MusicCueTimeline cueMap={cueMap} project={project} />
      </section>

      <section className="rounded-[2px] border border-[#1a1a1a] bg-[#0b0b0b] p-3">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-[#e05c00]">Match / shuffle strategy</div>
            <div className="mt-1 text-[11px] text-[#6d6d6d]">This changes what the board emphasizes. Join will later validate the chosen sequence edge-to-edge.</div>
          </div>
          <div className="font-mono text-[10px] uppercase text-[#777]">{MATCH_MODE_DETAILS[matchMode]}</div>
        </div>
        <div className="grid gap-2 md:grid-cols-5">
          {(Object.keys(MATCH_MODE_LABELS) as MatchMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => onMatchMode(mode)}
              className={`rounded-[2px] border px-3 py-2 text-[10px] uppercase tracking-[0.14em] transition-colors ${
                matchMode === mode ? "border-[#e05c00] bg-[#e05c0012] text-[#e05c00]" : "border-[#1f1f1f] bg-[#090909] text-[#666] hover:border-[#2b2b2b] hover:text-[#aaa]"
              }`}
            >
              {MATCH_MODE_LABELS[mode]}
            </button>
          ))}
        </div>
        {matchMode === "color" ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-[9px] uppercase tracking-[0.16em] text-[#555]">Palette lane</span>
            {(["Rainbow", "Sunset", "Ocean"] as const).map((gradient) => (
              <button
                key={gradient}
                type="button"
                onClick={() => onColorGradient(gradient)}
                className={`rounded-[2px] border px-2 py-1 text-[9px] uppercase tracking-[0.12em] ${
                  colorGradient === gradient ? "border-[#e05c00] text-[#e05c00]" : "border-[#1e1e1e] text-[#555]"
                }`}
              >
                {gradient}
              </button>
            ))}
          </div>
        ) : null}
      </section>

      {!ready ? (
        <section className="rounded-[2px] border border-dashed border-[#252525] bg-[#080808] p-6 text-center">
          <div className="text-[10px] uppercase tracking-[0.18em] text-[#d24b3f]">Match is locked</div>
          <div className="mt-3 text-[11px] leading-5 text-[#777]">
            Complete Story generation and video scene captions first. You can inspect the music cue map now, but matching actions stay locked until lyric SRT chunks and video captions are both ready.
          </div>
        </section>
      ) : null}

      <section className="rounded-[2px] border border-[#1a1a1a] bg-[#0b0b0b] p-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-[#e05c00]">Section match board</div>
            <div className="mt-1 text-[11px] text-[#6d6d6d]">Cards show the chosen candidate, first/middle/last frames, clip-edge labels, and the weighted reasons behind the match.</div>
          </div>
          <div className="flex items-center gap-2">
            <div className="rounded-[2px] border border-[#202020] bg-[#070707] p-1">
              {(["thumbs", "detail"] as const).map((view) => (
                <button
                  key={view}
                  type="button"
                  onClick={() => setBoardView(view)}
                  className={`px-2 py-1 text-[8px] uppercase tracking-[0.12em] ${boardView === view ? "bg-[#e05c00] text-white" : "text-[#666] hover:text-[#d0d0d0]"}`}
                >
                  {view === "thumbs" ? "Thumb board" : "Detail"}
                </button>
              ))}
            </div>
            <div className="font-mono text-[10px] text-[#777]">{matchedItems.length} slots · {matchMode}</div>
          </div>
        </div>

        {matchedItems.length ? (
          <div className={boardView === "thumbs" ? "grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5" : "grid gap-2 xl:grid-cols-2"}>
            {matchedItems.map((item) => {
              const moment = item.videoMomentId ? momentsById.get(item.videoMomentId) : undefined;
              const section = sectionsById.get(item.sectionId);
              const candidateMatches = section?.candidateMatches?.length ? section.candidateMatches : item.semanticMatch ? [item.semanticMatch] : [];
              return boardView === "thumbs"
                ? <ThumbMatchCard key={item.id} label={item.label} start={item.start} end={item.end} match={item.semanticMatch} moment={moment} mode={matchMode} />
                : (
                  <MatchCard
                    key={item.id}
                    label={item.label}
                    start={item.start}
                    end={item.end}
                    prompt={item.prompt}
                    match={item.semanticMatch}
                    moment={moment}
                    mode={matchMode}
                    candidateMatches={candidateMatches}
                    momentsById={momentsById}
                  />
                );
            })}
          </div>
        ) : (
          <div className="rounded-[2px] border border-dashed border-[#202020] bg-[#070707] px-3 py-8 text-center text-[10px] uppercase tracking-[0.14em] text-[#4f4f4f]">Generate Story to create match slots.</div>
        )}
      </section>
    </div>
  );
}

function ThumbMatchCard({ label, start, end, match, moment, mode }: { label: string; start: number; end: number; match?: SemanticClipMatch; moment?: VideoMoment; mode: MatchMode }) {
  const score = match ? Math.round(match.score * 100) : 0;
  const hole = !moment || score < 35;
  const direction = inferMotionDirection(moment);
  const palette = buildPalette(moment, mode);
  const frameUrl = moment?.firstFrameUrl ?? moment?.thumbnailUrl;

  return (
    <article className={`overflow-hidden rounded-[2px] border ${hole ? "border-[#7a241e] bg-[#120706]" : "border-[#202020] bg-[#080808]"}`}>
      <div className="relative aspect-video bg-[#030303]">
        {frameUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={frameUrl} alt={label} className="h-full w-full object-cover" loading="lazy" decoding="async" />
        ) : null}
        <div className="absolute left-2 top-2 rounded-[2px] bg-[#000000b8] px-2 py-1 text-[8px] uppercase tracking-[0.12em] text-[#d0d0d0]">{label}</div>
        <div className={`absolute right-2 top-2 rounded-[2px] border px-2 py-1 font-mono text-[8px] ${hole ? "border-[#7a241e] text-[#d24b3f]" : "border-[#245c2c] text-[#79c779]"}`}>{hole ? "HOLE" : `${score}%`}</div>
        <div className="absolute bottom-2 left-2 rounded-[2px] bg-[#000000b8] px-2 py-1 font-mono text-[8px] text-[#e05c00]">{direction.label}</div>
        <div className="absolute bottom-2 right-2 rounded-[2px] bg-[#000000b8] px-2 py-1 font-mono text-[8px] text-[#aaa]">{fmt(start)}–{fmt(end)}</div>
      </div>
      <div className="flex h-3">
        {palette.map((color, index) => <div key={`${label}-${color}-${index}`} className="flex-1" style={{ background: color }} />)}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-[#141414] px-2 py-2 font-mono text-[8px] uppercase tracking-[0.1em] text-[#666]">
        <span className="truncate">{moment?.sourceRefLabel ?? "No candidate"}</span>
        <span className={hole ? "text-[#d24b3f]" : "text-[#777]"}>{getMatchModeLabel(mode, match)}</span>
      </div>
    </article>
  );
}

function GateCard({ label, value, ready }: { label: string; value: string; ready: boolean }) {
  return (
    <div className={`rounded-[2px] border px-3 py-2 ${ready ? "border-[#245c2c] bg-[#081108]" : "border-[#252525] bg-[#080808]"}`}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[8px] uppercase tracking-[0.16em] text-[#5c5c5c]">{label}</span>
        <span className={`h-2 w-2 rounded-full ${ready ? "bg-[#3a8a3a]" : "bg-[#454545]"}`} />
      </div>
      <div className={`font-mono text-[10px] ${ready ? "text-[#79c779]" : "text-[#777]"}`}>{value}</div>
    </div>
  );
}

function MusicCueTimeline({ cueMap, project }: { cueMap: AdaptiveCueMap; project: MusicVideoProject | null }) {
  const duration = cueMap.duration || project?.duration || 0;
  if (!duration) {
    return <div className="rounded-[2px] border border-dashed border-[#202020] bg-[#070707] px-3 py-8 text-center text-[10px] uppercase tracking-[0.14em] text-[#4f4f4f]">Upload/analyze master song to show adaptive cut blocks.</div>;
  }

  return (
    <div className="rounded-[2px] border border-[#151515] bg-[#060606] p-2">
      <div className="relative h-24 overflow-hidden border border-[#101010] bg-[#040404]">
        {project?.storySections.map((section) => {
          const left = clamp01(section.start / duration) * 100;
          const width = Math.max(0.15, clamp01((section.end - section.start) / duration) * 100);
          return (
            <div
              key={section.id}
              className="absolute inset-y-0 border-r border-[#241408] bg-[#e05c0006]"
              style={{ left: `${left}%`, width: `${width}%` }}
              title={`${section.label} · ${fmt(section.start)}–${fmt(section.end)}`}
            >
              <span className="absolute left-1 top-1 max-w-[140px] truncate text-[8px] uppercase tracking-[0.12em] text-[#8a4b20]">{section.label}</span>
            </div>
          );
        })}
        {cueMap.chunks.map((chunk) => {
          const left = clamp01(chunk.start / duration) * 100;
          const width = Math.max(0.12, clamp01((chunk.end - chunk.start) / duration) * 100);
          return (
            <button
              key={chunk.id}
              type="button"
              className="absolute bottom-2 top-6 border border-[#0c0c0c] text-left transition-colors hover:border-[#e05c00]"
              style={{
                left: `${left}%`,
                width: `${width}%`,
                background: `rgba(224, 92, 0, ${0.16 + chunk.strength * 0.58})`,
              }}
              title={`${chunk.sectionLabel} · ${fmt(chunk.start)}–${fmt(chunk.end)} · ${chunk.onsetCueCount} music · ${chunk.lyricCueCount} lyric`}
            >
              <span className="absolute bottom-1 left-1 text-[7px] font-mono text-[#120700] opacity-70">{chunk.onsetCueCount}+{chunk.lyricCueCount}</span>
            </button>
          );
        })}
        {cueMap.markers.map((marker, index) => (
          <div
            key={`${marker.kind}-${index}-${marker.time}`}
            className={`absolute bottom-2 ${marker.kind === "lyric" ? "w-[2px]" : "w-px"}`}
            style={{
              left: `${marker.position * 100}%`,
              height: `${Math.max(12, marker.strength * (marker.kind === "lyric" ? 48 : 62))}%`,
              background: marker.kind === "lyric"
                ? marker.mergedWithTime !== undefined
                  ? "#75d767"
                  : marker.active
                    ? "#32c7d7"
                    : "#1d3a3e"
                : marker.active
                  ? "#ff9a28"
                  : "#333",
              opacity: marker.active ? 0.92 : 0.3,
            }}
            title={marker.kind === "lyric"
              ? `SRT ${fmt(marker.time)} · ${marker.label ?? "phrase"}${marker.mergedWithTime !== undefined ? ` · merged with onset ${fmt(marker.mergedWithTime)}` : marker.active ? " · added cut" : " · filtered"}${marker.text ? ` · ${marker.text}` : ""}`
              : `onset ${fmt(marker.time)} · strength ${marker.strength.toFixed(2)}${marker.active ? " · section-kept" : " · filtered"}`}
          />
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between font-mono text-[9px] text-[#555]">
        <span>0:00</span>
        <span>{cueMap.chunks.length} blocks · {cueMap.onsetActiveCount} active onsets · {cueMap.lyricActiveCount}/{cueMap.lyricCount} SRT markers · {cueMap.lyricMergedCount} merged · {cueMap.beatCount} beats</span>
        <span>{fmt(duration)}</span>
      </div>
    </div>
  );
}

function MatchCard({
  label,
  start,
  end,
  prompt,
  match,
  moment,
  mode,
  candidateMatches,
  momentsById,
}: {
  label: string;
  start: number;
  end: number;
  prompt: string;
  match?: SemanticClipMatch;
  moment?: VideoMoment;
  mode: MatchMode;
  candidateMatches: SemanticClipMatch[];
  momentsById: Map<string, VideoMoment>;
}) {
  const score = match ? Math.round(match.score * 100) : 0;
  const ready = Boolean(moment?.caption && score >= 45);
  const modeScore = getMatchModeScore(mode, match);
  const caption = getDisplayCaption(moment);
  const palette = buildPalette(moment, mode);
  const direction = inferMotionDirection(moment);

  return (
    <article className={`overflow-hidden rounded-[2px] border ${ready ? "border-[#245c2c] bg-[#071007]" : "border-[#2a1717] bg-[#0c0707]"}`}>
      <div className="grid gap-0 md:grid-cols-[230px_1fr]">
        <FrameStrip moment={moment} direction={direction} palette={palette} />
        <div className="flex min-w-0 flex-col p-3">
          <div className="mb-2 flex items-start justify-between gap-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#d0d0d0]">{label}</div>
              <div className="mt-1 font-mono text-[9px] text-[#777]">{fmt(start)}–{fmt(end)}</div>
            </div>
            <div className={`rounded-[2px] border px-2 py-1 font-mono text-[9px] ${ready ? "border-[#245c2c] text-[#79c779]" : "border-[#7a241e] text-[#d24b3f]"}`}>{ready ? `${score}% match` : "needs match"}</div>
          </div>
          <div className="rounded-[2px] border border-[#171717] bg-[#050505] p-2 text-[10px] leading-4 text-[#9a9a9a]">
            <span className="text-[#e05c00]">Story:</span> {prompt}
          </div>
          <div className="mt-2 rounded-[2px] border border-[#171717] bg-[#050505] p-2 text-[10px] leading-4 text-[#b0b0b0]">
            <div className="mb-1 text-[8px] uppercase tracking-[0.14em] text-[#555]">Candidate caption / semantic meaning</div>
            {moment ? caption : <span className="text-[#d24b3f]">No video moment selected yet.</span>}
            {moment ? <div className="mt-2 font-mono text-[8px] text-[#666]">{moment.sourceRefLabel ?? `S${moment.sourceClipId + 1}`} · {fmt(moment.start)}–{fmt(moment.end)}</div> : null}
            {match?.reasons.length ? <div className="mt-2 text-[8px] uppercase tracking-[0.12em] text-[#606060]">{match.reasons.slice(0, 3).join(" · ")}</div> : null}
          </div>
          <MatchCandidateRail candidateMatches={candidateMatches} selectedMomentId={moment?.id ?? match?.momentId ?? null} momentsById={momentsById} mode={mode} />
          <div className="mt-2 grid gap-2 md:grid-cols-[1fr_170px]">
            <div className="rounded-[2px] border border-[#171717] bg-[#050505] p-2">
              <div className="mb-2 text-[8px] uppercase tracking-[0.14em] text-[#555]">Edge / continuity labels</div>
              <div className="grid grid-cols-3 gap-1 text-[8px] uppercase tracking-[0.1em]">
                <div className="rounded-[2px] border border-[#1d1d1d] px-2 py-1 text-[#777]">In edge<br /><span className="font-mono text-[#b0b0b0]">{direction.inEdge}</span></div>
                <div className="rounded-[2px] border border-[#1d1d1d] px-2 py-1 text-[#777]">Motion<br /><span className="font-mono text-[#e05c00]">{direction.label}</span></div>
                <div className="rounded-[2px] border border-[#1d1d1d] px-2 py-1 text-[#777]">Out edge<br /><span className="font-mono text-[#b0b0b0]">{direction.outEdge}</span></div>
              </div>
            </div>
            <div className="rounded-[2px] border border-[#171717] bg-[#050505] p-2">
              <div className="mb-2 text-[8px] uppercase tracking-[0.14em] text-[#555]">Weights</div>
              <ScoreBar label="Mode" value={modeScore} active />
              <ScoreBar label="Caption" value={match?.lyricCaptionScore ?? 0} />
              <ScoreBar label="Action" value={match?.actionIntentScore ?? 0} />
              <ScoreBar label="Motion" value={match?.motionContinuityScore ?? 0} />
              <ScoreBar label="Energy" value={match?.motionEnergyScore ?? 0} />
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

function FrameStrip({ moment, direction, palette }: { moment?: VideoMoment; direction: MotionLabel; palette: string[] }) {
  const frames = [
    { label: "First", url: moment?.firstFrameUrl ?? moment?.thumbnailUrl },
    { label: direction.label, url: moment?.middleFrameUrl ?? moment?.thumbnailUrl },
    { label: "Last", url: moment?.lastFrameUrl ?? moment?.thumbnailUrl },
  ];

  return (
    <div className="border-b border-[#141414] bg-[#050505] p-2 md:border-b-0 md:border-r">
      <div className="grid grid-cols-3 gap-1">
        {frames.map((frame) => (
          <div key={frame.label} className="relative aspect-[4/5] overflow-hidden rounded-[2px] border border-[#151515] bg-[#030303]">
            {frame.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={frame.url} alt={frame.label} className="h-full w-full object-cover" loading="lazy" decoding="async" />
            ) : <div className="h-full w-full bg-[#101010]" />}
            <div className="absolute left-1 top-1 rounded-[1px] bg-[#000000aa] px-1 py-[1px] text-[7px] uppercase tracking-[0.1em] text-[#d0d0d0]">{frame.label}</div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex h-3 overflow-hidden rounded-[2px] border border-[#111]">
        {palette.map((color, index) => <div key={`${color}-${index}`} className="flex-1" style={{ background: color }} />)}
      </div>
    </div>
  );
}

function ScoreBar({ label, value, active = false }: { label: string; value: number; active?: boolean }) {
  const score = clamp01(value);
  return (
    <div className="mb-[5px] grid grid-cols-[48px_1fr_28px] items-center gap-2 text-[8px] uppercase tracking-[0.1em]">
      <span className={active ? "text-[#e05c00]" : "text-[#555]"}>{label}</span>
      <div className="h-[3px] rounded-full bg-[#171717]">
        <div className="h-full rounded-full" style={{ width: `${score * 100}%`, background: active ? "#e05c00" : score >= 0.45 ? "#477d47" : "#333" }} />
      </div>
      <span className="text-right font-mono text-[#666]">{Math.round(score * 100)}</span>
    </div>
  );
}

type MotionLabel = { label: string; inEdge: string; outEdge: string };

function inferMotionDirection(moment?: VideoMoment): MotionLabel {
  const descriptor = moment?.motionDescriptor ?? moment?.visualAnalysis?.motion;
  const descriptorLabel = descriptor ? motionLabelFromDescriptor(descriptor) : null;
  if (descriptorLabel) return descriptorLabel;

  const text = [moment?.caption, moment?.captionMeta?.action, moment?.captionMeta?.setting, moment?.captionMeta?.shotType].filter(Boolean).join(" ").toLowerCase();
  if (/rain|down|fall|descend|drop/.test(text)) return { label: "Down", inEdge: "north", outEdge: "south" };
  if (/rise|up|stand|lift/.test(text)) return { label: "Up", inEdge: "south", outEdge: "north" };
  if (/turn|spin|crowd|dance|club/.test(text)) return { label: "Mixed", inEdge: "center", outEdge: "center" };
  if (/walk|street|alley|confront|face/.test(text)) return { label: "West→East", inEdge: "west", outEdge: "east" };
  if (/static|still|table|wall|hands/.test(text)) return { label: "Static", inEdge: "hold", outEdge: "hold" };
  return { label: "Unknown", inEdge: "open", outEdge: "open" };
}

function buildPalette(moment: VideoMoment | undefined, mode: MatchMode) {
  const analyzedPalette = [
    ...(moment?.visualAnalysis?.color?.firstPalette ?? []),
    ...(moment?.visualAnalysis?.color?.middlePalette ?? []),
    ...(moment?.visualAnalysis?.color?.lastPalette ?? []),
    ...(moment?.visualAnalysis?.color?.palette ?? []),
  ];
  const realColors = paletteToHex(analyzedPalette);
  if (realColors.length) return realColors.slice(0, 5);

  const seed = `${mode}:${moment?.caption ?? moment?.label ?? "empty"}`;
  const palettes = [
    ["#2a4966", "#8f3f86", "#e07929"],
    ["#1e2f26", "#5f7f52", "#c49342"],
    ["#221a35", "#5d3c88", "#d45f7f"],
    ["#0d2b3a", "#1f7a8c", "#d7a64a"],
    ["#2c1612", "#8a3024", "#e08230"],
  ];
  return palettes[Math.abs(hashString(seed)) % palettes.length];
}

function motionLabelFromDescriptor(descriptor: MotionDescriptor): MotionLabel | null {
  if (descriptor.provenance.kind === "placeholder" || descriptor.confidence.overall < 0.2) return null;
  const type = descriptor.cameraMotionType;
  const angle = descriptor.dominantAngleDeg;
  if (type === "static" || (descriptor.dominantMagnitude ?? 0) < 0.08) return { label: "Static", inEdge: "hold", outEdge: "hold" };
  if (type === "push") return { label: "Push", inEdge: "wide", outEdge: "close" };
  if (type === "pull") return { label: "Pull", inEdge: "close", outEdge: "wide" };
  if (type === "tilt" && angle !== null) return angle > 0 ? { label: "Up", inEdge: "south", outEdge: "north" } : { label: "Down", inEdge: "north", outEdge: "south" };
  if (type === "pan" || angle !== null) {
    const normalized = angle === null ? 0 : ((angle % 360) + 360) % 360;
    if (normalized >= 315 || normalized < 45) return { label: "West→East", inEdge: "west", outEdge: "east" };
    if (normalized >= 135 && normalized < 225) return { label: "East→West", inEdge: "east", outEdge: "west" };
    if (normalized >= 45 && normalized < 135) return { label: "Up", inEdge: "south", outEdge: "north" };
    return { label: "Down", inEdge: "north", outEdge: "south" };
  }
  if (type === "mixed" || type === "roll") return { label: "Mixed", inEdge: "center", outEdge: "center" };
  return null;
}

function paletteToHex(palette: ColorPaletteSwatch[]) {
  return palette
    .filter((swatch) => swatch.weight > 0)
    .sort((left, right) => right.weight - left.weight)
    .map((swatch) => swatch.hex ?? labToHex(swatch))
    .filter((color): color is string => Boolean(color));
}

function labToHex(swatch: ColorPaletteSwatch) {
  if (!Number.isFinite(swatch.l) || !Number.isFinite(swatch.a) || !Number.isFinite(swatch.b)) return null;
  const y = (swatch.l! + 16) / 116;
  const x = swatch.a! / 500 + y;
  const z = y - swatch.b! / 200;
  const xyz = [x, y, z].map((value, index) => {
    const cubed = value ** 3;
    const normalized = cubed > 0.008856 ? cubed : (value - 16 / 116) / 7.787;
    return normalized * [95.047, 100, 108.883][index] / 100;
  });
  let [r, g, b] = [
    xyz[0] * 3.2406 + xyz[1] * -1.5372 + xyz[2] * -0.4986,
    xyz[0] * -0.9689 + xyz[1] * 1.8758 + xyz[2] * 0.0415,
    xyz[0] * 0.0557 + xyz[1] * -0.204 + xyz[2] * 1.057,
  ];
  [r, g, b] = [r, g, b].map((value) => {
    const corrected = value > 0.0031308 ? 1.055 * value ** (1 / 2.4) - 0.055 : 12.92 * value;
    return clamp(Math.round(corrected * 255), 0, 255);
  });
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return hash;
}

function clamp01(value: number) {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
