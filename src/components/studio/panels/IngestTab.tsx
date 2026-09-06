"use client";

import { useMemo, useState, type ReactNode } from "react";
import { fmt } from "../math";
import { deriveIngestLanes, hasRequiredIngestReferences, isCaptionContextReady, type IngestLane, type IngestLaneKey } from "../ingestLanes";
import { needsSceneDetectionRetry } from "../mediaUpload";
import { isSourceCaptionFailed } from "../sceneCaptioning";
import { sceneCaptionMatchesMode } from "../sceneCaptioning";
import { SourceVideoLibrary } from "../SourceVideoLibrary";
import { IngestVocalStemLane } from "../IngestVocalStemLane";
import { UploadControl } from "../UploadControl";
import { Button, Kicker, StatusDot, TONE_TEXT, type StatusTone } from "../ui";
import type { DeepgramTranscriptSummary } from "../deepgramUtils";
import { REFERENCE_ASSET_SLOT_DETAILS, REFERENCE_ASSET_SLOT_LABELS, type ReferenceAsset, type ReferenceAssetKind, type ReferenceAssetLibraryRole, type ReferenceAssetRole } from "../referenceAssets";
import type { BeatJoinAnalysis, DetectedSceneSegment, SceneCaptionMode, UploadedVideoSource } from "../types";
import { FAST_CAPTIONS_ENABLED } from "../constants";

type IngestTabProps = {
  analysis: BeatJoinAnalysis | null;
  audioStatus: string;
  audioError: string | null;
  audioProgress: number;
  isPreparingAudio: boolean;
  onAudioUpload: (files: File[]) => void | Promise<void>;
  vocalStemName: string;
  transcriptSummary: DeepgramTranscriptSummary | null;
  videoSources: UploadedVideoSource[];
  videoStatus: string;
  videoError: string | null;
  isPreparingVideos: boolean;
  isRerunningSceneAnalysis: boolean;
  captionMode: SceneCaptionMode;
  onCaptionModeChange: (mode: SceneCaptionMode) => void;
  onVideoUpload: (files: File[]) => void | Promise<void>;
  onAppendVideos: (files: File[]) => void | Promise<void>;
  onRemoveVideo: (sourceId: number) => void;
  onRerunSceneAnalysis: (scope: "failed" | "all") => void;
  onMergeScene: (sourceId: number, sceneId: number) => void;
  referenceAssets: ReferenceAsset[];
  onReferenceAssetUpload: (role: ReferenceAssetLibraryRole, files: File[]) => void | Promise<void>;
  onReferenceAssetUpdate: (assetId: string, patch: Partial<Pick<ReferenceAsset, "displayName" | "promptHint" | "kind">>) => void;
  onReferenceAssetRemove: (assetId: string) => void;
  onVocalStemTranscriptStart: (fileName: string) => void;
  onVocalStemTranscriptComplete: (summary: DeepgramTranscriptSummary, fileName: string) => void;
  onVocalStemTranscriptFailed: (message: string) => void;
};

type ReadinessTone = StatusTone;

type IngestStepKey = "song" | "stem" | "references" | "footage" | "captions";

const STEP_ORDER: IngestStepKey[] = ["song", "references", "footage", "stem", "captions"];

const STEP_TITLES: Record<IngestStepKey, string> = {
  song: "Master song",
  stem: "Vocal stem",
  references: "References",
  footage: "Footage",
  captions: "Scenes & captions",
};

/**
 * Ingest is a checklist. Every step shows one status line derived from the
 * same lane model the pipeline uses, and the work for that step lives right
 * under its heading — no separate readiness grid.
 */
