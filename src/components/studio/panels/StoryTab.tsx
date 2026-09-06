"use client";

import { startTransition, useEffect, useMemo, type Dispatch, type SetStateAction } from "react";
import type { DeepgramTranscriptSummary } from "../deepgramUtils";
import { fmt } from "../math";
import {
  buildStorySections,
  createMusicVideoProject,
  DEFAULT_STORY_EDIT_SETTINGS,
  getDefaultStorySectionDrafts,
  normalizeStoryEditSettings,
  type MusicVideoProject,
  type StoryPlanDraft,
  type StoryEditSettings,
  type StorySectionDraft,
} from "../musicVideoProject";
import { StoryStructureEditor } from "../StoryStructurePlanner";
import { StoryTreatmentPlanner } from "../StoryTreatmentPlanner";
import {
  applyTreatmentAnchorsToStoryBeats,
  applyTreatmentCoverageToProject,
  buildStoryContentSignature,
  type StoryTreatment,
  type StoryTreatmentState,
} from "../storyTreatments";
import {
  moveStorySectionBoundary,
  removeTimedStorySection,
  splitStorySectionWithTemplate,
  toTimedStoryDrafts,
} from "../storyStructure";
import { CollapsibleSection } from "../ui";
import { formatVocalStemTranscriptStatus } from "../vocalStemTranscription";
import type { BeatJoinAnalysis, SegmentPreview, UploadedVideoSource } from "../types";

export type StoryBeatDraft = StoryPlanDraft;

export type StoryTabState = StoryTreatmentState & {
  vocalStemName: string;
  transcriptSummary: DeepgramTranscriptSummary | null;
  storyBeats: StoryBeatDraft[];
  activeBeatId: string;
  storyGenerated: boolean;
  editSettings: StoryEditSettings;
};

type StoryTabProps = {
  analysis: BeatJoinAnalysis | null;
  audioStatus: string;
  videoSources: UploadedVideoSource[];
  segmentPreviews: SegmentPreview[];
  state: StoryTabState;
  onStateChange: Dispatch<SetStateAction<StoryTabState>>;
  onProjectChange?: (project: MusicVideoProject) => void;
};

const DEFAULT_STORY_BEATS: StoryBeatDraft[] = getDefaultStorySectionDrafts().map((draft, index) => ({
  id: draft.id ?? `section-${index + 1}`,
  label: draft.label,
  prompt: draft.prompt ?? "Describe the visual idea for this song section",
}));

const STORY_SECTION_TEMPLATES = getDefaultStorySectionDrafts();
const STORY_PACE_OPTIONS = [
  { label: "Relaxed", density: 0.3, detail: "Longer phrases" },
  { label: "Balanced", density: 0.55, detail: "Musical rough cut" },
  { label: "Fast", density: 0.82, detail: "Shorter rhythmic cuts" },
] as const;

export function createDefaultStoryTabState(): StoryTabState {
  return {
    vocalStemName: "",
    transcriptSummary: null,
    storyBeats: DEFAULT_STORY_BEATS,
    activeBeatId: DEFAULT_STORY_BEATS[0].id,
    storyGenerated: false,
    editSettings: DEFAULT_STORY_EDIT_SETTINGS,
    brief: { text: "" },
    treatments: [],
    selectedTreatmentId: null,
    confirmedTreatmentId: null,
    confirmedTreatmentSnapshot: null,
    generationMeta: null,
    storyContentSignature: null,
  };
}

