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
import { StoryPlanEditor, StoryStructureRuler } from "../StoryStructurePlanner";
import {
  insertStoryTemplateInSongOrder,
  moveStorySectionBoundary,
  removeTimedStorySection,
  splitStorySectionWithTemplate,
  toTimedStoryDrafts,
} from "../storyStructure";
import { ParamSlider } from "../ParamSlider";
import { UploadControl } from "../UploadControl";
import type { BeatJoinAnalysis, SegmentPreview, UploadedVideoSource } from "../types";

export type StoryBeatDraft = StoryPlanDraft;

export type StoryTabState = {
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

export function createDefaultStoryTabState(): StoryTabState {
  return {
    vocalStemName: "",
    transcriptSummary: null,
    storyBeats: DEFAULT_STORY_BEATS,
    activeBeatId: DEFAULT_STORY_BEATS[0].id,
    storyGenerated: false,
    editSettings: DEFAULT_STORY_EDIT_SETTINGS,
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

  function updateState(patch: Partial<StoryTabState>) {
    onStateChange((current) => ({ ...current, ...patch }));
  }

  function setActiveBeatId(activeBeatId: string) {
    updateState({ activeBeatId });
  }

  function setStoryGenerated(storyGenerated: boolean) {
    updateState({ storyGenerated });
  }

  function setTranscriptSummary(transcriptSummary: DeepgramTranscriptSummary | null) {
    updateState({ transcriptSummary });
  }

  function updateEditSettings(patch: Partial<StoryEditSettings>) {
    updateState({ editSettings: normalizeStoryEditSettings({ ...editSettings, ...patch }) });
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
    () =>
      createMusicVideoProject({
        analysis,
        duration: totalDuration || 0,
        lyricChunks: transcriptSummary?.chunks ?? [],
        storyDrafts: plannedStoryBeats,
        videoSources,
        segmentPreviews,
      }),
    [analysis, plannedStoryBeats, segmentPreviews, totalDuration, transcriptSummary?.chunks, videoSources],
  );

  const storyRail = musicVideoProject.storySections;
  const activeBeat = storyRail.find((beat) => beat.id === activeBeatId) ?? storyRail[0];

  useEffect(() => {
    if (!isTranscribingAudio && !transcriptError) {
      setTranscriptStatus(formatTranscriptStatus(transcriptSummary));
    }
  }, [isTranscribingAudio, transcriptError, transcriptSummary]);

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
    }));
  }, [detectedStoryPlan, hasTimedStoryPlan, onStateChange]);

  async function handleVocalStemUpload(files: File[]) {
    const file = files[0];
    if (!file) return;

    if (progressTimer.current) {
      window.clearInterval(progressTimer.current);
      progressTimer.current = null;
    }

    updateState({ vocalStemName: file.name, transcriptSummary: null, storyGenerated: false });
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
    updateState({ storyBeats: next, activeBeatId: nextActiveBeatId, storyGenerated: false });
  }

  function updateStoryBeat(id: string, patch: Partial<StorySectionDraft>) {
    updatePlannedStoryBeats(plannedStoryBeats.map((beat) => (beat.id === id ? { ...beat, ...patch } : beat)));
  }

  function removeStoryBeat(id: string) {
    const next = removeTimedStorySection(plannedStoryBeats, id);
    const nextActiveId = activeBeatId === id ? next[Math.max(0, plannedStoryBeats.findIndex((beat) => beat.id === id) - 1)]?.id ?? next[0]?.id ?? "intro" : activeBeatId;
    updatePlannedStoryBeats(next, nextActiveId);
  }

  function insertStoryTemplate(template: StoryPlanDraft) {
    const next = insertStoryTemplateInSongOrder({
      drafts: plannedStoryBeats,
      template,
      cueTimes: getStoryBoundaryCues(analysis, transcriptSummary),
    });
    if (next === plannedStoryBeats) return;
    updatePlannedStoryBeats(next, template.id ?? activeBeatId);
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

  function generateStoryLayout() {
    setStoryGenerated(true);
  }

  return (
    <div className="space-y-3">
      <section className="grid gap-3 xl:grid-cols-[minmax(380px,0.9fr)_minmax(560px,1.45fr)]">
        <StoryPlanEditor
          plannedSections={storyRail}
          templates={STORY_SECTION_TEMPLATES}
          activeSectionId={activeBeatId}
          onSelect={setActiveBeatId}
          onUpdate={updateStoryBeat}
          onInsertTemplate={insertStoryTemplate}
          onAddPart={addStoryPart}
          onRemove={removeStoryBeat}
          onMoveBoundary={moveStoryBoundary}
          onResetFromDetection={resetStoryPlanFromDetection}
        />

        <div className="rounded-[2px] border border-[#1a1a1a] bg-[#0b0b0b] p-3">
          <div className="mb-3">
            <div className="text-[10px] uppercase tracking-[0.18em] text-[#e05c00]">Lyrics / Deepgram lane</div>
            <div className="mt-1 text-[11px] text-[#6d6d6d]">
              Upload the vocal stem; Deepgram returns the lyrics plus timed SRT chunks. This is the main AI input for Generate Story.
            </div>
          </div>

          <UploadControl
            accept="audio/*,.wav,.mp3,.m4a,.aac,.ogg"
            multiple={false}
            title="Upload isolated vocal stem"
            detail="Progress stays visible while Deepgram transcribes, then all lyrics/SRT chunks appear below."
            actionLabel={vocalStemName ? "Replace Stem" : "Upload Vocal Stem"}
            disabled={isTranscribingAudio}
            isProcessing={isTranscribingAudio}
            processingProgress={transcriptProgress}
            status={transcriptStatus}
            error={transcriptError}
            onFiles={handleVocalStemUpload}
          />

          <div className="mt-3 grid gap-2 md:grid-cols-4">
            <Metric label="Audio markers" value={analysis ? `${analysis.beats.length} beat markers` : audioStatus} />
            <Metric label="Vocal Stem" value={vocalStemName || "Not uploaded"} />
            <Metric label="Timed SRT" value={`${srtChunkCount} chunks`} />
            <Metric label="Source Moments" value={`${musicVideoProject.videoMoments.length} clips/segments`} />
          </div>

          <div className="mt-3 rounded-[2px] border border-[#171717] bg-[#070707] p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <div className="text-[8px] uppercase tracking-[0.16em] text-[#e05c00]">Live edit density</div>
                <div className="mt-1 text-[10px] text-[#666]">
                  Drives Story preview/export cut windows from sparse section cuts to fast onset cuts.
                </div>
              </div>
              <div className="font-mono text-[10px] text-[#bdbdbd]">{Math.round(editSettings.cutDensity * 100)}%</div>
            </div>
            <ParamSlider
              label="Density"
              value={Math.round(editSettings.cutDensity * 100)}
              min={15}
              max={100}
              step={5}
              unit="%"
              onChange={(value) => updateEditSettings({ cutDensity: value / 100 })}
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[9px] uppercase tracking-[0.12em] text-[#5f5f5f]">
              <span>Sparser phrases</span>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={editSettings.preferOnsets}
                  onChange={(event) => updateEditSettings({ preferOnsets: event.target.checked })}
                  className="accent-[#e05c00]"
                />
                Prefer onsets
              </label>
              <span>Fast music cuts</span>
            </div>
          </div>

          <div className="mt-3 grid gap-2 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="rounded-[2px] border border-[#171717] bg-[#070707] p-2">
              <div className="mb-2 text-[8px] uppercase tracking-[0.16em] text-[#494949]">Full lyrics from Deepgram</div>
              <div className="max-h-56 overflow-auto whitespace-pre-wrap rounded-[2px] bg-[#030303] p-2 text-[10px] leading-4 text-[#a7a7a7]">
                {transcriptSummary?.transcript || "Lyrics will appear here after vocal stem transcription."}
              </div>
            </div>
            <div className="rounded-[2px] border border-[#171717] bg-[#070707] p-2">
              <div className="mb-2 flex items-center justify-between text-[8px] uppercase tracking-[0.16em] text-[#494949]">
                <span>All SRT chunks</span>
                <span>{srtChunkCount}</span>
              </div>
              <div className="max-h-56 space-y-1 overflow-auto rounded-[2px] bg-[#030303] p-2 font-mono text-[9px] text-[#878787]">
                {musicVideoProject.lyricChunks.length ? (
                  musicVideoProject.lyricChunks.map((chunk) => (
                    <div key={chunk.id} className="grid grid-cols-[86px_1fr] gap-2 border-b border-[#101010] pb-1 last:border-b-0">
                      <span className="text-[#e05c00]">{fmt(chunk.start)}–{fmt(chunk.end)}</span>
                      <span className="text-[#9c9c9c]">{chunk.text}</span>
                    </div>
                  ))
                ) : (
                  <div>No SRT chunks yet.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-[2px] border border-[#1a1a1a] bg-[#0b0b0b] p-3">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-[#e05c00]">Generate Story output</div>
            <div className="mt-1 text-[11px] text-[#6d6d6d]">
              Click Generate Story after lyrics/SRT are ready. This turns the page into a section-card layout: prompt, lyrics window, source/scene references, and image/video placeholders.
            </div>
          </div>
          <button
            type="button"
            onClick={generateStoryLayout}
            disabled={!transcriptSummary || isTranscribingAudio}
            className={`rounded-[2px] px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] ${
              transcriptSummary && !isTranscribingAudio ? "bg-[#e05c00] text-white hover:bg-[#c95200]" : "bg-[#252525] text-[#646464] cursor-not-allowed"
            }`}
          >
            Generate Story
          </button>
        </div>

        <StoryStructureRuler
          detectedSections={analysis?.sections ?? []}
          plannedSections={storyRail}
          duration={totalDuration || 0}
          activeSectionId={activeBeatId}
          onSelect={setActiveBeatId}
        />

        {storyGenerated ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {storyRail.map((beat, index) => {
              const relatedChunks = musicVideoProject.lyricChunks.filter((chunk) => beat.lyricChunkIds.includes(chunk.id));
              const sourceMoment = musicVideoProject.videoMoments.find((moment) => moment.id === beat.videoMomentIds[0]) ?? musicVideoProject.videoMoments[index % Math.max(1, musicVideoProject.videoMoments.length)];
              const timelineItem = musicVideoProject.editPlan.timelineItems.find((item) => item.sectionId === beat.id);
              const semanticMatch = timelineItem?.semanticMatch ?? beat.semanticMatch;
              return (
                <div key={beat.id} className="overflow-hidden rounded-[2px] border border-[#171717] bg-[#070707]">
                  <div className="aspect-video bg-[linear-gradient(135deg,#161616,#050505)]">
                    {sourceMoment?.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={sourceMoment.thumbnailUrl} alt="" className="h-full w-full object-cover opacity-75" loading="lazy" decoding="async" />
                    ) : null}
                  </div>
                  <div className="space-y-2 border-t border-[#141414] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-[#d0d0d0]">{beat.label}</div>
                      <div className="font-mono text-[9px] text-[#707070]">{fmt(beat.start)}–{fmt(beat.end)}</div>
                    </div>
                    <div className="rounded-[2px] border border-[#191919] bg-[#030303] p-2 text-[10px] leading-4 text-[#a7a7a7]">
                      <span className="text-[#e05c00]">Prompt:</span> {beat.prompt}
                    </div>
                    <div className="max-h-28 overflow-auto rounded-[2px] border border-[#191919] bg-[#030303] p-2 text-[9px] leading-4 text-[#8f8f8f]">
                      {relatedChunks.length ? relatedChunks.map((chunk) => <div key={chunk.id}>{fmt(chunk.start)} {chunk.text}</div>) : "No lyric chunk overlaps this section yet."}
                    </div>
                    <div className="rounded-[2px] border border-[#191919] bg-[#030303] p-2 text-[8px] uppercase tracking-[0.12em] text-[#666]">
                      Source: {sourceMoment ? `${sourceMoment.sourceRefLabel ?? `S${sourceMoment.sourceClipId + 1}`} · ${sourceMoment.label}` : "No source clip yet"}
                    </div>
                    {semanticMatch ? (
                      <div className="rounded-[2px] border border-[#191919] bg-[#030303] p-2">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <span className="text-[8px] uppercase tracking-[0.14em] text-[#e05c00]">Semantic edit choice</span>
                          <span className="font-mono text-[9px] text-[#bdbdbd]">{Math.round(semanticMatch.score * 100)}%</span>
                        </div>
                        <div className="grid grid-cols-2 gap-1 font-mono text-[8px] uppercase tracking-[0.08em] text-[#747474]">
                          <ScorePill label="caption" value={semanticMatch.semanticScore} />
                          <ScorePill label="lyrics" value={semanticMatch.lyricCaptionScore} />
                          <ScorePill label="action" value={semanticMatch.actionIntentScore} />
                          <ScorePill label="energy" value={semanticMatch.motionEnergyScore} />
                          <ScorePill label="duration" value={semanticMatch.durationFitScore} />
                          <ScorePill label="motion" value={semanticMatch.motionContinuityScore} />
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {semanticMatch.reasons.map((reason) => (
                            <span key={reason} className="rounded-[2px] border border-[#202020] px-1.5 py-1 text-[8px] uppercase tracking-[0.1em] text-[#8f8f8f]">
                              {reason}
                            </span>
                          ))}
                          {semanticMatch.repetitionPenalty > 0 ? (
                            <span className="rounded-[2px] border border-[#2a160f] px-1.5 py-1 text-[8px] uppercase tracking-[0.1em] text-[#b96c43]">
                              repeat -{Math.round(semanticMatch.repetitionPenalty * 100)}%
                            </span>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                    <div className="grid grid-cols-3 gap-1 text-center text-[8px] uppercase tracking-[0.12em] text-[#666]">
                      <div className="rounded-[2px] border border-[#202020] py-1">Image prompt</div>
                      <div className="rounded-[2px] border border-[#202020] py-1">Video prompt</div>
                      <div className="rounded-[2px] border border-[#202020] py-1">Stitch slot</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-[2px] border border-dashed border-[#222] bg-[#060606] p-6 text-center text-[11px] text-[#6d6d6d]">
            Story cards will appear here after Generate Story. This replaces the vague placeholder card/gap-fill area with the actual music-video section layout.
            {activeBeat ? <div className="mt-2 font-mono text-[9px] text-[#4f4f4f]">Selected: {activeBeat.label} · {fmt(activeBeat.start)}–{fmt(activeBeat.end)}</div> : null}
          </div>
        )}
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[2px] border border-[#171717] bg-[#070707] px-2 py-2">
      <div className="text-[8px] uppercase tracking-[0.16em] text-[#494949]">{label}</div>
      <div className="mt-1 truncate font-mono text-[10px] text-[#a5a5a5]" title={value}>{value}</div>
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