export function IngestTab({
  analysis,
  audioStatus,
  audioError,
  audioProgress,
  isPreparingAudio,
  onAudioUpload,
  vocalStemName,
  transcriptSummary,
  videoSources,
  videoStatus,
  videoError,
  isPreparingVideos,
  isRerunningSceneAnalysis,
  captionMode,
  onCaptionModeChange,
  onVideoUpload,
  onAppendVideos,
  onRemoveVideo,
  onRerunSceneAnalysis,
  onMergeScene,
  referenceAssets,
  onReferenceAssetUpload,
  onReferenceAssetUpdate,
  onReferenceAssetRemove,
  onVocalStemTranscriptStart,
  onVocalStemTranscriptComplete,
  onVocalStemTranscriptFailed,
}: IngestTabProps) {
  const [captionSearch, setCaptionSearch] = useState("");
  const stats = buildVideoStats(videoSources, captionMode);
  const lanes = useMemo(() => deriveIngestLanes({
    hasAudioAnalysis: analysis !== null,
    hasLyricTranscript: Boolean(transcriptSummary?.chunks.length),
    referenceAssets,
    videoCount: videoSources.length,
    sceneCount: stats.sceneCount,
    captionReadyCount: stats.captionReady,
    captionTotalCount: stats.captionTotal,
    captionJobsRunning: stats.captioning > 0,
  }), [analysis, referenceAssets, stats.captionReady, stats.captionTotal, stats.captioning, stats.sceneCount, transcriptSummary, videoSources.length]);
  const laneByKey = useMemo(() => new Map(lanes.map((lane) => [lane.key, lane])), [lanes]);
  const captionContextReady = isCaptionContextReady({ hasLyricTranscript: Boolean(transcriptSummary?.chunks.length), referenceAssets });
  const referencesReady = hasRequiredIngestReferences(referenceAssets);

  const steps = useMemo<Record<IngestStepKey, { tone: ReadinessTone; status: string }>>(() => {
    const song = laneByKey.get("song");
    const stem = laneByKey.get("stem");
    const clips = laneByKey.get("clips");
    const scenes = laneByKey.get("scenes");
    const captions = laneByKey.get("captions");
    const footageTone: ReadinessTone = videoError || stats.storageFailed > 0 || stats.sceneFailed > 0
      ? "failed"
      : isPreparingVideos || stats.detecting > 0
        ? "processing"
        : clips?.ready
          ? "ready"
          : "waiting";
    const captionTone: ReadinessTone = stats.captionFailed > 0
      ? "failed"
      : captions?.ready
        ? "ready"
        : stats.captioning > 0 || stats.detecting > 0
          ? "processing"
          : "waiting";
    return {
      song: {
        tone: audioError ? "failed" : isPreparingAudio ? "processing" : song?.ready ? "ready" : "waiting",
        status: audioError ?? (isPreparingAudio ? `Analyzing · ${Math.floor(audioProgress)}%` : analysis ? `${analysis.sourceLabel} · ${fmt(analysis.duration)}` : "Upload the master song"),
      },
      stem: {
        tone: transcriptSummary ? "ready" : vocalStemName ? "processing" : "waiting",
        status: transcriptSummary ? `${transcriptSummary.chunks.length} timed lyric lines` : vocalStemName ? `Transcribing ${vocalStemName}…` : stem?.detail ?? "Upload the isolated vocal",
      },
      references: {
        tone: referenceAssets.some((asset) => asset.storageStatus === "failed") ? "failed" : referencesReady ? "ready" : referenceAssets.some((asset) => asset.storageStatus === "uploading") ? "processing" : "waiting",
        status: referencesReady
          ? `${referenceAssets.filter((asset) => asset.storageStatus === "uploaded").length} sheets ready`
          : "Character 1 + Environment required",
      },
      footage: {
        tone: footageTone,
        status: videoError
          ?? (videoSources.length === 0
            ? "Upload source clips"
            : `${videoSources.length} clip${videoSources.length === 1 ? "" : "s"} · ${scenes?.ready ? `${stats.sceneCount} scenes` : stats.detecting > 0 ? `detecting ${stats.detecting}…` : "scenes pending"} · ${stats.storageUploaded}/${videoSources.length} stored`),
      },
      captions: {
        tone: captionTone,
        status: stats.captionFailed > 0
          ? `${stats.captionFailed} clip${stats.captionFailed === 1 ? "" : "s"} failed captioning`
          : captions?.detail ?? "Waiting",
      },
    };
  }, [analysis, audioError, audioProgress, isPreparingAudio, isPreparingVideos, laneByKey, referenceAssets, referencesReady, stats, transcriptSummary, videoError, videoSources.length, vocalStemName]);

  const rerunFailedCount = useMemo(
    () => videoSources.filter(needsSceneDetectionRetry).length,
    [videoSources],
  );
  const mismatchedCaptionCount = useMemo(
    () =>
      videoSources.reduce(
        (total, source) => total + (source.scenes ?? []).filter((scene) => scene.caption && !sceneCaptionMatchesMode(scene, captionMode)).length,
        0,
      ),
    [captionMode, videoSources],
  );
  const cutGroups = useMemo(
    () =>
      videoSources
        .map((source) => ({
          source,
          allCuts: source.scenes ?? [],
          cuts: (source.scenes ?? []).filter((scene) => matchesCaptionSearch(captionSearch, source, scene)),
        }))
        .filter((group) => group.allCuts.length > 0 || group.source.sceneStatus === "failed" || group.source.sceneStatus === "detecting"),
    [captionSearch, videoSources],
  );
  const filteredCutCount = cutGroups.reduce((total, group) => total + group.cuts.length, 0);
  const characterNames = useMemo(
    () => referenceAssets
      .filter((asset) => asset.storageStatus === "uploaded" && (asset.role === "character-1" || asset.role === "character-2"))
      .map((asset) => asset.displayName.trim())
      .filter(Boolean),
    [referenceAssets],
  );
  const genericCaptionCount = useMemo(() => {
    if (!characterNames.length) return 0;
    return videoSources.reduce((total, source) => total + (source.scenes ?? []).filter((scene) => {
      const text = (scene.captionMeta?.caption ?? scene.caption ?? "").toLowerCase();
      if (!text) return false;
      return !characterNames.some((name) => text.includes(name.toLowerCase()));
    }).length, 0);
  }, [characterNames, videoSources]);

  function scrollToStep(key: IngestStepKey) {
    document.getElementById(`ingest-step-${key}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="space-y-4">
      <IngestChecklist steps={steps} onSelect={scrollToStep} />

      <IngestStep step={1} id="song" title={STEP_TITLES.song} tone={steps.song.tone} status={steps.song.status} hint="Essentia maps beats, onsets, and sections. Everything downstream is timed to this file.">
        {analysis ? (
          <div className="flex flex-wrap items-center justify-between gap-3 text-[12px] text-fg-2">
            <span className="truncate">{audioStatus}</span>
            <UploadControl accept="audio/*" variant="button" title="" detail="" actionLabel={isPreparingAudio ? "Analyzing…" : "Replace song"} disabled={isPreparingAudio} processingProgress={audioProgress} onFiles={onAudioUpload} />
          </div>
        ) : (
          <UploadControl
            accept="audio/*"
            title={isPreparingAudio ? "Analyzing the master song…" : "Drop the master song here"}
            detail="WAV, MP3, or M4A. Analysis usually takes under a minute."
            actionLabel={isPreparingAudio ? "Analyzing…" : "Choose song"}
            disabled={isPreparingAudio}
            isProcessing={isPreparingAudio}
            processingProgress={audioProgress}
            status={audioStatus}
            error={audioError}
            onFiles={onAudioUpload}
          />
        )}
      </IngestStep>

      <IngestStep step={2} id="references" title={STEP_TITLES.references} tone={steps.references.tone} status={steps.references.status} hint="Character 1 and Environment are required. Set each sheet's display name (e.g. Diego) — that exact name is used in scene captions and downstream prompts. Fixture path: .local-fixtures/reference-sheets/character-1.png">
        <ReferenceLibrary
          assets={referenceAssets}
          onUpload={onReferenceAssetUpload}
          onUpdate={onReferenceAssetUpdate}
          onRemove={onReferenceAssetRemove}
        />
      </IngestStep>

      <IngestStep step={3} id="footage" title={STEP_TITLES.footage} tone={steps.footage.tone} status={steps.footage.status} hint="Clips upload to RustFS and scene detection starts automatically.">
        {videoSources.length ? (
          <SourceVideoLibrary
            sources={videoSources}
            isPreparingVideos={isPreparingVideos}
            onAppendVideos={onAppendVideos}
            onReplaceVideos={onVideoUpload}
            onRemoveVideo={onRemoveVideo}
          />
        ) : (
          <UploadControl
            accept="video/*"
            multiple
            title="Drop source footage here"
            detail="One or more clips. Scenes are detected and captioned once the song, stem, and references are in."
            actionLabel={isPreparingVideos ? "Processing…" : "Choose clips"}
            disabled={isPreparingVideos}
            isProcessing={isPreparingVideos}
            status={videoStatus}
            error={videoError}
            onFiles={onVideoUpload}
          />
        )}
        {rerunFailedCount > 0 ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-danger-lo bg-danger-tint px-3 py-2 text-[12px] text-danger">
            <span>{rerunFailedCount} clip{rerunFailedCount === 1 ? "" : "s"} failed scene detection.</span>
            <Button size="sm" variant="danger" onClick={() => onRerunSceneAnalysis("failed")} disabled={isRerunningSceneAnalysis || isPreparingVideos}>
              {isRerunningSceneAnalysis ? "Re-running…" : "Rerun scene detection"}
            </Button>
          </div>
        ) : null}
      </IngestStep>

      <IngestStep step={4} id="stem" title={STEP_TITLES.stem} tone={steps.stem.tone} status={steps.stem.status} hint="Deepgram transcribes the isolated vocal for timed lyrics. Story and smart captions use these lines.">
        <IngestVocalStemLane
          analysis={analysis}
          vocalStemName={vocalStemName}
          transcriptSummary={transcriptSummary}
          disabled={isPreparingAudio}
          onTranscriptStart={onVocalStemTranscriptStart}
          onTranscriptComplete={onVocalStemTranscriptComplete}
          onTranscriptFailed={onVocalStemTranscriptFailed}
        />
      </IngestStep>

      <IngestStep
        step={5}
        id="captions"
        title={STEP_TITLES.captions}
        tone={steps.captions.tone}
        status={steps.captions.status}
        hint={captionContextReady
          ? "Qwen3-VL captions every detected scene with the named characters and location so Match can search them."
          : "Captions wait for the vocal stem and the Character 1 + Environment sheets so scenes are described with the right names."}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {FAST_CAPTIONS_ENABLED ? (
              <div className="flex rounded-md border border-line-2 bg-ink-0 p-[2px]">
                {(["fast", "smart"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => onCaptionModeChange(mode)}
                    className={`rounded-[4px] px-2.5 py-1 text-[11px] transition-colors ${captionMode === mode ? "bg-accent text-white" : "text-fg-2 hover:text-fg-0"}`}
                  >
                    {mode === "fast" ? "Fast · LFM" : "Smart · Qwen3-VL"}
                  </button>
                ))}
              </div>
            ) : null}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onRerunSceneAnalysis("all")}
              disabled={isRerunningSceneAnalysis || isPreparingVideos || stats.captionTotal === 0 || !captionContextReady}
              reason={!captionContextReady ? "Upload vocal stem + Char 1 + Environment first" : stats.captionTotal === 0 ? "No scenes to caption yet" : null}
            >
              {isRerunningSceneAnalysis ? "Recaptioning…" : "Recaption all"}
            </Button>
          </div>
        }
      >
        {mismatchedCaptionCount > 0 ? (
          <div className="mb-3 rounded-md border border-warn-lo bg-warn-tint px-3 py-2 text-[12px] text-warn">
            {mismatchedCaptionCount} caption{mismatchedCaptionCount === 1 ? "" : "s"} came from a different lane than the selected {captionMode === "smart" ? "Smart" : "Fast"} mode. Recaption to refresh them.
          </div>
        ) : null}
        {genericCaptionCount > 0 && characterNames.length ? (
          <div className="mb-3 rounded-md border border-line-2 bg-ink-0 px-3 py-2 text-[12px] leading-5 text-fg-2">
            {genericCaptionCount} caption{genericCaptionCount === 1 ? "" : "s"} still use generic terms instead of {characterNames.join(" / ")}. Set reference display names first, then use Recaption all so Match and Story see the canonical names.
          </div>
        ) : null}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <span className="text-[12px] text-fg-2">Every detected cut, grouped by clip, with the caption Match will search.</span>
          <div className="flex items-center gap-2">
            <input
              value={captionSearch}
              onChange={(event) => setCaptionSearch(event.target.value)}
              placeholder="Search captions…"
              className="h-8 w-64 rounded-md border border-line-2 bg-ink-0 px-3 text-[12px] text-fg-0 outline-none placeholder:text-fg-4 focus:border-accent"
            />
            <span className="font-mono text-[11px] text-fg-3">
              {captionSearch.trim() ? `${filteredCutCount}/${stats.sceneCount} cuts` : `${stats.sceneCount} cuts`}
            </span>
          </div>
        </div>
        {cutGroups.length ? (
          <div className="space-y-3">
            {cutGroups.map(({ source, allCuts, cuts }) => (
              <div key={source.id} className="rounded-md border border-line bg-ink-1 p-2.5">
                <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="rounded-sm bg-ink-3 px-1.5 py-[2px] font-mono text-accent">S{source.id + 1}</span>
                  <span className="max-w-[360px] truncate font-mono text-fg-1" title={source.name}>{source.name}</span>
                  <span className="font-mono text-fg-3">
                    {allCuts.length} cut{allCuts.length === 1 ? "" : "s"} · {allCuts.filter((scene) => Boolean(scene.caption)).length}/{allCuts.length} captioned
                  </span>
                  {source.sceneStatus === "detecting" ? <span className="text-warn">detecting…</span> : null}
                  {source.sceneStatus === "failed" ? (
                    <span className="max-w-[420px] truncate text-danger" title={source.sceneError ?? undefined}>
                      scene detection failed{source.sceneError ? ` · ${source.sceneError}` : ""}
                    </span>
                  ) : null}
                </div>
                {cuts.length ? (
                  <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-5">
                    {cuts.map((scene) => (
                      <CutCaptionCard
                        key={`${source.id}-${scene.id}-${scene.start}`}
                        sourceName={source.name}
                        scene={scene}
                        fallbackThumbnail={source.thumbnailUrl}
                        onMergeLeft={allCuts.findIndex((candidate) => candidate.id === scene.id) > 0 ? () => onMergeScene(source.id, scene.id) : undefined}
                      />
                    ))}
                  </div>
                ) : allCuts.length ? (
                  <div className="rounded-md border border-dashed border-line-2 bg-ink-0 px-3 py-3 text-[12px] text-fg-3">No cuts in this clip match the search.</div>
                ) : (
                  <div className="rounded-md border border-dashed border-line-2 bg-ink-0 px-3 py-3 text-[12px] text-fg-3">
                    {source.sceneStatus === "failed" ? "No cuts yet — rerun scene detection above." : "Waiting for scene detection to finish."}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-line-2 bg-ink-0 px-3 py-8 text-center text-[12px] text-fg-3">
            Scene cuts and captions appear here once footage finishes detection.
          </div>
        )}
      </IngestStep>
    </div>
  );
}

function IngestChecklist({ steps, onSelect }: { steps: Record<IngestStepKey, { tone: ReadinessTone; status: string }>; onSelect: (key: IngestStepKey) => void }) {
  const readyCount = STEP_ORDER.filter((key) => steps[key].tone === "ready").length;
  return (
    <nav aria-label="Ingest checklist" className="rounded-md border border-line bg-ink-2 px-3 py-2.5">
      <div className="mb-1.5 flex items-center justify-between">
        <Kicker>Checklist</Kicker>
        <span className="font-mono text-[11px] text-fg-3">{readyCount}/{STEP_ORDER.length} ready</span>
      </div>
      <ol className="grid gap-1 md:grid-cols-5">
        {STEP_ORDER.map((key, index) => {
          const step = steps[key];
          return (
            <li key={key}>
              <button
                type="button"
                onClick={() => onSelect(key)}
                className="flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left hover:bg-ink-3"
              >
                <StepStatusIcon tone={step.tone} step={index + 1} />
                <span className="min-w-0">
                  <span className="block text-[11.5px] font-medium text-fg-0">{STEP_TITLES[key]}</span>
                  <span className={`block truncate text-[10.5px] ${TONE_TEXT[step.tone]}`} title={step.status}>{step.status}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function StepStatusIcon({ tone, step }: { tone: ReadinessTone; step: number }) {
  if (tone === "ready") {
    return (
      <span className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-ok" aria-hidden>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-ink-0">
          <path d="M2 5.2 4.1 7.3 8 3.2" />
        </svg>
      </span>
    );
  }
  const ring = tone === "processing" ? "border-warn" : tone === "failed" ? "border-danger" : "border-line-3";
  return (
    <span className={`mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border ${ring} font-mono text-[9px] text-fg-3`} aria-hidden>
      {step}
    </span>
  );
}

function IngestStep({ step, id, title, tone, status, hint, actions, children }: {
  step: number;
  id: IngestStepKey;
  title: string;
  tone: ReadinessTone;
  status: string;
  hint: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={`ingest-step-${id}`} className="scroll-mt-4 rounded-md border border-line bg-ink-2 p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <StepStatusIcon tone={tone} step={step} />
            <h2 className="text-[14px] font-semibold text-fg-0">{title}</h2>
            <span className={`flex items-center gap-1.5 text-[11.5px] ${TONE_TEXT[tone]}`}>
              <span className="max-w-[440px] truncate" title={status}>{status}</span>
            </span>
          </div>
          <p className="mt-1.5 max-w-3xl text-[12px] leading-5 text-fg-3">{hint}</p>
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

// Keep the lane type exported for consumers that read the checklist model.
export type { IngestLane, IngestLaneKey };

function ReferenceLibrary({
  assets,
  onUpload,
  onUpdate,
  onRemove,
}: {
  assets: ReferenceAsset[];
  onUpload: (role: ReferenceAssetLibraryRole, files: File[]) => void | Promise<void>;
  onUpdate: (assetId: string, patch: Partial<Pick<ReferenceAsset, "displayName" | "promptHint" | "kind">>) => void;
  onRemove: (assetId: string) => void;
}) {
  const roles: ReferenceAssetRole[] = ["character-1", "character-2", "environment", "custom"];
  const crowdAssets = assets.filter((asset) => asset.role === "crowd");
  const readyCount = assets.filter((asset) => asset.storageStatus === "uploaded" && asset.storageUrl).length;
  const failedCount = assets.filter((asset) => asset.storageStatus === "failed").length;

  return (
    <section className="rounded-[2px] border border-[#1a1a1a] bg-[#0b0b0b] p-3">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-[#e05c00]">Reference library / character bible</div>
          <div className="mt-1 max-w-4xl text-[11px] leading-5 text-[#6d6d6d]">
            Upload persistent character sheets and continuity references once. Generate orders references after the composition frame from the cut: Char 1, Char 2, Environment, selected Crowd sheets, Custom.
          </div>
        </div>
        <div className="font-mono text-[10px] text-[#777]">
          {readyCount}/{assets.length} refs ready{failedCount ? <span className="text-[#d24b3f]"> · {failedCount} failed</span> : null}
        </div>
      </div>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        {roles.map((role) => (
          <ReferenceSlotCard
            key={role}
            role={role}
            asset={assets.find((candidate) => candidate.role === role)}
            onUpload={(files) => onUpload(role, files)}
            onUpdate={onUpdate}
            onRemove={onRemove}
          />
        ))}
      </div>
      <CrowdReferenceTray
        assets={crowdAssets}
        onUpload={(files) => onUpload("crowd", files)}
        onUpdate={onUpdate}
        onRemove={onRemove}
      />
    </section>
  );
}

function CrowdReferenceTray({
  assets,
  onUpload,
  onUpdate,
  onRemove,
}: {
  assets: ReferenceAsset[];
  onUpload: (files: File[]) => void | Promise<void>;
  onUpdate: (assetId: string, patch: Partial<Pick<ReferenceAsset, "displayName" | "promptHint" | "kind">>) => void;
  onRemove: (assetId: string) => void;
}) {
  const readyCount = assets.filter((asset) => asset.storageStatus === "uploaded" && asset.storageUrl).length;

  return (
    <details className="mt-2 rounded-[2px] border border-[#202020] bg-[#070707]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 marker:hidden">
        <div className="min-w-0">
          <div className="text-[9px] uppercase tracking-[0.16em] text-[#d0d0d0]">Crowd / extras · expandable library</div>
          <div className="mt-1 truncate text-[9px] text-[#555]">Store as many background-cast sheets as needed; Generate selects up to three for the current shot.</div>
        </div>
        <div className="shrink-0 font-mono text-[8px] uppercase tracking-[0.12em] text-[#78c878]">{readyCount}/{assets.length} ready</div>
      </summary>
      <div className="border-t border-[#181818] p-2">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-[9px] leading-4 text-[#666]">These sheets control background-dancer variety and wardrobe only. They never replace a named lead or the location reference.</div>
          <UploadControl accept="image/*" multiple title="" detail="" actionLabel="Add crowd sheets" variant="button" onFiles={onUpload} />
        </div>
        {assets.length ? (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {assets.map((asset) => {
              const ready = asset.storageStatus === "uploaded" && Boolean(asset.storageUrl);
              const failed = asset.storageStatus === "failed";
              return (
                <article key={asset.id} className={`w-[220px] shrink-0 rounded-[2px] border bg-[#050505] p-2 ${failed ? "border-[#743029]" : ready ? "border-[#245c2c]" : "border-[#6e5522]"}`}>
                  <div className="relative aspect-video overflow-hidden rounded-[2px] border border-[#181818] bg-black">
                    {asset.previewUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={asset.previewUrl} alt={asset.displayName} className="h-full w-full object-contain" loading="lazy" decoding="async" />
                    ) : <div className="flex h-full items-center justify-center text-[8px] uppercase tracking-[0.12em] text-[#444]">No preview</div>}
                    <span className="absolute right-1 top-1 rounded-[1px] bg-[#000000c7] px-1.5 py-0.5 font-mono text-[7px] uppercase text-[#aaa]">{asset.storageStatus}</span>
                  </div>
                  <input
                    value={asset.displayName}
                    onChange={(event) => onUpdate(asset.id, { displayName: event.target.value })}
                    className="mt-2 h-[28px] w-full rounded-[2px] border border-[#202020] bg-[#050505] px-2 font-mono text-[9px] text-[#c0c0c0] outline-none focus:border-[#e05c00]"
                    placeholder="Crowd sheet name"
                  />
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <div className="min-w-0 truncate font-mono text-[7px] text-[#555]" title={asset.storagePath}>{asset.storagePath ?? asset.fileName}</div>
                    <button type="button" onClick={() => onRemove(asset.id)} className="shrink-0 text-[8px] uppercase tracking-[0.12em] text-[#777] hover:text-[#d24b3f]">Remove</button>
                  </div>
                  {asset.storageError ? <div className="mt-2 text-[8px] leading-4 text-[#d24b3f]">{asset.storageError}</div> : null}
                </article>
              );
            })}
          </div>
        ) : (
          <div className="rounded-[2px] border border-dashed border-[#242424] px-3 py-5 text-center text-[9px] uppercase tracking-[0.14em] text-[#555]">No crowd sheets yet</div>
        )}
      </div>
    </details>
  );
}

