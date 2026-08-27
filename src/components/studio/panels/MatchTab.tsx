"use client";

import { useMemo, useState } from "react";
import { ParamSlider } from "../ParamSlider";
import type { BeatJoinAnalysis, UploadedVideoSource } from "../types";
import { buildAdaptiveCueMap } from "../adaptiveCueMap";
import type { MusicVideoProject } from "../musicVideoProject";
import { buildTrackLaneStack } from "../trackLaneStack";
import { TrackLaneStackBoard } from "./TrackLaneStackBoard";
import { MatchCard, ThumbMatchCard } from "./MatchCards";
import { MatchMusicCueTimeline } from "./MatchMusicCueTimeline";
import type { MatchMode } from "./matchModes";

export type { MatchMode } from "./matchModes";

type MatchTabProps = {
  project: MusicVideoProject | null;
  analysis: BeatJoinAnalysis | null;
  storyGenerated: boolean;
  onsetDensity: number;
  lyricCueBlend: number;
  lyricMergeWindow: number;
  videoSources: UploadedVideoSource[];
  onOnsetDensity: (value: number) => void;
  onLyricCueBlend: (value: number) => void;
  onLyricMergeWindow: (value: number) => void;
  onSelectStory: () => void;
  onSelectSplit: () => void;
  onSelectCandidate: (sectionId: string, momentId: string) => void;
};

export function MatchTab({
  project,
  analysis,
  storyGenerated,
  onsetDensity,
  lyricCueBlend,
  lyricMergeWindow,
  videoSources,
  onOnsetDensity,
  onLyricCueBlend,
  onLyricMergeWindow,
  onSelectStory,
  onSelectSplit,
  onSelectCandidate,
}: MatchTabProps) {
  const matchMode: MatchMode = "balanced";
  const [boardView, setBoardView] = useState<"detail" | "thumbs">("detail");
  const hasLyrics = Boolean(project?.lyricChunks.length);
  const hasCaptions = Boolean(project?.videoMoments.some((moment) => moment.caption));
  const ready = storyGenerated && hasLyrics && hasCaptions;
  const momentsById = new Map((project?.videoMoments ?? []).map((moment) => [moment.id, moment]));
  const sectionsById = new Map((project?.storySections ?? []).map((section) => [section.id, section]));
  const sourceNameByClipId = useMemo(() => new Map(videoSources.map((source) => [source.id, source.name])), [videoSources]);
  const laneStack = useMemo(() => buildTrackLaneStack({ project, sourceNameByClipId }), [project, sourceNameByClipId]);
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
        <MatchMusicCueTimeline cueMap={cueMap} project={project} />
      </section>

      <section className="rounded-[2px] border border-[#1a1a1a] bg-[#0b0b0b] p-3">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-[#e05c00]">Balanced multi-signal match</div>
            <div className="mt-1 text-[11px] text-[#6d6d6d]">There is no strategy mode to choose. Every candidate is ranked using the complete edit context, then Join validates the resolved sequence edge-to-edge.</div>
          </div>
          <div className="font-mono text-[10px] uppercase text-[#777]">One combined score · automatic</div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          {["Lyrics + captions", "Story intent", "Motion edges", "Music energy", "Duration fit", "Color continuity", "Repeat control"].map((signal) => (
            <div key={signal} className="rounded-[2px] border border-[#203022] bg-[#071007] px-3 py-2 text-center text-[9px] uppercase tracking-[0.12em] text-[#79a879]">
              {signal}
            </div>
          ))}
        </div>
      </section>

      <TrackLaneStackBoard stack={laneStack} onSelectCandidate={onSelectCandidate} />

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
            <div className="font-mono text-[10px] text-[#777]">{matchedItems.length} slots · balanced score</div>
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
                    onSelectCandidate={(momentId) => onSelectCandidate(item.sectionId, momentId)}
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
