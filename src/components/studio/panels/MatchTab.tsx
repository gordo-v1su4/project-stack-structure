"use client";

import { useMemo, useState } from "react";
import { ParamSlider } from "../ParamSlider";
import { CollapsibleSection, StatusDot } from "../ui";
import type { BeatJoinAnalysis, UploadedVideoSource } from "../types";
import { buildAdaptiveCueMap } from "../adaptiveCueMap";
import { placementInputSignature, type MusicVideoProject } from "../musicVideoProject";
import { rankMomentsForSection } from "../semanticEditPlanner";
import { proposeBestEffortCoverage } from "../musicVideoProjectSelection";
import { analyzeEditPlanCoverage } from "../editPlanCoverage";
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
  onSelectCandidate: (sectionId: string, momentId: string, timelineItemId?: string) => void;
  onCoveragePolicyChange?: (policy: "faithful" | "best-effort") => void;
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
  onCoveragePolicyChange,
}: MatchTabProps) {
  const matchMode: MatchMode = "balanced";
  const [policyReview, setPolicyReview] = useState<{ signature: string; proposal: ReturnType<typeof proposeBestEffortCoverage> } | null>(null);
  const [boardView, setBoardView] = useState<"detail" | "thumbs">("detail");
  const hasLyrics = Boolean(project?.lyricChunks.length);
  const hasCaptions = Boolean(project?.videoMoments.some((moment) => moment.caption));
  const ready = storyGenerated && hasCaptions;
  const momentsById = new Map((project?.videoMoments ?? []).map((moment) => [moment.id, moment]));
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
  const coverage = analyzeEditPlanCoverage(project);
  const holeCount = coverage.summary.blockingGapCount;
  const policy = project?.placementPlan?.policy ?? "faithful";
  const reviewCurrent = project && policyReview?.signature === placementInputSignature(project, project.placementPlan?.settings);
  const sectionCounts = new Map<string, number>();
  for (const item of matchedItems) sectionCounts.set(item.sectionId, (sectionCounts.get(item.sectionId) ?? 0) + 1);

  return (
    <div className="space-y-3">
      <section className="rounded-[2px] border border-line bg-ink-2 p-3">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-accent">Match lyrics, story, music cues, and captioned clips</div>
            <div className="mt-1 max-w-4xl text-[11px] leading-5 text-fg-3">
              Review suggested footage against the confirmed story. Scene frames, captions, available motion and color analysis, and music cues help you judge the choices before assembling the edit.
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onSelectStory} className="rounded-[2px] border border-line-2 px-3 py-2 text-[9px] uppercase tracking-[0.14em] text-fg-2 hover:border-accent hover:text-accent">Story</button>
            <button type="button" onClick={onSelectSplit} className="rounded-[2px] border border-line-2 px-3 py-2 text-[9px] uppercase tracking-[0.14em] text-fg-2 hover:border-accent hover:text-accent">Split</button>
          </div>
        </div>

        <CollapsibleSection title="Readiness · sections, lyrics, captions" defaultOpen={false} className="rounded-[2px] border-line bg-ink-0">
          <div className="grid gap-2 p-2 md:grid-cols-5">
            <GateCard label="Story" ready={storyGenerated} value={storyGenerated ? `${project?.storySections.length ?? 0} sections` : "Generate Story"} />
            <GateCard label="Lyrics" ready={hasLyrics} value={hasLyrics ? `${project?.lyricChunks.length ?? 0} SRT chunks` : "Waiting for stem"} />
            <GateCard label="Video captions" ready={hasCaptions} value={hasCaptions ? `${project?.videoMoments.filter((moment) => moment.caption).length ?? 0} captioned moments` : "Waiting for captions"} />
            <GateCard label="Cut blocks" ready={cueMap.chunks.length > 0} value={cueMap.chunks.length ? `${cueMap.chunks.length} blocks · ${cueMap.onsetActiveCount} music · ${cueMap.lyricActiveCount} lyric` : "Waiting for song"} />
            <GateCard label="Findings" ready={ready && weakCount === 0 && holeCount === 0} value={ready ? `${weakCount} weak · ${holeCount} holes` : "Locked"} />
          </div>
        </CollapsibleSection>
      </section>

      <section className="rounded-[2px] border border-line bg-ink-2 p-3">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-accent">Suggested cut timing · 4–6 second pace</div>
            <div className="mt-1 text-[11px] text-fg-3">Orange marks musical accents; cyan marks lyric phrases. These controls adjust this suggestion graph, not your saved rough cut. Lower density suggests fewer cuts. Lyric influence adds phrase boundaries; combine nearby cues keeps close music and lyric cues together. Short section edges remain visible as timing markers.</div>
          </div>
          <div className="grid min-w-[320px] flex-1 gap-2 md:min-w-[640px] md:grid-cols-3 md:gap-3">
            <ParamSlider label="Cue density" commitOnRelease value={onsetDensity} min={5} max={100} step={5} unit="%" layout="stack" onChange={onOnsetDensity} />
            <ParamSlider label="Lyric influence" commitOnRelease value={lyricCueBlend} min={0} max={100} step={5} unit="%" accent="#32c7d7" layout="stack" onChange={onLyricCueBlend} />
            <ParamSlider label="Combine nearby cues" commitOnRelease value={lyricMergeWindow} min={0} max={5} step={0.5} unit="s" accent="#75d767" layout="stack" onChange={onLyricMergeWindow} />
          </div>
        </div>
        <MatchMusicCueTimeline cueMap={cueMap} project={project} />
      </section>

      <section className="rounded-[2px] border border-line bg-ink-2 p-3">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-accent">Balanced multi-signal match</div>
            <div className="mt-1 text-[11px] text-fg-3">Musical timing and compatible movement lead; broad story fit guides selection, with color secondary. Model scores are advisory. Selected footage still needs review, and an empty slot may have suitable alternatives.</div>
          </div>
          <div className="font-mono text-[10px] uppercase text-fg-3">Suggestions for review</div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          {["Lyrics + captions", "Story intent", "Scene motion", "Music energy", "Duration fit", "Color continuity", "Repeat control"].map((signal) => (
            <div key={signal} className="rounded-[2px] border border-line bg-ink-1 px-3 py-2 text-center text-[9px] uppercase tracking-[0.12em] text-fg-2">
              {signal}
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-md border border-line bg-ink-2 p-4" aria-label="Coverage policy">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm text-fg-0">{policy === "faithful" ? "Faithful draft" : "Best-effort edit"}</h3>
            <p className="mt-1 text-xs text-fg-2">{coverage.summary.semanticGapDuration.toFixed(1)}s have no selected footage · {coverage.summary.durationGapDuration.toFixed(1)}s lack placed footage</p>
          </div>
          {onCoveragePolicyChange && project ? policy === "best-effort" ? (
            <button type="button" className="rounded-md border border-line px-3 py-2 text-xs text-fg-1" onClick={() => { onCoveragePolicyChange("faithful"); setPolicyReview(null); }}>Restore faithful draft</button>
          ) : (
            <button type="button" className="rounded-md border border-line px-3 py-2 text-xs text-fg-1" onClick={() => setPolicyReview({ signature: placementInputSignature(project, project.placementPlan?.settings), proposal: proposeBestEffortCoverage(project, videoSources) })}>Review best-effort option</button>
          ) : null}
        </div>
        {policyReview ? <div className="mt-3 rounded-md border border-line bg-ink-1 p-3" aria-label="Best-effort proposal">
          <p className="text-sm text-fg-1">Repeat {policyReview.proposal.repeatedSeconds.toFixed(1)}s across {policyReview.proposal.repeatedCuts} cuts. {policyReview.proposal.remainingGapSeconds.toFixed(1)}s remain uncovered.</p>
          <p className="mt-2 text-xs text-fg-2">Selected footage can repeat. Story-fit scores remain advisory. Song timing and your original draft are retained.</p>
          {!reviewCurrent ? <p className="mt-2 text-xs text-danger">The story or media changed. Cancel and review an updated proposal.</p> : null}
          <div className="mt-3 flex gap-2">
            <button type="button" className="rounded-md bg-accent px-3 py-2 text-xs text-white disabled:opacity-40" disabled={!reviewCurrent} onClick={() => { if (reviewCurrent) onCoveragePolicyChange?.("best-effort"); setPolicyReview(null); }}>Apply reviewed reuse</button>
            <button type="button" className="rounded-md border border-line px-3 py-2 text-xs text-fg-1" onClick={() => setPolicyReview(null)}>Cancel</button>
          </div>
        </div> : null}
      </section>

      {[...sectionCounts.values()].every((count) => count === 1) ? <CollapsibleSection title="Source lane overview" defaultOpen={false}><TrackLaneStackBoard stack={laneStack} onSelectCandidate={onSelectCandidate} /></CollapsibleSection> : null}

      {!ready ? (
        <section className="rounded-[2px] border border-dashed border-line bg-ink-1 p-6 text-center">
          <div className="text-[10px] uppercase tracking-[0.18em] text-danger">Match is locked</div>
          <div className="mt-3 text-[11px] leading-5 text-fg-3">
            Choose a story and review video evidence first. Missing footage remains visible as story gaps. Lyrics can help timing when a vocal stem is available.
          </div>
        </section>
      ) : null}

      <section className="rounded-[2px] border border-line bg-ink-2 p-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-accent">Story requirement matches</div>
            <div className="mt-1 text-[11px] text-fg-3">Cards show provisional selections, available first/middle/last frames, scene flow estimates, and ranking advice. Review actual cuts to judge continuity.</div>
          </div>
          <div className="flex items-center gap-2">
            <div className="rounded-[2px] border border-line bg-ink-0 p-1">
              {(["thumbs", "detail"] as const).map((view) => (
                <button
                  key={view}
                  type="button"
                  onClick={() => setBoardView(view)}
                  className={`px-2 py-1 text-[8px] uppercase tracking-[0.12em] ${boardView === view ? "bg-accent text-white" : "text-fg-3 hover:text-fg-0"}`}
                >
                  {view === "thumbs" ? "Thumb board" : "Detail"}
                </button>
              ))}
            </div>
            <div className="font-mono text-[10px] text-fg-3">{matchedItems.length} slots · balanced score</div>
          </div>
        </div>

        {matchedItems.length ? (
          <div className={boardView === "thumbs" ? "grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5" : "grid gap-2 xl:grid-cols-2"}>
            {matchedItems.map((item) => {
              const moment = item.videoMomentId ? momentsById.get(item.videoMomentId) : undefined;
              const candidateMatches = rankMomentsForSection({ section: { ...item, requirements: item.requirements },
                moments: (project?.videoMoments ?? []).map((source) => ({ ...source, subjects: source.captionMeta?.subjects,
                  action: source.captionMeta?.action, setting: source.captionMeta?.setting, shotType: source.captionMeta?.shotType })), includeIneligible: true });
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
                    onSelectCandidate={(momentId) => onSelectCandidate(item.sectionId, momentId, item.id)}
                  />
                );
            })}
          </div>
        ) : (
          <div className="rounded-[2px] border border-dashed border-line bg-ink-0 px-3 py-8 text-center text-[10px] uppercase tracking-[0.14em] text-fg-3">Generate Story to create match slots.</div>
        )}
      </section>
    </div>
  );
}

function GateCard({ label, value, ready }: { label: string; value: string; ready: boolean }) {
  return (
    <div className={`rounded-[2px] border px-3 py-2 ${ready ? "border-line-2 bg-ink-2" : "border-line bg-ink-1"}`}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[8px] uppercase tracking-[0.16em] text-fg-3">{label}</span>
        <StatusDot tone={ready ? "ready" : "waiting"} />
      </div>
      <div className={`font-mono text-[10px] ${ready ? "text-fg-1" : "text-fg-3"}`}>{value}</div>
    </div>
  );
}
