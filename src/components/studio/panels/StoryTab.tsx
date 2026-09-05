"use client";

import { startTransition, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { transcribeAudioWithDeepgram, type DeepgramTranscriptSummary } from "../deepgramUtils";
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
export const LOVE_ME_TONIGHT_STORY_SEED = "Diego and Valentina are strangers moving independently through a hidden underground maze of tunnels, dance rooms, and increasingly dangerous chambers. Each is casually looking for someone capable of matching them. They pass unexpectedly, both realize too late that the other may be the one, and begin searching through the shifting complex until they almost back into one another. They finally dance together in the central arena while floors split, rooms collapse, and dancers continue until they fall. Only near the end may the audience realize this is a last-dancer-standing simulation or game.";
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
  const { vocalStemName, transcriptSummary, storyBeats, activeBeatId, storyGenerated } = state;
  const editSettings = normalizeStoryEditSettings(state.editSettings);
  const [isTranscribingAudio, setIsTranscribingAudio] = useState(false);
  const [transcriptProgress, setTranscriptProgress] = useState(0);
  const [transcriptStatus, setTranscriptStatus] = useState(() => formatTranscriptStatus(state.transcriptSummary));
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const progressTimer = useRef<number | null>(null);
  const vocalStemInputRef = useRef<HTMLInputElement>(null);
  const seededBriefSourceRef = useRef<string | null>(null);

  function updateState(patch: Partial<StoryTabState>) {
    onStateChange((current) => ({ ...current, ...patch }));
  }

  function setActiveBeatId(activeBeatId: string) {
    updateState({ activeBeatId });
  }

  function setTranscriptSummary(transcriptSummary: DeepgramTranscriptSummary | null) {
    updateState({ transcriptSummary });
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
    if (!isTranscribingAudio && !transcriptError) {
      setTranscriptStatus(formatTranscriptStatus(transcriptSummary));
    }
  }, [isTranscribingAudio, transcriptError, transcriptSummary]);

  useEffect(() => {
    onProjectChange?.(musicVideoProject);
  }, [musicVideoProject, onProjectChange]);

  useEffect(() => {
    const sourceLabel = analysis?.sourceLabel?.trim() ?? "";
    if (!sourceLabel || seededBriefSourceRef.current === sourceLabel) return;
    seededBriefSourceRef.current = sourceLabel;
    if (!/love\W*me\W*tonight/i.test(sourceLabel) || state.brief.text.trim() || state.treatments.length) return;
    updateState({ brief: { text: LOVE_ME_TONIGHT_STORY_SEED } });
  // The source guard makes this a one-time project-specific suggestion.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis?.sourceLabel]);

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

  async function handleVocalStemUpload(files: File[]) {
    const file = files[0];
    if (!file) return;

    if (progressTimer.current) {
      window.clearInterval(progressTimer.current);
      progressTimer.current = null;
    }

    updateState({
      vocalStemName: file.name,
      transcriptSummary: null,
      storyGenerated: false,
      confirmedTreatmentId: null,
      confirmedTreatmentSnapshot: null,
      storyContentSignature: null,
    });
    setTranscriptError(null);
    setIsTranscribingAudio(true);
    setTranscriptProgress(8);
    setTranscriptStatus(`Vocal stem loaded: ${file.name}. Sending stem to Deepgram for lyrics/SRT...`);

    progressTimer.current = window.setInterval(() => {
      setTranscriptProgress((current) => {
        const next = Math.min(88, current + (current < 35 ? 7 : current < 65 ? 4 : 2));
        return next;
      });
    }, 900);

    try {
      const summary = await transcribeAudioWithDeepgram(file, { duration: totalDuration || undefined });
      setTranscriptSummary(summary);
      setTranscriptProgress(100);
      setTranscriptStatus(formatTranscriptStatus(summary));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Deepgram transcription unavailable; paste lyrics or SRT to continue.";
      setTranscriptError(message);
      setTranscriptProgress(0);
      setTranscriptStatus(message);
    } finally {
      if (progressTimer.current) {
        window.clearInterval(progressTimer.current);
        progressTimer.current = null;
      }
      setIsTranscribingAudio(false);
    }
  }

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

      <details className="rounded-[2px] border border-[#1a1a1a] bg-[#090909]">
        <summary className="cursor-pointer px-3 py-3 text-[9px] uppercase tracking-[0.16em] text-[#777] hover:text-[#b8b8b8]">Timing &amp; Song Structure · advanced</summary>
        <div className="border-t border-[#1a1a1a] p-2">
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
      </details>

      <section className="rounded-[2px] border border-[#1a1a1a] bg-[#0b0b0b] p-3">
        <div className="grid gap-3 xl:grid-cols-[1.15fr_0.85fr]">
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-[10px] uppercase tracking-[0.18em] text-[#e05c00]">Lyrics timing</div>
                <div className="mt-1 text-[11px] text-[#6d6d6d]">Deepgram turns the vocal stem into timed lyric lines for the section map.</div>
              </div>
              <input
                ref={vocalStemInputRef}
                type="file"
                accept="audio/*,.wav,.mp3,.m4a,.aac,.ogg"
                disabled={isTranscribingAudio}
                className="sr-only"
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  event.target.value = "";
                  void handleVocalStemUpload(files);
                }}
              />
              <button type="button" disabled={isTranscribingAudio} onClick={() => vocalStemInputRef.current?.click()} className="rounded-[2px] bg-[#e05c00] px-3 py-2 text-[9px] font-semibold uppercase tracking-[0.14em] text-white hover:bg-[#c95200] disabled:cursor-not-allowed disabled:bg-[#252525] disabled:text-[#666]">
                {isTranscribingAudio ? `Transcribing ${transcriptProgress}%` : vocalStemName ? "Replace vocal stem" : "Upload vocal stem"}
              </button>
            </div>

            <div className={`rounded-[2px] border px-3 py-2 text-[10px] ${transcriptError ? "border-[#5a1f1a] bg-[#120706] text-[#d66a61]" : "border-[#171717] bg-[#070707] text-[#777]"}`}>
              <div className="flex items-center justify-between gap-3">
                <span className="truncate">{transcriptError ?? transcriptStatus}</span>
                <span className="shrink-0 font-mono text-[#a5a5a5]">{vocalStemName || "No stem"}</span>
              </div>
              {isTranscribingAudio ? <div className="mt-2 h-1 overflow-hidden bg-[#151515]"><div className="h-full bg-[#e05c00] transition-[width]" style={{ width: `${transcriptProgress}%` }} /></div> : null}
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

        <details className="mt-3 rounded-[2px] border border-[#171717] bg-[#070707]">
          <summary className="cursor-pointer px-3 py-2 text-[9px] uppercase tracking-[0.14em] text-[#777]">View lyrics and {srtChunkCount} timed lines</summary>
          <div className="grid gap-2 border-t border-[#171717] p-2 lg:grid-cols-2">
            <div className="max-h-56 overflow-auto whitespace-pre-wrap rounded-[2px] bg-[#030303] p-2 text-[10px] leading-4 text-[#a7a7a7]">{transcriptSummary?.transcript || "Lyrics will appear here after vocal stem transcription."}</div>
            <div className="max-h-56 space-y-1 overflow-auto rounded-[2px] bg-[#030303] p-2 font-mono text-[9px] text-[#878787]">
              {musicVideoProject.lyricChunks.length ? musicVideoProject.lyricChunks.map((chunk) => (
                <div key={chunk.id} className="grid grid-cols-[86px_1fr] gap-2 border-b border-[#101010] pb-1 last:border-b-0">
                  <span className="text-[#e05c00]">{fmt(chunk.start)}–{fmt(chunk.end)}</span>
                  <span className="text-[#9c9c9c]">{chunk.text}</span>
                </div>
              )) : <div>No timed lyrics yet.</div>}
            </div>
          </div>
        </details>
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
              : "Generate and select one of the three treatments above. Lyrics remain useful context, but are not required for an instrumental track."}
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

function formatTranscriptStatus(summary: DeepgramTranscriptSummary | null) {
  if (!summary) return "Deepgram SRT extraction ready when DEEPGRAM_API_KEY is configured";

  return `Deepgram extracted ${summary.wordCount} words into ${summary.chunks.length} timed SRT chunks${
    summary.topics.length || summary.intents.length ? ` · ${summary.topics.length + summary.intents.length} topics/intents` : ""
  }.`;
}

function ScorePill({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between rounded-[2px] border border-[#151515] bg-[#050505] px-1.5 py-1">
      <span>{label}</span>
      <span className="text-[#a5a5a5]">{Math.round(value * 100)}</span>
    </div>
  );
}
