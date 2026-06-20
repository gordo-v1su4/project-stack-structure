"use client";

import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { transcribeAudioWithDeepgram, type DeepgramTranscriptSummary } from "../deepgramUtils";
import { fmt } from "../math";
import {
  createMusicVideoProject,
  DEFAULT_STORY_EDIT_SETTINGS,
  getDefaultStorySectionDrafts,
  normalizeStoryEditSettings,
  type MusicVideoProject,
  type StoryEditSettings,
  type StorySectionDraft,
} from "../musicVideoProject";
import { ParamSlider } from "../ParamSlider";
import { UploadControl } from "../UploadControl";
import type { BeatJoinAnalysis, SegmentPreview, UploadedVideoSource } from "../types";

export type StoryBeatDraft = StorySectionDraft & {
  id: string;
  label: string;
  prompt: string;
};

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

const SECTION_LABELS = DEFAULT_STORY_BEATS.map((beat) => beat.label);

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

  const musicVideoProject = useMemo(
    () =>
      createMusicVideoProject({
        analysis,
        duration: totalDuration || 0,
        lyricChunks: transcriptSummary?.chunks ?? [],
        storyDrafts: storyBeats,
        videoSources,
        segmentPreviews,
      }),
    [analysis, segmentPreviews, storyBeats, totalDuration, transcriptSummary?.chunks, videoSources],
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

  function addStoryBeat() {
    const nextIndex = storyBeats.length + 1;
    const next = { id: `section-${Date.now()}`, label: SECTION_LABELS[nextIndex - 1] || `Section ${nextIndex}`, prompt: "Describe the visual idea for this song section" };
    updateState({ storyBeats: [...storyBeats, next], activeBeatId: next.id, storyGenerated: false });
  }

  function updateStoryBeat(id: string, patch: Partial<StoryBeatDraft>) {
    updateState({
      storyBeats: storyBeats.map((beat) => (beat.id === id ? { ...beat, ...patch } : beat)),
      storyGenerated: false,
    });
  }

  function removeStoryBeat(id: string) {
    if (storyBeats.length <= 1) return;
    const next = storyBeats.filter((beat) => beat.id !== id);
    updateState({
      storyBeats: next,
      activeBeatId: activeBeatId === id ? next[0]?.id ?? "intro" : activeBeatId,
      storyGenerated: false,
    });
  }

  function generateStoryLayout() {
    setStoryGenerated(true);
  }

  return (
    <div className="space-y-3">
      <section className="grid gap-3 xl:grid-cols-[minmax(380px,0.9fr)_minmax(560px,1.45fr)]">
        <div className="rounded-[2px] border border-[#1a1a1a] bg-[#0b0b0b] p-3">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-[#e05c00]">Song section story plan</div>
              <div className="mt-1 text-[11px] text-[#6d6d6d]">
                These are editable song sections, not literal beat counts. Start from the common structure: intro, verse, optional pre-chorus, chorus, verse 2, optional pre-chorus 2, chorus 2, bridge, final chorus/outro.
              </div>
            </div>
            <button type="button" onClick={addStoryBeat} className="rounded-[2px] border border-[#2a2a2a] px-2 py-1 text-[9px] uppercase tracking-[0.14em] text-[#bdbdbd] hover:border-[#e05c00]">
              Add Section
            </button>
          </div>

          <div className="space-y-2">
            {storyRail.map((beat, index) => (
              <div
                key={beat.id}
                className={`rounded-[2px] border p-2 transition-colors ${activeBeatId === beat.id ? "border-[#e05c00] bg-[#140c07]" : "border-[#171717] bg-[#080808]"}`}
              >
                <button type="button" onClick={() => setActiveBeatId(beat.id)} className="mb-2 flex w-full items-center justify-between gap-2 text-left">
                  <span className="font-mono text-[9px] text-[#6a6a6a]">{String(index + 1).padStart(2, "0")}</span>
                  <span className="flex-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#c9c9c9]">{beat.label}</span>
                  <span className="font-mono text-[9px] text-[#4f4f4f]">{fmt(beat.start)}–{fmt(beat.end)}</span>
                </button>
                <div className="grid gap-2 md:grid-cols-[132px_1fr_auto]">
                  <input
                    aria-label={`${beat.label} name`}
                    value={storyBeats[index]?.label ?? beat.label}
                    onChange={(event) => updateStoryBeat(beat.id, { label: event.target.value })}
                    className="rounded-[2px] border border-[#191919] bg-[#050505] px-2 py-2 text-[10px] text-[#bdbdbd] outline-none focus:border-[#3a3a3a]"
                  />
                  <textarea
                    aria-label={`${beat.label} prompt`}
                    value={storyBeats[index]?.prompt ?? ""}
                    onChange={(event) => updateStoryBeat(beat.id, { prompt: event.target.value })}
                    className="h-14 resize-none rounded-[2px] border border-[#191919] bg-[#050505] p-2 text-[11px] leading-4 text-[#bdbdbd] outline-none placeholder:text-[#3d3d3d] focus:border-[#3a3a3a]"
                  />
                  <button type="button" onClick={() => removeStoryBeat(beat.id)} className="rounded-[2px] border border-[#202020] px-2 text-[9px] uppercase tracking-[0.12em] text-[#5f5f5f] hover:text-[#b96c43]">
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

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

        <div className="mb-3 rounded-[2px] border border-[#171717] bg-[#070707] p-3">
          <div className="mb-2 flex items-center justify-between text-[9px] uppercase tracking-[0.16em] text-[#4a4a4a]">
            <span>Shared song-time ruler</span>
            <span>{fmt(totalDuration || 0)}</span>
          </div>
          <div className="relative h-20 overflow-hidden rounded-[2px] border border-[#141414] bg-[#030303]">
            {storyRail.map((beat) => {
              const left = totalDuration ? (beat.start / totalDuration) * 100 : 0;
              const width = totalDuration ? Math.max(3, ((beat.end - beat.start) / totalDuration) * 100) : 100 / Math.max(1, storyRail.length);
              return (
                <button
                  key={beat.id}
                  type="button"
                  onClick={() => setActiveBeatId(beat.id)}
                  className={`absolute inset-y-0 border-r border-[#101010] p-2 text-left transition-colors ${activeBeatId === beat.id ? "bg-[#e05c001f]" : "bg-[#0a0a0a] hover:bg-[#101010]"}`}
                  style={{ left: `${left}%`, width: `${width}%` }}
                >
                  <div className="truncate text-[9px] font-semibold uppercase tracking-[0.12em] text-[#cfcfcf]">{beat.label}</div>
                  <div className="mt-1 truncate font-mono text-[8px] text-[#6a6a6a]">{fmt(beat.start)} → {fmt(beat.end)}</div>
                </button>
              );
            })}
          </div>
        </div>

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