function ReferenceSlotCard({
  role,
  asset,
  onUpload,
  onUpdate,
  onRemove,
}: {
  role: ReferenceAssetRole;
  asset?: ReferenceAsset;
  onUpload: (files: File[]) => void | Promise<void>;
  onUpdate: (assetId: string, patch: Partial<Pick<ReferenceAsset, "displayName" | "promptHint" | "kind">>) => void;
  onRemove: (assetId: string) => void;
}) {
  const failed = asset?.storageStatus === "failed";
  const ready = asset?.storageStatus === "uploaded" && Boolean(asset.storageUrl);
  const uploading = asset?.storageStatus === "uploading";
  const border = "border-line-2";

  return (
    <div className={`flex flex-col rounded-md border ${border} bg-ink-0 p-2`}>
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[9px] uppercase tracking-[0.16em] text-fg-2">{REFERENCE_ASSET_SLOT_LABELS[role]}</div>
          <div className="mt-0.5 line-clamp-2 text-[9px] leading-4 text-fg-4">{REFERENCE_ASSET_SLOT_DETAILS[role]}</div>
        </div>
        <StatusDot tone={failed ? "failed" : ready ? "ready" : uploading ? "processing" : "waiting"} pulse={uploading} />
      </div>

      {asset ? (
        <div className="flex flex-col">
          <div className="relative h-[120px] overflow-hidden rounded-sm border border-line bg-ink-1">
            {asset.previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={asset.previewUrl} alt={asset.displayName} className="h-full w-full object-contain" loading="lazy" decoding="async" />
            ) : <div className="flex h-full items-center justify-center text-[8px] uppercase tracking-[0.12em] text-fg-4">No preview</div>}
            <span className="absolute left-1 top-1 rounded-sm bg-ink-0/90 px-1.5 py-0.5 font-mono text-[7px] uppercase tracking-[0.1em] text-fg-2">{asset.kind}</span>
            <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-ink-0/95 to-transparent px-2 pb-1 pt-4 font-mono text-[10px] font-medium text-fg-0">{asset.displayName || REFERENCE_ASSET_SLOT_LABELS[role]}</span>
          </div>
          <div className="mt-2 grid gap-1.5">
            <input
              value={asset.displayName}
              onChange={(event) => onUpdate(asset.id, { displayName: event.target.value })}
              className="h-[28px] w-full rounded-sm border border-line-2 bg-ink-1 px-2 font-mono text-[10px] text-fg-1 outline-none focus:border-accent"
              placeholder="Canonical name (e.g. Diego)"
              aria-label={`${REFERENCE_ASSET_SLOT_LABELS[role]} display name`}
            />
            <select
              value={asset.kind}
              onChange={(event) => onUpdate(asset.id, { kind: event.target.value as ReferenceAssetKind })}
              className="h-[28px] w-full rounded-sm border border-line-2 bg-ink-1 px-2 font-mono text-[10px] text-fg-2 outline-none focus:border-accent"
              aria-label={`${REFERENCE_ASSET_SLOT_LABELS[role]} kind`}
            >
              {(["character", "environment", "crowd", "prop", "vehicle", "wardrobe", "custom"] as const).map((kind) => <option key={kind} value={kind}>{kind}</option>)}
            </select>
            <textarea
              value={asset.promptHint}
              onChange={(event) => onUpdate(asset.id, { promptHint: event.target.value })}
              rows={2}
              className="h-[44px] w-full resize-none rounded-sm border border-line-2 bg-ink-1 px-2 py-1 text-[10px] leading-4 text-fg-2 outline-none focus:border-accent"
              placeholder="Identity lock note for captions / Nano Banana"
            />
          </div>
          <div className="mt-1.5 min-h-[20px]">
            {asset.storageError ? <div className="rounded-sm border border-danger-lo bg-danger-tint p-1.5 text-[9px] leading-4 text-danger">{asset.storageError}</div> : null}
          </div>
          <div className="mt-2 flex gap-1.5">
            <UploadControl accept="image/*" title="Replace reference" detail="Upload a new reference image." actionLabel="Replace" variant="button" onFiles={onUpload} />
            <button type="button" onClick={() => onRemove(asset.id)} className="rounded-sm border border-line-2 px-2 py-[2px] text-[10px] uppercase tracking-[0.12em] text-fg-3 hover:border-danger-lo hover:text-danger">Remove</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col">
          <div className="flex h-[120px] items-center justify-center rounded-sm border border-dashed border-line-2 bg-ink-1 px-4 text-center">
            <div>
              <div className="text-[11px] text-fg-2">Upload {REFERENCE_ASSET_SLOT_LABELS[role]}</div>
              <div className="mt-2 text-[9px] uppercase tracking-[0.14em] text-fg-4">RustFS · used in captions</div>
            </div>
          </div>
          <div className="mt-2">
            <UploadControl
              accept="image/*"
              title=""
              detail=""
              actionLabel="Add reference"
              variant="button"
              onFiles={onUpload}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function CutCaptionCard({ sourceName, scene, fallbackThumbnail, onMergeLeft }: { sourceName: string; scene: DetectedSceneSegment; fallbackThumbnail?: string; onMergeLeft?: () => void }) {
  const hasCaption = Boolean(scene.caption);
  const failed = Boolean(scene.captionError);
  const tone: ReadinessTone = failed ? "failed" : hasCaption ? "ready" : "waiting";
  const displayCaption = getDisplayCaption(scene) ?? scene.captionError ?? "No caption yet.";
  const namedSubjects = scene.captionMeta?.subjects?.filter(Boolean) ?? [];
  const frameStrip = [
    ["first", scene.firstFrameUrl ?? scene.thumbnailUrl ?? fallbackThumbnail],
    ["middle", scene.middleFrameUrl],
    ["last", scene.lastFrameUrl],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));
  return (
    <div className="overflow-hidden rounded-md border border-line bg-ink-0">
      <div className="relative aspect-video bg-ink-1">
        {scene.firstFrameUrl || scene.thumbnailUrl || fallbackThumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={scene.firstFrameUrl ?? scene.thumbnailUrl ?? fallbackThumbnail} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" decoding="async" />
        ) : null}
        <div className="absolute left-[6px] top-[6px] rounded-[2px] bg-[#00000099] px-1 py-[2px] font-mono text-[8px] text-[#e05c00]">CUT {scene.id + 1}</div>
        <div className="absolute bottom-[6px] right-[6px] rounded-[2px] bg-[#00000099] px-1 py-[2px] font-mono text-[8px] text-[#d0d0d0]">{fmt(scene.start)}–{fmt(scene.end)}</div>
      </div>
      <div className="space-y-1 border-t border-[#141414] p-2">
        {frameStrip.length > 1 ? (
          <div className="grid grid-cols-3 gap-1">
            {frameStrip.map(([label, url]) => (
              <div key={label} className="relative aspect-video overflow-hidden rounded-[2px] border border-[#181818] bg-black">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={`${label} frame`} className="h-full w-full object-cover" loading="lazy" decoding="async" />
                <span className="absolute bottom-0 left-0 bg-[#000000aa] px-1 py-[1px] font-mono text-[7px] uppercase tracking-[0.1em] text-[#b0b0b0]">{label}</span>
              </div>
            ))}
          </div>
        ) : null}
        <div className="truncate font-mono text-[8px] text-fg-3" title={sourceName}>{sourceName}</div>
        <div className="flex items-center gap-1.5 text-[8px] uppercase tracking-[0.12em] text-fg-3">
          <StatusDot tone={tone} pulse={tone === "processing"} />
          <span title={scene.captionError ?? undefined}>
            {failed ? (hasCaption ? "Recaption failed · kept previous" : "Caption failed") : hasCaption ? "Caption ready" : "Caption pending"}
          </span>
        </div>
        {namedSubjects.length ? (
          <div className="flex flex-wrap gap-1">
            {namedSubjects.map((subject) => (
              <span key={subject} className="rounded-sm border border-line-2 bg-ink-2 px-1.5 py-[1px] font-mono text-[8px] uppercase tracking-[0.08em] text-accent">{subject}</span>
            ))}
          </div>
        ) : null}
        <div className="line-clamp-3 min-h-12 text-[9px] leading-4 text-fg-2" title={displayCaption}>
          {displayCaption}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1 font-mono text-[8px] uppercase tracking-[0.1em] text-[#555]">
          {scene.captionMode ? <span className="rounded-[2px] border border-[#1c1c1c] px-1 py-[1px]">{scene.captionMode}</span> : null}
          {scene.captionSource ? <span className="rounded-[2px] border border-[#1c1c1c] px-1 py-[1px]">{scene.captionSource}</span> : null}
          {scene.captionModel ? <span className="max-w-full truncate rounded-[2px] border border-[#1c1c1c] px-1 py-[1px]" title={scene.captionModel}>{scene.captionModel}</span> : null}
          {onMergeLeft ? (
            <button
              type="button"
              onClick={onMergeLeft}
              title="Not a real cut? Merge this cut into the previous one."
              className="ml-auto rounded-[2px] border border-[#242424] px-1.5 py-[1px] uppercase tracking-[0.1em] text-[#777] hover:border-[#e05c00] hover:text-[#e05c00]"
            >
              ← Merge
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function matchesCaptionSearch(query: string, source: UploadedVideoSource, scene: DetectedSceneSegment) {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);
  if (!terms.length) return true;

  const haystack = [
    source.name,
    scene.label,
    scene.caption,
    scene.captionError,
    scene.captionSource,
    scene.captionMode,
    scene.captionModel,
    scene.captionMeta?.caption,
    scene.captionMeta?.shotType,
    scene.captionMeta?.action,
    scene.captionMeta?.setting,
    scene.captionMeta?.lighting,
    scene.captionMeta?.timeOfDay,
    scene.captionMeta?.weather,
    ...(scene.captionMeta?.subjects ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return terms.every((term) => haystack.includes(term));
}

function getDisplayCaption(scene: DetectedSceneSegment) {
  const text = scene.captionMeta?.caption ?? scene.caption;
  if (!text) return null;
  const parsed = parseCaptionObject(text) ?? extractCaptionField(text);
  return parsed?.caption ?? text;
}

function parseCaptionObject(text: string) {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed) as { caption?: unknown };
    return typeof parsed.caption === "string" && parsed.caption.trim() ? { caption: parsed.caption } : null;
  } catch {
    return null;
  }
}

function extractCaptionField(text: string) {
  const match = /"caption"\s*:\s*"((?:\\.|[^"\\])*)"/i.exec(text.trim());
  if (!match) return null;
  try {
    return { caption: JSON.parse(`"${match[1]}"`) as string };
  } catch {
    return { caption: match[1].replace(/\\"/g, '"') };
  }
}

function buildVideoStats(sources: UploadedVideoSource[], captionMode: SceneCaptionMode) {
  return sources.reduce(
    (acc, source) => {
      const scenes = source.scenes ?? [];
      acc.sceneCount += scenes.length;
      acc.captionReady += scenes.filter((scene) => Boolean(scene.caption)).length;
      acc.captionTotal += scenes.length;
      if (source.sceneStatus === "detecting") acc.detecting += 1;
      if (source.sceneStatus === "failed") acc.sceneFailed += 1;
      if (source.captionStatus === "captioning") acc.captioning += 1;
      if (isSourceCaptionFailed(source, captionMode)) acc.captionFailed += 1;
      if (source.storageStatus === "uploaded") acc.storageUploaded += 1;
      if (source.storageStatus === "failed") acc.storageFailed += 1;
      return acc;
    },
    {
      sceneCount: 0,
      captionReady: 0,
      captionTotal: 0,
      detecting: 0,
      sceneFailed: 0,
      captioning: 0,
      captionFailed: 0,
      storageUploaded: 0,
      storageFailed: 0,
    },
  );
}