export function StoryTab({ analysis, audioStatus, videoSources, segmentPreviews, state, onStateChange, onProjectChange }: StoryTabProps) {
  const { transcriptSummary, storyBeats, activeBeatId, storyGenerated } = state;
  const editSettings = normalizeStoryEditSettings(state.editSettings);

  function updateState(patch: Partial<StoryTabState>) {
    onStateChange((current) => ({ ...current, ...patch }));
  }

  function setActiveBeatId(activeBeatId: string) {
    updateState({ activeBeatId });
  }

  function updateEditSettings(patch: Partial<StoryEditSettings>) {
    updateState({
      editSettings: normalizeStoryEditSettings({ ...editSettings, ...patch }),
      storyGenerated: false,
      confirmedTreatmentId: null,
      confirmedTreatmentSnapshot: null,
      storyContentSignature: null,
    });
  }

  const transcriptDuration = transcriptSummary?.duration && transcriptSummary.duration > 0 ? transcriptSummary.duration : null;
  const analysisDuration = analysis?.duration && analysis.duration > 0 ? analysis.duration : null;
  const videoDuration = videoSources.reduce((sum, source) => sum + source.duration, 0);
  const totalDuration = transcriptDuration ?? analysisDuration ?? videoDuration;
  const srtChunkCount = transcriptSummary?.chunks.length ?? 0;
  const hasTimedStoryPlan = storyBeats.every(hasStoryTiming);
  const detectedStoryPlan = useMemo(
    () => analysis?.sections.length && totalDuration > 0
      ? toTimedStoryDrafts(buildStorySections({ analysis, duration: totalDuration, drafts: storyBeats }))
      : [],
    [analysis, storyBeats, totalDuration],
  );
  const plannedStoryBeats = hasTimedStoryPlan ? storyBeats : detectedStoryPlan.length ? detectedStoryPlan : storyBeats;

  const musicVideoProject = useMemo(
    () => applyTreatmentCoverageToProject(
      createMusicVideoProject({
        analysis,
        duration: totalDuration || 0,
        lyricChunks: transcriptSummary?.chunks ?? [],
        storyDrafts: plannedStoryBeats,
        videoSources,
        segmentPreviews,
      }),
      storyGenerated ? state.confirmedTreatmentSnapshot : null,
    ),
    [analysis, plannedStoryBeats, segmentPreviews, state.confirmedTreatmentSnapshot, storyGenerated, totalDuration, transcriptSummary?.chunks, videoSources],
  );

  const storyRail = musicVideoProject.storySections;

  useEffect(() => {
    onProjectChange?.(musicVideoProject);
  }, [musicVideoProject, onProjectChange]);

  useEffect(() => {
    if (hasTimedStoryPlan || !detectedStoryPlan.length) return;
    onStateChange((current) => ({
      ...current,
      storyBeats: detectedStoryPlan.map((draft) => ({ ...draft })),
      activeBeatId: detectedStoryPlan.some((draft) => draft.id === current.activeBeatId)
        ? current.activeBeatId
        : detectedStoryPlan[0]?.id ?? current.activeBeatId,
      storyGenerated: false,
      confirmedTreatmentId: null,
      confirmedTreatmentSnapshot: null,
      storyContentSignature: null,
    }));
  }, [detectedStoryPlan, hasTimedStoryPlan, onStateChange]);

  function updatePlannedStoryBeats(next: StoryPlanDraft[], nextActiveBeatId = activeBeatId) {
    updateState({
      storyBeats: next,
      activeBeatId: nextActiveBeatId,
      storyGenerated: false,
      confirmedTreatmentId: null,
      confirmedTreatmentSnapshot: null,
      storyContentSignature: null,
    });
  }

  function updateStoryBeat(id: string, patch: Partial<StorySectionDraft>) {
    updatePlannedStoryBeats(plannedStoryBeats.map((beat) => (beat.id === id ? { ...beat, ...patch } : beat)));
  }

  function removeStoryBeat(id: string) {
    const next = removeTimedStorySection(plannedStoryBeats, id);
    const nextActiveId = activeBeatId === id ? next[Math.max(0, plannedStoryBeats.findIndex((beat) => beat.id === id) - 1)]?.id ?? next[0]?.id ?? "intro" : activeBeatId;
    updatePlannedStoryBeats(next, nextActiveId);
  }

  function addStoryPart() {
    const partNumber = plannedStoryBeats.filter((beat) => /^part\b/i.test(beat.label)).length;
    const partLabel = `Part ${String.fromCharCode(65 + (partNumber % 26))}`;
    const part = {
      id: `part-manual-${Date.now()}`,
      label: partLabel,
      prompt: "Describe the visual idea for this song part",
    };
    const next = splitStorySectionWithTemplate({
      drafts: plannedStoryBeats,
      activeId: activeBeatId,
      template: part,
      cueTimes: getStoryBoundaryCues(analysis, transcriptSummary),
    });
    if (next === plannedStoryBeats) return;
    updatePlannedStoryBeats(next, part.id);
  }

  function moveStoryBoundary(boundaryIndex: number, time: number) {
    const next = moveStorySectionBoundary({ drafts: plannedStoryBeats, boundaryIndex, time });
    startTransition(() => updatePlannedStoryBeats(next));
  }

  function resetStoryPlanFromDetection() {
    if (!analysis?.sections.length) return;
    const next = toTimedStoryDrafts(buildStorySections({
      analysis,
      duration: totalDuration,
      drafts: STORY_SECTION_TEMPLATES,
    }));
    if (!next.length) return;
    updatePlannedStoryBeats(next, next[0]?.id ?? activeBeatId);
  }

  function confirmStoryPlan(treatment: StoryTreatment) {
    const storyBeatsWithAnchors = applyTreatmentAnchorsToStoryBeats(plannedStoryBeats, treatment);
    updateState({
      storyBeats: storyBeatsWithAnchors,
      storyGenerated: true,
      confirmedTreatmentId: treatment.id,
      confirmedTreatmentSnapshot: treatment,
      storyContentSignature: buildStoryContentSignature(treatment, storyBeatsWithAnchors),
    });
  }

  return (
    <div className="space-y-3">
      <StoryTreatmentPlanner
        analysis={analysis}
        transcriptSummary={transcriptSummary}
        project={musicVideoProject}
        state={state}
        onChange={updateState}
        onConfirm={confirmStoryPlan}
        onInvalidateConfirmed={() => updateState({
          storyGenerated: false,
          confirmedTreatmentId: null,
          confirmedTreatmentSnapshot: null,
          storyContentSignature: null,
        })}
      />

      <CollapsibleSection title="Timing & Song Structure · advanced" className="rounded-[2px] border-[#1a1a1a] bg-[#090909]">
        <div className="p-2">
          <StoryStructureEditor
            detectedSections={analysis?.sections ?? []}
            plannedSections={storyRail}
            duration={totalDuration || 0}
            activeSectionId={activeBeatId}
            onSelect={setActiveBeatId}
            onUpdate={updateStoryBeat}
            onMoveBoundary={moveStoryBoundary}
            onSplit={addStoryPart}
            onRemove={removeStoryBeat}
            onResetFromDetection={resetStoryPlanFromDetection}
          />
        </div>
      </CollapsibleSection>

      <section className="rounded-[2px] border border-[#1a1a1a] bg-[#0b0b0b] p-2.5">
        <div className="grid gap-3 xl:grid-cols-[1.15fr_0.85fr]">
          <div>
            <div className="mb-2">
              <div className="text-[10px] uppercase tracking-[0.18em] text-[#e05c00]">Lyrics timing</div>
              <div className="mt-1 text-[11px] text-[#6d6d6d]">Timed lyrics come from the vocal stem uploaded in Ingest. Story uses those SRT chunks for section windows and Match.</div>
            </div>

            <div className={`rounded-[2px] border px-3 py-2 text-[10px] ${transcriptSummary ? "border-[#171717] bg-[#070707] text-[#777]" : "border-[#5a3219] bg-[#120a05] text-[#c68152]"}`}>
              {transcriptSummary
                ? formatVocalStemTranscriptStatus(transcriptSummary)
                : "Upload the vocal stem in Ingest to unlock lyric-aware story planning."}
            </div>

            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 border-t border-[#151515] pt-2">
              <InlineMetric label="Audio" value={analysis ? `${analysis.beats.length} markers` : audioStatus} />
              <InlineMetric label="Lyrics" value={`${srtChunkCount} timed lines`} />
              <InlineMetric label="Sources" value={`${musicVideoProject.videoMoments.length} searchable moments`} />
            </div>
          </div>

          <div className="rounded-[2px] border border-[#171717] bg-[#070707] p-3">
            <div className="mb-2 text-[9px] uppercase tracking-[0.16em] text-[#777]">Edit pace</div>
            <div className="grid grid-cols-3 gap-1.5">
              {STORY_PACE_OPTIONS.map((option) => {
                const active = Math.abs(editSettings.cutDensity - option.density) < 0.13;
                return (
                  <button key={option.label} type="button" onClick={() => updateEditSettings({ cutDensity: option.density, preferOnsets: true })} className={`rounded-[2px] border px-2 py-2 text-left ${active ? "border-[#e05c00] bg-[#170c05]" : "border-[#242424] bg-[#090909] hover:border-[#444]"}`}>
                    <span className={`block text-[9px] uppercase tracking-[0.12em] ${active ? "text-[#e05c00]" : "text-[#aaa]"}`}>{option.label}</span>
                    <span className="mt-1 block text-[8px] text-[#555]">{option.detail}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-2 text-[9px] leading-4 text-[#555]">This controls final edit rhythm. It does not create more source footage or change scene captions.</div>
          </div>
        </div>

        <CollapsibleSection title={`View lyrics and ${srtChunkCount} timed lines`} className="mt-2 rounded-[2px] border-[#171717] bg-[#070707]">
          <div className="grid gap-2 p-2 lg:grid-cols-2">
            <div className="max-h-56 overflow-auto whitespace-pre-wrap rounded-[2px] bg-[#030303] p-2 text-[10px] leading-4 text-[#a7a7a7]">{transcriptSummary?.transcript || "Lyrics appear here after the vocal stem is transcribed in Ingest."}</div>
            <div className="max-h-56 space-y-1 overflow-auto rounded-[2px] bg-[#030303] p-2 font-mono text-[9px] text-[#878787]">
              {musicVideoProject.lyricChunks.length ? musicVideoProject.lyricChunks.map((chunk) => (
                <div key={chunk.id} className="grid grid-cols-[86px_1fr] gap-2 border-b border-[#101010] pb-1 last:border-b-0">
                  <span className="text-[#e05c00]">{fmt(chunk.start)}–{fmt(chunk.end)}</span>
                  <span className="text-[#9c9c9c]">{chunk.text}</span>
                </div>
              )) : <div>No timed lyrics yet.</div>}
            </div>
          </div>
        </CollapsibleSection>
      </section>

      <section className="rounded-[2px] border border-[#1a1a1a] bg-[#0b0b0b] p-3">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-[#e05c00]">Story-to-song translation</div>
            <div className="mt-1 text-[11px] text-[#6d6d6d]">
              Each row shows what belongs together: song section, timed lyrics, story intent, selected footage, and match confidence.
            </div>
          </div>
          <div className="font-mono text-[9px] uppercase text-[#666]">{storyGenerated ? "Anchors confirmed" : "Waiting for anchor review"}</div>
        </div>

        <div className={`mb-3 rounded-[2px] border px-3 py-2 text-[9px] leading-4 ${storyGenerated ? "border-[#245c2c] bg-[#071107] text-[#78c878]" : "border-[#5a3219] bg-[#120a05] text-[#c68152]"}`}>
          {storyGenerated
            ? "Confirmed. Split and downstream stages may use this Story map."
            : state.selectedTreatmentId
              ? "Resolve every selected anchor above, then confirm the Story plan to unlock Split."
              : "Generate and select one of the three treatments above once Ingest lyrics and scene captions are ready."}
        </div>

        {totalDuration > 0 ? <div className="overflow-x-auto rounded-[2px] border border-[#171717] bg-[#070707]">
            <table className="w-full min-w-[1080px] table-fixed border-collapse text-left">
              <thead className="bg-[#0d0d0d] text-[8px] uppercase tracking-[0.14em] text-[#5f5f5f]">
                <tr>
                  <th className="w-[13%] border-b border-[#202020] px-3 py-2 font-medium">Section</th>
                  <th className="w-[23%] border-b border-[#202020] px-3 py-2 font-medium">Lyrics in window</th>
                  <th className="w-[25%] border-b border-[#202020] px-3 py-2 font-medium">Story intent</th>
                  <th className="w-[25%] border-b border-[#202020] px-3 py-2 font-medium">Matched source</th>
                  <th className="w-[14%] border-b border-[#202020] px-3 py-2 font-medium">Match</th>
                </tr>
              </thead>
              <tbody>
            {storyRail.map((beat) => {
              const relatedChunks = musicVideoProject.lyricChunks.filter((chunk) => beat.lyricChunkIds.includes(chunk.id));
              const sourceMoment = musicVideoProject.videoMoments.find((moment) => moment.id === beat.videoMomentIds[0]);
              const timelineItem = musicVideoProject.editPlan.timelineItems.find((item) => item.sectionId === beat.id);
              const semanticMatch = timelineItem?.semanticMatch ?? beat.semanticMatch;
              return (
                <tr key={beat.id} className={`align-top ${activeBeatId === beat.id ? "bg-[#120c08]" : "odd:bg-[#080808]"}`}>
                  <td className="border-b border-[#151515] px-3 py-3">
                    <button type="button" onClick={() => setActiveBeatId(beat.id)} className="w-full text-left">
                      <span className="block truncate text-[10px] font-semibold uppercase tracking-[0.13em] text-[#d0d0d0]">{beat.label}</span>
                      <span className="mt-1 block font-mono text-[9px] text-[#707070]">{fmt(beat.start)}–{fmt(beat.end)}</span>
                      <span className="mt-2 block text-[7px] uppercase tracking-[0.12em] text-[#555]">{beat.source === "analysis" ? "Detected" : "Adjusted"}</span>
                    </button>
                  </td>
                  <td className="border-b border-[#151515] px-3 py-3 text-[9px] leading-4 text-[#8f8f8f]">
                    <div className="max-h-24 overflow-auto pr-1">
                      {relatedChunks.length ? relatedChunks.map((chunk) => <div key={chunk.id}><span className="mr-2 font-mono text-[#b86432]">{fmt(chunk.start)}</span>{chunk.text}</div>) : "No lyric chunk overlaps this section."}
                    </div>
                  </td>
                  <td className="border-b border-[#151515] px-3 py-3 text-[10px] leading-4 text-[#a7a7a7]">
                    {beat.prompt}
                  </td>
                  <td className="border-b border-[#151515] px-3 py-3">
                    {sourceMoment ? (
                      <div className="flex gap-2">
                        <div className="h-12 w-20 shrink-0 overflow-hidden rounded-[2px] border border-[#1d1d1d] bg-[#030303]">
                          {sourceMoment.thumbnailUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={sourceMoment.thumbnailUrl} alt="" className="h-full w-full object-cover opacity-80" loading="lazy" decoding="async" />
                          ) : null}
                        </div>
                        <div className="min-w-0">
                          <div className="font-mono text-[8px] uppercase tracking-[0.1em] text-[#b86432]">{sourceMoment.sourceRefLabel ?? `S${sourceMoment.sourceClipId + 1}`}</div>
                          <div className="mt-1 line-clamp-3 text-[9px] leading-4 text-[#858585]">{sourceMoment.label}</div>
                        </div>
                      </div>
                    ) : <span className="text-[9px] text-[#555]">No matched source</span>}
                  </td>
                  <td className="border-b border-[#151515] px-3 py-3">
                    {semanticMatch ? (
                      <details>
                        <summary className="cursor-pointer list-none rounded-[2px] border border-[#2b211a] bg-[#100b08] px-2 py-1.5 font-mono text-[10px] text-[#d0956f]">
                          {Math.round(semanticMatch.score * 100)}% <span className="float-right text-[8px] uppercase tracking-[0.1em] text-[#6d5547]">details</span>
                        </summary>
                        <div className="mt-2 grid grid-cols-2 gap-1 font-mono text-[8px] uppercase tracking-[0.08em] text-[#747474]">
                          <ScorePill label="caption" value={semanticMatch.semanticScore} />
                          <ScorePill label="lyrics" value={semanticMatch.lyricCaptionScore} />
                          <ScorePill label="action" value={semanticMatch.actionIntentScore} />
                          <ScorePill label="energy" value={semanticMatch.motionEnergyScore} />
                          <ScorePill label="duration" value={semanticMatch.durationFitScore} />
                          <ScorePill label="motion" value={semanticMatch.motionContinuityScore} />
                          <ScorePill label="color" value={semanticMatch.colorContinuityScore ?? 0.5} />
                        </div>
                        {semanticMatch.reasons.length ? <div className="mt-2 text-[8px] leading-3 text-[#666]">{semanticMatch.reasons.join(" · ")}</div> : null}
                        {semanticMatch.repetitionPenalty > 0 ? <div className="mt-1 text-[8px] text-[#b96c43]">repeat -{Math.round(semanticMatch.repetitionPenalty * 100)}%</div> : null}
                      </details>
                    ) : <span className="text-[9px] text-[#555]">Not scored</span>}
                  </td>
                </tr>
              );
            })}
              </tbody>
            </table>
        </div> : <div className="rounded-[2px] border border-dashed border-[#202020] bg-[#070707] px-3 py-8 text-center text-[10px] uppercase tracking-[0.14em] text-[#555]">Analyze the master song to build the timed story map.</div>}
      </section>
    </div>
  );
}

function hasStoryTiming(draft: StorySectionDraft) {
  return Number.isFinite(draft.start) && Number.isFinite(draft.end) && (draft.end ?? 0) > (draft.start ?? 0);
}

function getStoryBoundaryCues(analysis: BeatJoinAnalysis | null, transcriptSummary: DeepgramTranscriptSummary | null) {
  return Array.from(new Set([
    ...(analysis?.beats ?? []),
    ...(analysis?.onsets ?? []),
    ...(analysis?.sections.flatMap((section) => [section.start, section.end]) ?? []),
    ...(transcriptSummary?.chunks.flatMap((chunk) => [chunk.start, chunk.end]) ?? []),
  ])).sort((left, right) => left - right);
}

function InlineMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <span className="mr-2 text-[8px] uppercase tracking-[0.14em] text-[#4f4f4f]">{label}</span>
      <span className="font-mono text-[9px] text-[#a5a5a5]" title={value}>{value}</span>
    </div>
  );
}

function ScorePill({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between rounded-[2px] border border-[#151515] bg-[#050505] px-1.5 py-1">
      <span>{label}</span>
      <span className="text-[#a5a5a5]">{Math.round(value * 100)}</span>
    </div>
  );
}
