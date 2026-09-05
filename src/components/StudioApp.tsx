"use client";

import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { extractWaveformData, fetchEssentiaAnalysis, getEssentiaStorageFromPayload, parseEssentiaPayload } from "./studio/audioAnalysis";
import type { DeepgramTranscriptSummary } from "./studio/deepgramUtils";
import { NAV, resolveCaptionMode } from "./studio/constants";
import { mergeUploadedVideoSourceUpdate, needsSceneDetectionRetry, prepareVideoSources, reconcileSourceCaptionStatus, rerunSourceSceneAnalysis, revokePreparedVideoSources, selectSceneRetrySources } from "./studio/mediaUpload";
import { uploadFileInChunks } from "./studio/chunkedUploadClient";
import type { VideoSceneUpdate } from "./studio/mediaUpload";
import { buildEditPlanPreviewSegments, normalizeStoryEditSettings, type EditPlanPreviewSegment, type MusicVideoProject } from "./studio/musicVideoProject";
import { selectStorySectionCandidate } from "./studio/musicVideoProjectSelection";
import { buildAutoShaderCues, describeMusicVideoShaderPreset, MUSIC_VIDEO_SHADER_PRESETS, type ShaderAccentKinds, type ShaderEffectCue } from "./studio/shaderEffectPlan";
import {
  ACTIVE_STUDIO_PROJECT_KEY,
  STUDIO_AUTOSAVE_INTERVAL_MS,
  buildVideoMediaKey,
  clearStudioProjectDraft,
  createPersistableStudioProjectDraft,
  hydrateStudioProjectDraft,
  loadSavedStudioProject,
  loadStudioProjectDraft,
  saveNamedStudioProject,
  saveServerStudioProjectDraft,
  saveStudioProjectDraft,
  type PersistedCommittedSplit,
  type RuntimeStudioProjectDraft,
} from "./studio/projectPersistence";
import type { StudioProjectSummary } from "@/lib/studioProjectStore";
import { applyApprovedGeneratedAssets, buildGeneratedAssetContextPreview, buildGeneratedAssetPlaybackUrl, type GeneratedStudioAsset } from "./studio/generatedAssets";
import { createLocalReferenceAsset, uploadReferenceAssetToRustFs, type ReferenceAsset, type ReferenceAssetLibraryRole } from "./studio/referenceAssets";
import { BrowserPreviewPlayer, createPreviewPlayerState, type PreviewPlayerState, type PreviewSegment } from "./studio/previewPlayer";
import { slicePreviewCutRange, type PreviewCutRange } from "./studio/resolvedPreviewSelection";
import { ComposeTab } from "./studio/panels/ComposeTab";
import { IngestTab } from "./studio/panels/IngestTab";
import { GenerateTab, type SeedanceMasterAudioRef } from "./studio/panels/GenerateTab";
import { JoinTab } from "./studio/panels/JoinTab";
import { RampTab } from "./studio/panels/RampTab";
import { MatchTab, type MatchMode } from "./studio/panels/MatchTab";
import { SplitTab } from "./studio/panels/SplitTab";
import { createDefaultStoryTabState, StoryTab } from "./studio/panels/StoryTab";
import { StudioHeader } from "./studio/StudioHeader";
import { StudioAudioLane } from "./studio/StudioAudioLane";
import { PreviewDock } from "./studio/PreviewDock";
import { StageHeader } from "./studio/StageHeader";
import { StudioSidebar } from "./studio/StudioSidebar";
import { StudioStatusBar } from "./studio/StudioStatusBar";
import { buildStageHeaderModel } from "./studio/stageActions";
import { createSaveState, type SaveState } from "./studio/saveState";
import type { StatusTone } from "./studio/ui";
import { buildStudioPipelineInput } from "./studio/buildStudioPipelineInput";
import { buildPipelineState } from "./studio/studioPipeline";
import { isStoryPlanConfirmable, type StoryTreatment } from "./studio/storyTreatments";
import { buildShuffleQueue } from "./studio/shuffleQueue";
import { waitForTriggerRunOutput } from "@/lib/clientTriggerRuns";
import { rankManifestCandidates } from "./studio/manifestRanking";
import { buildMusicCutEvents, buildSegmentManifest } from "./studio/segmentManifest";
import {
  createSectionRecomputeState,
  failSectionRecompute,
  markSectionReady,
  markSectionRecomputeRunning,
  startSectionRecompute,
  swapReadySection,
  updateSectionRecomputeProgress,
} from "./studio/sectionRecompute";
import {
  buildPreviewAssetUrl,
  deriveActionDisabledState,
  deriveCompletedLabel,
  deriveEffectiveClipOrder,
  deriveManifestRankingMode,
  derivePreviewStatusLabel,
  derivePreviewWindow,
  normalizeColorScore,
} from "./studio/studioUiState";
import { mergeSceneIntoPrevious } from "./studio/sceneSplit";
import { buildAudioDrivenSegments, buildBeatSegments, buildSourceClipSpans, buildUnifiedSplitSegments, getSourceClipTimeOffset } from "./studio/sourceTimeline";
import type { SourceClipSpan, SourceTimelineSegment, SplitMode } from "./studio/sourceTimeline";
import { assignVideoSourceIds, getNextVideoSourceId, removeVideoSourceById, withVideoSourceId } from "./studio/videoSourceIdentity";
import type {
  BeatJoinAnalysis,
  ColorGradient,
  RampPreset,
  SceneCaptionMode,
  SegmentPreview,
  ShuffleMode,
  Tab,
  UploadedVideoSource,
} from "./studio/types";

type PendingStudioAutosave = {
  readonly projectId: string | null;
  readonly projectName: string;
  readonly params: Parameters<typeof createPersistableStudioProjectDraft>[0];
};

export default function StudioApp() {
  const videoSourcesRef = useRef<UploadedVideoSource[]>([]);
  const referenceAssetsRef = useRef<ReferenceAsset[]>([]);
  const [tab, setTab] = useState<Tab>("review");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isDockCollapsed, setIsDockCollapsed] = useState(false);
  const [playhead] = useState(0.08);
  const [, setAudioPreviewPlayhead] = useState(0);
  const [activeClip, setActiveClip] = useState(2);

  const [clipDur, setClipDur] = useState(5);
  const [barsPerSeg] = useState(4);
  const [bpm] = useState(130);
  const [sensitivity] = useState(20);
  const [beatSplitMode] = useState<"beats" | "onsets">("onsets");
  const [splitMode, setSplitMode] = useState<SplitMode>("scene");
  const [videoSources, setVideoSources] = useState<UploadedVideoSource[]>([]);
  const [videoStatus, setVideoStatus] = useState("Upload one or more video clips to begin.");
  const [videoError, setVideoError] = useState<string | null>(null);
  const [isPreparingVideos, setIsPreparingVideos] = useState(false);
  const [isRerunningSceneAnalysis, setIsRerunningSceneAnalysis] = useState(false);
  const [audioStatus, setAudioStatus] = useState("Upload a song to unlock beat sync.");
  const [audioError, setAudioError] = useState<string | null>(null);
  const [isPreparingAudio, setIsPreparingAudio] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0);

  const [shuffleMode] = useState<ShuffleMode>("motion");
  const [minScore] = useState(0.5);
  const [lookahead] = useState(3);
  const [keepPct] = useState(70);
  const [colorGradient, setColorGradient] = useState<ColorGradient>("Sunset");
  const matchMode: MatchMode = "balanced";
  const [matchOnsetDensity, setMatchOnsetDensity] = useState(65);
  const [matchLyricCueBlend, setMatchLyricCueBlend] = useState(60);
  const [matchLyricMergeWindow, setMatchLyricMergeWindow] = useState(3.0);

  const [joinClipStates, setJoinClipStates] = useState<Record<number, boolean>>({});

  const [beatJoinAnalysis, setBeatJoinAnalysis] = useState<BeatJoinAnalysis | null>(null);

  const [rampPreset, setRampPreset] = useState<RampPreset>("dynamic");
  const [minSpeed, setMinSpeed] = useState(0.5);
  const [maxSpeed, setMaxSpeed] = useState(2.0);
  const [rampDur, setRampDur] = useState(0.5);
  const [energyThresh, setEnergyThresh] = useState(0.4);
  const [buildBoost, setBuildBoost] = useState(1.3);
  const [dropSlowdown, setDropSlowdown] = useState(0.6);

  const [progress, setProgress] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [previewState, setPreviewState] = useState(createSectionRecomputeState);
  const [committedBeatSplit, setCommittedBeatSplit] = useState<PersistedCommittedSplit | null>(null);
  const [storyState, setStoryState] = useState(createDefaultStoryTabState);
  const [musicVideoProject, setMusicVideoProject] = useState<MusicVideoProject | null>(null);
  const [captionMode, setCaptionMode] = useState<SceneCaptionMode>("smart");
  const [referenceAssets, setReferenceAssets] = useState<ReferenceAsset[]>([]);
  const [generatedAssets, setGeneratedAssets] = useState<GeneratedStudioAsset[]>([]);
  const [shaderPresetId, setShaderPresetId] = useState(MUSIC_VIDEO_SHADER_PRESETS[0].id);
  const [shaderAccentKinds, setShaderAccentKinds] = useState<ShaderAccentKinds>({});
  const [finalExportStatus, setFinalExportStatus] = useState("Final export waits for a generated story preview and master audio.");
  const [finalExportError, setFinalExportError] = useState<string | null>(null);
  const [finalExportUrl, setFinalExportUrl] = useState<string | null>(null);
  const [finalExportName, setFinalExportName] = useState<string | null>(null);
  const [finalExportCueCount, setFinalExportCueCount] = useState(0);
  const [isFinalExporting, setIsFinalExporting] = useState(false);
  const [isShaderCaptureExporting, setIsShaderCaptureExporting] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>(() => createSaveState("local"));
  const [draftRestored, setDraftRestored] = useState(false);
  const skipNextDirtyMarkRef = useRef(true);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeProjectName, setActiveProjectName] = useState("Untitled project");
  const pendingAutosaveRef = useRef<PendingStudioAutosave | null>(null);
  const autosaveInFlightRef = useRef(false);
  const flushPendingAutosaveRef = useRef<(() => Promise<void>) | null>(null);
  const referenceAutosaveRequestedRef = useRef(false);
  const vocalStemAutosaveRequestedRef = useRef(false);
  const ingestAutosaveDebounceRef = useRef<number | null>(null);
  const workflowCheckpointAutosaveRequestedRef = useRef(false);
  const [ingestAutosaveTick, setIngestAutosaveTick] = useState(0);

  const audioFileRef = useRef<File | null>(null);
  const videoFilesByMediaKeyRef = useRef(new Map<string, Blob>());
  // Stable singleton held in state so render can read it without touching a ref.
  const [previewPlayer] = useState(() => new BrowserPreviewPlayer({ warmSourceLimit: 4, warmAheadSegments: 8 }));
  const previewPlayerRef = useRef(previewPlayer);
  const [browserPreviewState, setBrowserPreviewState] = useState<PreviewPlayerState>(createPreviewPlayerState);
  const [isBrowserPreviewActive, setIsBrowserPreviewActive] = useState(false);
  const [isPreviewExpanded, setIsPreviewExpanded] = useState(false);
  const [retainedBrowserPreviewSegments, setRetainedBrowserPreviewSegments] = useState<PreviewSegment[]>([]);
  const [retainedPreviewEffectCues, setRetainedPreviewEffectCues] = useState<ShaderEffectCue[]>([]);
  const [generatePreviewRange, setGeneratePreviewRange] = useState<PreviewCutRange | null>(null);
  const [generatedAuditionSegments, setGeneratedAuditionSegments] = useState<PreviewSegment[] | null>(null);
  const [previewAuditionRequest, setPreviewAuditionRequest] = useState(0);
  const handledPreviewAuditionRequestRef = useRef(0);
  const lastPreviewEffectCuesRef = useRef<ShaderEffectCue[]>([]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const savedTab = window.localStorage.getItem("svs.studio.activeTab");
    if (savedTab && NAV.some((item) => item.key === savedTab)) {
      setTab(savedTab as Tab);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("svs.studio.activeTab", tab);
  }, [tab]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setIsSidebarCollapsed(window.localStorage.getItem("svs.studio.sidebarCollapsed") === "1");
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("svs.studio.sidebarCollapsed", isSidebarCollapsed ? "1" : "0");
  }, [isSidebarCollapsed]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("svs.studio.dockCollapsed", isDockCollapsed ? "1" : "0");
  }, [isDockCollapsed]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setIsDockCollapsed(window.localStorage.getItem("svs.studio.dockCollapsed") === "1");
  }, []);

  useEffect(() => {
    const player = previewPlayerRef.current;
    const unsubscribe = player.subscribe((state) => {
      setBrowserPreviewState(state);
      setIsBrowserPreviewActive(state.status === "playing" || state.status === "paused" || state.status === "loading");
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    return () => {
      if (beatJoinAnalysis?.audioUrl) {
        URL.revokeObjectURL(beatJoinAnalysis.audioUrl);
      }
    };
  }, [beatJoinAnalysis]);

  useEffect(() => {
    videoSourcesRef.current = videoSources;
  }, [videoSources]);

  useEffect(() => {
    let cancelled = false;

    const activeId = window.localStorage.getItem(ACTIVE_STUDIO_PROJECT_KEY);
    const restore = activeId
      ? loadSavedStudioProject(activeId).then((saved) => {
          setActiveProjectId(saved.project.id);
          setActiveProjectName(saved.project.name);
          return hydrateStudioProjectDraft({ draft: saved.draft });
        }).catch(() => loadStudioProjectDraft())
      : loadStudioProjectDraft();

    restore
      .then((draft) => {
        if (cancelled) return;
        if (!draft) {
          setDraftRestored(true);
          return;
        }

        applyRestoredProjectDraft(draft);
        skipNextDirtyMarkRef.current = true;
        setSaveState({
          kind: "restored",
          at: Date.now(),
          scope: activeId ? "project" : "local",
          detail: activeId ? "Restored saved project from RustFS." : "Restored the draft saved in this browser.",
        });
        setDraftRestored(true);
      })
      .catch((error) => {
        console.warn("[Studio] Could not restore local project draft", error);
        if (!cancelled) {
          setSaveState({ kind: "error", at: null, scope: "local", detail: "Could not restore the local draft; starting fresh." });
          setDraftRestored(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!draftRestored) return;

    pendingAutosaveRef.current = {
      projectId: activeProjectId,
      projectName: activeProjectName,
      params: {
        analysis: beatJoinAnalysis,
        videoSources,
        storyState,
        musicVideoProject,
        referenceAssets,
        generatedAssets,
        captionSettings: buildSceneCaptionSettings(captionMode, beatJoinAnalysis, storyState, referenceAssets),
        workflowUiSettings: {
          activeTab: tab,
          splitMode,
          matchMode,
          matchOnsetDensity,
          matchLyricCueBlend,
          matchLyricMergeWindow,
          colorGradient,
          shaderPresetId,
          shaderAccentKinds,
          isPreviewExpanded,
          committedSplit: committedBeatSplit ?? undefined,
          finalExport: finalExportUrl ? {
            videoUrl: finalExportUrl,
            downloadFileName: finalExportName ?? "stack-structure-final.mp4",
            cueCount: finalExportCueCount,
            status: finalExportStatus,
          } : undefined,
        },
      },
    };
    // The first run after a restore only mirrors what was just loaded; it is not a user edit.
    if (skipNextDirtyMarkRef.current) {
      skipNextDirtyMarkRef.current = false;
      return;
    }
    setSaveState((current) => (current.kind === "dirty" || current.kind === "saving" ? current : { ...current, kind: "dirty" }));
  }, [activeProjectId, activeProjectName, beatJoinAnalysis, captionMode, colorGradient, committedBeatSplit, draftRestored, finalExportCueCount, finalExportName, finalExportStatus, finalExportUrl, generatedAssets, isPreviewExpanded, matchLyricCueBlend, matchLyricMergeWindow, matchMode, matchOnsetDensity, musicVideoProject, referenceAssets, shaderAccentKinds, shaderPresetId, splitMode, storyState, tab, videoSources]);

  useEffect(() => {
    if (!draftRestored) return;

    const flushPendingAutosave = async () => {
      if (autosaveInFlightRef.current) return;
      const pending = pendingAutosaveRef.current;
      if (!pending) return;

      pendingAutosaveRef.current = null;
      autosaveInFlightRef.current = true;
      setSaveState((current) => ({ ...current, kind: "saving", scope: pending.projectId ? "project" : "local" }));
      try {
        const draft = pending.projectId
          ? await saveNamedStudioProject({
              projectId: pending.projectId,
              name: pending.projectName,
              draft: createPersistableStudioProjectDraft(pending.params),
            }).then((saved) => saved.draft)
          : await saveStudioProjectDraft(pending.params, {
              audioFile: audioFileRef.current,
              videoFilesByMediaKey: videoFilesByMediaKeyRef.current,
            });
        const savedAt = draft ? new Date(draft.savedAt).getTime() : Date.now();
        // Edits that landed while the save was in flight keep the state dirty.
        setSaveState((current) => (pendingAutosaveRef.current
          ? { ...current, kind: "dirty" }
          : { kind: "saved", at: savedAt, scope: pending.projectId ? "project" : "local", detail: null }));
      } catch (error) {
        if (!pendingAutosaveRef.current) pendingAutosaveRef.current = pending;
        console.warn("[Studio] Could not autosave local project draft", error instanceof Error ? error : String(error));
        setSaveState({
          kind: "error",
          at: null,
          scope: pending.projectId ? "project" : "local",
          detail: "Autosave failed; it retries automatically and on the next stage change.",
        });
      } finally {
        autosaveInFlightRef.current = false;
      }
    };

    const saveTimer = window.setInterval(() => {
      void flushPendingAutosave();
    }, STUDIO_AUTOSAVE_INTERVAL_MS);
    flushPendingAutosaveRef.current = flushPendingAutosave;
    return () => {
      window.clearInterval(saveTimer);
      if (flushPendingAutosaveRef.current === flushPendingAutosave) {
        flushPendingAutosaveRef.current = null;
      }
    };
  }, [draftRestored]);

  useEffect(() => {
    if (!draftRestored || !referenceAutosaveRequestedRef.current) return;
    referenceAutosaveRequestedRef.current = false;

    let saveTimer: number | null = null;
    const flushReferenceAutosave = () => {
      if (autosaveInFlightRef.current) {
        saveTimer = window.setTimeout(flushReferenceAutosave, 250);
        return;
      }
      void flushPendingAutosaveRef.current?.();
    };
    saveTimer = window.setTimeout(flushReferenceAutosave, 250);
    return () => {
      if (saveTimer !== null) window.clearTimeout(saveTimer);
    };
  }, [draftRestored, referenceAssets]);

  useEffect(() => {
    if (!draftRestored || !vocalStemAutosaveRequestedRef.current) return;
    vocalStemAutosaveRequestedRef.current = false;

    let saveTimer: number | null = null;
    const flushVocalStemAutosave = () => {
      if (autosaveInFlightRef.current) {
        saveTimer = window.setTimeout(flushVocalStemAutosave, 250);
        return;
      }
      void flushPendingAutosaveRef.current?.();
    };
    saveTimer = window.setTimeout(flushVocalStemAutosave, 250);
    return () => {
      if (saveTimer !== null) window.clearTimeout(saveTimer);
    };
  }, [draftRestored, storyState.transcriptSummary]);

  useEffect(() => {
    if (!draftRestored) return;
    if (ingestAutosaveDebounceRef.current) {
      window.clearTimeout(ingestAutosaveDebounceRef.current);
    }
    ingestAutosaveDebounceRef.current = window.setTimeout(() => {
      ingestAutosaveDebounceRef.current = null;
      setIngestAutosaveTick((current) => current + 1);
    }, 20_000);

    return () => {
      if (ingestAutosaveDebounceRef.current) {
        window.clearTimeout(ingestAutosaveDebounceRef.current);
        ingestAutosaveDebounceRef.current = null;
      }
    };
  }, [beatJoinAnalysis, draftRestored, referenceAssets, videoSources]);

  useEffect(() => {
    if (!draftRestored || ingestAutosaveTick === 0) return;

    let saveTimer: number | null = null;
    const flushIngestAutosave = () => {
      if (autosaveInFlightRef.current) {
        saveTimer = window.setTimeout(flushIngestAutosave, 250);
        return;
      }
      void flushPendingAutosaveRef.current?.();
    };
    saveTimer = window.setTimeout(flushIngestAutosave, 250);
    return () => {
      if (saveTimer !== null) window.clearTimeout(saveTimer);
    };
  }, [draftRestored, ingestAutosaveTick]);

  useEffect(() => {
    if (!draftRestored) return;

    const flushOnHide = () => {
      if (document.visibilityState !== "hidden") return;
      void flushPendingAutosaveRef.current?.();
    };

    document.addEventListener("visibilitychange", flushOnHide);
    window.addEventListener("pagehide", flushOnHide);
    return () => {
      document.removeEventListener("visibilitychange", flushOnHide);
      window.removeEventListener("pagehide", flushOnHide);
    };
  }, [draftRestored]);

  useEffect(() => {
    if (!draftRestored || !workflowCheckpointAutosaveRequestedRef.current) return;
    workflowCheckpointAutosaveRequestedRef.current = false;

    let saveTimer: number | null = null;
    const flushWorkflowCheckpoint = () => {
      if (autosaveInFlightRef.current) {
        saveTimer = window.setTimeout(flushWorkflowCheckpoint, 250);
        return;
      }
      void flushPendingAutosaveRef.current?.();
    };
    saveTimer = window.setTimeout(flushWorkflowCheckpoint, 250);
    return () => {
      if (saveTimer !== null) window.clearTimeout(saveTimer);
    };
  }, [committedBeatSplit, draftRestored, finalExportUrl]);

  useEffect(() => {
    referenceAssetsRef.current = referenceAssets;
  }, [referenceAssets]);

  useEffect(() => {
    return () => {
      revokePreparedVideoSources(videoSourcesRef.current);
      for (const asset of referenceAssetsRef.current) {
        if (asset.previewUrl.startsWith("blob:")) URL.revokeObjectURL(asset.previewUrl);
      }
    };
  }, []);

  function applyRestoredProjectDraft(draft: RuntimeStudioProjectDraft) {
    audioFileRef.current = null;
    videoFilesByMediaKeyRef.current.clear();
    setBeatJoinAnalysis(draft.analysis);
    setAudioStatus(draft.analysis ? `Restored · ${draft.analysis.sourceLabel}` : "Upload a song to unlock beat sync.");
    const restoredCaptionMode = resolveCaptionMode(draft.captionSettings?.mode);
    setVideoSources(draft.videoSources.map((source) => reconcileSourceCaptionStatus(source, restoredCaptionMode)));
    setVideoStatus(draft.videoSources.length
      ? `Restored ${draft.videoSources.length} clip${draft.videoSources.length === 1 ? "" : "s"} from durable storage.`
      : "Upload one or more video clips to begin.");
    setStoryState({
      ...createDefaultStoryTabState(),
      ...draft.storyState,
      editSettings: normalizeStoryEditSettings(draft.storyState.editSettings),
    });
    setCaptionMode(restoredCaptionMode);
    setMusicVideoProject(draft.musicVideoProject);
    setReferenceAssets(draft.referenceAssets ?? []);
    setGeneratedAssets(draft.generatedAssets ?? []);
    const workflowUi = draft.workflowUiSettings;
    if (workflowUi?.activeTab && NAV.some((item) => item.key === workflowUi.activeTab)) setTab(workflowUi.activeTab);
    if (workflowUi?.splitMode) setSplitMode(workflowUi.splitMode);
    if (workflowUi?.colorGradient) setColorGradient(workflowUi.colorGradient);
    if (workflowUi?.matchOnsetDensity !== undefined) setMatchOnsetDensity(workflowUi.matchOnsetDensity);
    if (workflowUi?.matchLyricCueBlend !== undefined) setMatchLyricCueBlend(workflowUi.matchLyricCueBlend);
    if (workflowUi?.matchLyricMergeWindow !== undefined) setMatchLyricMergeWindow(workflowUi.matchLyricMergeWindow);
    if (workflowUi?.shaderPresetId && MUSIC_VIDEO_SHADER_PRESETS.some((preset) => preset.id === workflowUi.shaderPresetId)) {
      setShaderPresetId(workflowUi.shaderPresetId as (typeof MUSIC_VIDEO_SHADER_PRESETS)[number]["id"]);
    }
    setShaderAccentKinds(workflowUi?.shaderAccentKinds ?? {});
    if (workflowUi?.isPreviewExpanded !== undefined) setIsPreviewExpanded(workflowUi.isPreviewExpanded);
    setCommittedBeatSplit(workflowUi?.committedSplit ?? null);
    const restoredFinalExport = workflowUi?.finalExport;
    setFinalExportUrl(restoredFinalExport?.videoUrl ?? null);
    setFinalExportName(restoredFinalExport?.downloadFileName ?? null);
    setFinalExportCueCount(restoredFinalExport?.cueCount ?? 0);
    setFinalExportStatus(restoredFinalExport?.status ?? "Final export waits for a generated story preview and master audio.");
    setDone(Boolean(restoredFinalExport));
  }

  function handleProjectSelected(project: StudioProjectSummary, draft: RuntimeStudioProjectDraft) {
    applyRestoredProjectDraft(draft);
    setActiveProjectId(project.id);
    setActiveProjectName(project.name);
    skipNextDirtyMarkRef.current = true;
    setSaveState({ kind: "restored", at: Date.now(), scope: "project", detail: `Loaded ${project.name} from RustFS.` });
  }

  function handleProjectSaved(project: StudioProjectSummary) {
    setActiveProjectId(project.id);
    setActiveProjectName(project.name);
    skipNextDirtyMarkRef.current = true;
    setSaveState({ kind: "saved", at: Date.now(), scope: "project", detail: `Saved ${project.name} to RustFS.` });
  }

  async function handleNewProject() {
    const confirmed = window.confirm(
      "Start a new project? This clears the current working draft. Named projects already saved to your Project Library will be kept.",
    );
    if (!confirmed) return false;

    const emptyDraft = createPersistableStudioProjectDraft({
      analysis: null,
      videoSources: [],
      storyState: createDefaultStoryTabState(),
      musicVideoProject: null,
      referenceAssets: [],
      generatedAssets: [],
      workflowUiSettings: { activeTab: "review" },
    });

    await saveServerStudioProjectDraft(emptyDraft);
    clearStudioProjectDraft();
    window.localStorage.removeItem(ACTIVE_STUDIO_PROJECT_KEY);
    window.localStorage.setItem("svs.studio.activeTab", "review");
    window.location.reload();
    return true;
  }

  const sourceClips = useMemo(() => buildSourceClipSpans(videoSources), [videoSources]);
  const splitSegments = useMemo(
    () =>
      buildUnifiedSplitSegments({
        sources: videoSources,
        sourceClips,
        analysis: beatJoinAnalysis,
        mode: splitMode,
        targetEvents: Math.max(1, Math.round(clipDur / 2)),
        density: sensitivity / 100,
      }),
    [beatJoinAnalysis, clipDur, sensitivity, sourceClips, splitMode, videoSources],
  );
  const beatSplitSegments = useMemo(() => {
    if (beatJoinAnalysis) {
      return buildAudioDrivenSegments({
        sourceClips,
        analysis: beatJoinAnalysis,
        mode: beatSplitMode,
        targetEvents: barsPerSeg,
        density: sensitivity / 100,
      });
    }

    return buildBeatSegments(sourceClips, bpm, barsPerSeg);
  }, [sourceClips, beatJoinAnalysis, beatSplitMode, barsPerSeg, sensitivity, bpm]);
  const splitSignature = useMemo(
    () =>
      JSON.stringify({
        mode: splitMode,
        targetEvents: Math.max(1, Math.round(clipDur / 2)),
        density: Math.round(sensitivity),
        sourceCount: sourceClips.length,
        sourceDuration: sourceClips[sourceClips.length - 1]?.end ?? 0,
        audioSource: beatJoinAnalysis?.sourceLabel ?? null,
        storyContentSignature: storyState.storyContentSignature,
        story: storyState.storyBeats.map((beat) => [beat.id, beat.label, beat.start, beat.end, beat.prompt]),
        storyPace: normalizeStoryEditSettings(storyState.editSettings).cutDensity,
      }),
    [beatJoinAnalysis?.sourceLabel, clipDur, sensitivity, sourceClips, splitMode, storyState.editSettings, storyState.storyBeats, storyState.storyContentSignature],
  );
  const beatSplitSignature = useMemo(
    () =>
      JSON.stringify({
        mode: beatSplitMode,
        targetEvents: barsPerSeg,
        density: Math.round(sensitivity),
        sourceCount: sourceClips.length,
        sourceDuration: sourceClips[sourceClips.length - 1]?.end ?? 0,
        audioSource: beatJoinAnalysis?.sourceLabel ?? null,
      }),
    [beatJoinAnalysis?.sourceLabel, barsPerSeg, beatSplitMode, sensitivity, sourceClips],
  );
  const isCommittedSplitCurrent = committedBeatSplit?.kind === "workflow" && committedBeatSplit.signature === splitSignature;
  const isCommittedBeatSplitCurrent = committedBeatSplit?.kind === "legacy" && committedBeatSplit.signature === beatSplitSignature;
  const isAnyCommittedSplitCurrent = isCommittedSplitCurrent || isCommittedBeatSplitCurrent;
  const workingBeatSplitSegments = isAnyCommittedSplitCurrent ? committedBeatSplit!.segments : beatSplitSegments;
  const beatSplitClipCount = workingBeatSplitSegments.length;
  const joinClips = useMemo(
    () =>
      Array.from({ length: beatSplitClipCount }, (_, index) => ({
        id: index,
        on: joinClipStates[index] ?? true,
      })),
    [beatSplitClipCount, joinClipStates]
  );
  const splitActiveClip = Math.min(activeClip, Math.max(0, splitSegments.length - 1));
  const beatActiveClip = Math.min(activeClip, Math.max(0, beatSplitClipCount - 1));
  const segmentPreviews = useMemo<SegmentPreview[]>(
    () =>
      workingBeatSplitSegments.map((segment, index) => {
        const source = videoSources.find((candidate) => candidate.id === (segment.sourceClipIds[0] ?? -1));
        const scene = resolveSceneForTimelineSegment(videoSources, sourceClips, segment);
        return {
          clipId: index,
          label: `SEG_${String(index + 1).padStart(2, "0")}`,
          duration: segment.duration,
          thumbnailUrl: segment.thumbnailUrl ?? scene?.thumbnailUrl ?? source?.thumbnailUrl,
          sourceClipIds: segment.sourceClipIds,
          sourceRefLabel: segment.sceneLabel
            ? `${formatSourceRefs(segment.sourceClipIds)} · ${segment.sceneLabel}`
            : scene
              ? `${formatSourceRefs(segment.sourceClipIds)} · ${scene.label}`
              : formatSourceRefs(segment.sourceClipIds),
          timeLabel: `${segment.start.toFixed(1)}–${segment.end.toFixed(1)}`,
          sourceStart: Math.max(0, segment.start - getSourceClipTimeOffset(sourceClips, segment.sourceClipIds[0] ?? -1)),
          sourceEnd: Math.max(0, segment.end - getSourceClipTimeOffset(sourceClips, segment.sourceClipIds[0] ?? -1)),
        };
      }),
    [videoSources, sourceClips, workingBeatSplitSegments]
  );

  const storyPreviewSegments = useMemo<EditPlanPreviewSegment[]>(() => {
    if (!storyState.storyGenerated) return [];
    const resolved = buildEditPlanPreviewSegments({
      project: musicVideoProject,
      videoSources,
      editSettings: storyState.editSettings,
    });
    return applyApprovedGeneratedAssets(resolved, generatedAssets);
  }, [generatedAssets, musicVideoProject, storyState.editSettings, storyState.storyGenerated, videoSources]);

  const auditionGeneratedAsset = (asset: GeneratedStudioAsset, contextRadius: number) => {
    const preview = buildGeneratedAssetContextPreview(storyPreviewSegments, asset, contextRadius);
    if (!preview) return;
    setGeneratePreviewRange({ startIndex: preview.startIndex, endIndex: preview.endIndex });
    setGeneratedAuditionSegments(preview.segments);
    setPreviewAuditionRequest((request) => request + 1);
  };

  async function ingestVideoFiles(files: File[], mode: "replace" | "append") {
    const videoFiles = files.filter((file) => file.type.startsWith("video/"));
    setVideoError(null);
    setIsPreparingVideos(true);
    setVideoStatus(
      `${mode === "append" ? "Adding" : "Processing"} ${files.length} video clip${files.length === 1 ? "" : "s"}...`,
    );

    try {
      const mergePreparedSourceUpdate = ({ key, source }: { key: string; source: UploadedVideoSource }) => {
        startTransition(() => {
          setVideoSources((currentSources) => {
            const sourceIndex = currentSources.findIndex((currentSource) => buildVideoSourceKey(currentSource) === key);
            if (sourceIndex < 0) return currentSources;

            const nextSources = currentSources.map((currentSource, index) => {
              if (index !== sourceIndex) return currentSource;
              return withVideoSourceId(
                mergeUploadedVideoSourceUpdate(currentSource, source),
                currentSource.id,
              );
            });
            setVideoStatus(formatVideoStatus(mode, nextSources.length, 0, nextSources));
            return nextSources;
          });
        });
      };

      const prepared = await prepareVideoSources(
        files,
        mergePreparedSourceUpdate,
        mergePreparedSourceUpdate,
        buildSceneCaptionSettings(captionMode, beatJoinAnalysis, storyState, referenceAssets),
      );
      if (!prepared.length) {
        throw new Error("No readable video files were selected.");
      }
      const preparedPairs = prepared.map((source, index) => ({ source, file: videoFiles[index] }));

      startTransition(() => {
        setVideoSources((currentSources) => {
          const existingKeys = new Set(currentSources.map(buildVideoSourceKey));
          const uniquePreparedPairs = mode === "append"
            ? preparedPairs.filter(({ source }) => !existingKeys.has(buildVideoSourceKey(source)))
            : preparedPairs;
          const skippedPrepared = mode === "append"
            ? preparedPairs.filter(({ source }) => existingKeys.has(buildVideoSourceKey(source))).map(({ source }) => source)
            : [];

          if (skippedPrepared.length) {
            revokePreparedVideoSources(skippedPrepared);
          }

          const uniquePrepared = uniquePreparedPairs.map(({ source }) => source);
          const nextSources = mode === "append"
            ? [...currentSources, ...assignVideoSourceIds(uniquePrepared, getNextVideoSourceId(currentSources))]
            : assignVideoSourceIds(uniquePrepared, 0);

          const nextVideoFiles = mode === "append" ? new Map(videoFilesByMediaKeyRef.current) : new Map<string, Blob>();
          for (const nextSource of nextSources) {
            const pair = uniquePreparedPairs.find(({ source }) => buildVideoSourceKey(source) === buildVideoSourceKey(nextSource));
            if (pair?.file) {
              nextVideoFiles.set(buildVideoMediaKey(nextSource), pair.file);
            }
          }
          videoFilesByMediaKeyRef.current = nextVideoFiles;

          if (mode === "replace") {
            revokePreparedVideoSources(currentSources);
            setCommittedBeatSplit(null);
            setJoinClipStates({});
            setActiveClip(0);
          } else {
            setCommittedBeatSplit(null);
            setActiveClip((currentActiveClip) => currentActiveClip);
          }

          setVideoStatus(
            formatVideoStatus(mode, uniquePrepared.length, skippedPrepared.length, nextSources),
          );

          return nextSources;
        });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown video processing error";
      setVideoError(message);
      setVideoStatus("Upload one or more video clips to begin.");
    } finally {
      setIsPreparingVideos(false);
    }
  }

  async function handleVideoUpload(files: File[]) {
    await ingestVideoFiles(files, "replace");
  }

  async function handleAppendVideos(files: File[]) {
    await ingestVideoFiles(files, "append");
  }

  function handleRemoveVideo(sourceId: number) {
    setVideoSources((currentSources) => {
      const sourceToRemove = currentSources.find((source) => source.id === sourceId);
      if (!sourceToRemove) return currentSources;

      revokePreparedVideoSources([sourceToRemove]);
      videoFilesByMediaKeyRef.current.delete(buildVideoMediaKey(sourceToRemove));
      const nextSources = removeVideoSourceById(currentSources, sourceId);

      setCommittedBeatSplit(null);
      setJoinClipStates({});
      setActiveClip(0);
      setVideoStatus(
        nextSources.length
          ? `Removed 1 clip · ${nextSources.length} total ready.`
          : "Upload one or more video clips to begin.",
      );

      return nextSources;
    });
  }

  function handleMergeSceneIntoPrevious(sourceId: number, sceneId: number) {
    setVideoSources((currentSources) =>
      currentSources.map((source) => {
        if (source.id !== sourceId || !source.scenes?.length) return source;
        const nextScenes = mergeSceneIntoPrevious(source.scenes, sceneId);
        if (nextScenes === source.scenes) return source;
        return { ...source, scenes: nextScenes };
      }),
    );
  }

  async function handleRerunSceneAnalysis(scope: "failed" | "all") {
    if (isRerunningSceneAnalysis || isPreparingVideos) return;

    const targets = videoSources.filter((source) => {
      if (!source.storageBucket || !source.storagePath) return false;
      if (source.sceneStatus === "detecting") return false;
      if (scope === "all") return true;
      return needsSceneDetectionRetry(source);
    });
    if (!targets.length) return;

    setIsRerunningSceneAnalysis(true);
    setVideoError(null);
    setVideoStatus(
      `${scope === "all" ? "Re-running scene analysis + captions" : "Re-running failed scene detection"} on ${targets.length} clip${targets.length === 1 ? "" : "s"}...`,
    );

    const applySceneUpdate = ({ key, source }: VideoSceneUpdate) => {
      startTransition(() => {
        setVideoSources((currentSources) =>
          currentSources.map((currentSource) => {
            if (buildVideoSourceKey(currentSource) !== key) return currentSource;
            // Replace instead of merge: rerun updates carry the full source state
            // and must be able to clear stale sceneError/captionError values.
            return withVideoSourceId(
              { ...source, videoUrl: currentSource.videoUrl, thumbnailUrl: currentSource.thumbnailUrl },
              currentSource.id,
            );
          }),
        );
      });
    };

    try {
      // Throttle: captions funnel through one GPU-locked gateway behind a
      // proxy timeout; hitting it with every clip at once turns queued
      // requests into proxy-timeout errors instead of throughput. Scenes
      // that miss (timeout / gateway error) keep their previous caption and
      // are retried in follow-up rounds once the pass finishes.
      const captionSettings = buildSceneCaptionSettings(captionMode, beatJoinAnalysis, storyState, referenceAssets);
      const maxRounds = 3;
      let pending = targets;

      for (let round = 1; round <= maxRounds && pending.length; round += 1) {
        if (round > 1) {
          setVideoStatus(`Retrying ${pending.length} clip${pending.length === 1 ? "" : "s"} with missed captions (round ${round}/${maxRounds})...`);
          await new Promise((resolve) => setTimeout(resolve, 5_000 * (round - 1)));
        }

        const queue = [...pending];
        await Promise.all(
          Array.from({ length: Math.min(1, queue.length) }, async () => {
            for (let source = queue.shift(); source; source = queue.shift()) {
              await rerunSourceSceneAnalysis(source, captionSettings, applySceneUpdate).catch(() => undefined);
            }
          }),
        );

        const targetKeys = new Set(pending.map(buildVideoSourceKey));
        pending = scope === "all"
          ? selectSceneRetrySources(videoSourcesRef.current, captionMode).filter((source) => targetKeys.has(buildVideoSourceKey(source)))
          : videoSourcesRef.current.filter((source) => targetKeys.has(buildVideoSourceKey(source)) && (source.sceneStatus === "failed" || !(source.scenes?.length)));
      }

      setVideoStatus(
        pending.length
          ? `Scene analysis rerun finished · ${pending.length} clip${pending.length === 1 ? "" : "s"} still ha${pending.length === 1 ? "s" : "ve"} missed captions — run it again.`
          : `Scene analysis rerun finished for ${targets.length} clip${targets.length === 1 ? "" : "s"}.`,
      );
    } finally {
      setIsRerunningSceneAnalysis(false);
    }
  }

  async function handleReferenceAssetUpload(role: ReferenceAssetLibraryRole, files: File[]) {
    const imageFiles = files.filter((candidate) => candidate.type.startsWith("image/"));
    const selectedFiles = role === "crowd" ? imageFiles : imageFiles.slice(0, 1);
    if (!selectedFiles.length) return;

    const localAssets = selectedFiles.map((file) => {
      const previewUrl = URL.createObjectURL(file);
      return { file, previewUrl, asset: createLocalReferenceAsset({ role, file, previewUrl }) };
    });

    setReferenceAssets((currentAssets) => {
      if (role !== "crowd") {
        for (const current of currentAssets.filter((asset) => asset.role === role && asset.previewUrl.startsWith("blob:"))) {
          URL.revokeObjectURL(current.previewUrl);
        }
      }
      const retainedAssets = role === "crowd" ? currentAssets : currentAssets.filter((asset) => asset.role !== role);
      return [...retainedAssets, ...localAssets.map(({ asset }) => asset)];
    });

    await Promise.all(localAssets.map(async ({ file, previewUrl, asset: localAsset }) => {
      try {
        const storage = await uploadReferenceAssetToRustFs(file, role);
        referenceAutosaveRequestedRef.current = true;
        setReferenceAssets((currentAssets) => currentAssets.map((asset) => asset.id === localAsset.id ? { ...asset, ...storage, previewUrl: storage.storageUrl ?? asset.previewUrl } : asset));
        if (previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Reference upload failed";
        setReferenceAssets((currentAssets) => currentAssets.map((asset) => asset.id === localAsset.id ? { ...asset, storageStatus: "failed", storageError: message } : asset));
      }
    }));
  }

  function handleReferenceAssetUpdate(assetId: string, patch: Partial<Pick<ReferenceAsset, "displayName" | "promptHint" | "kind">>) {
    setReferenceAssets((currentAssets) => currentAssets.map((asset) => asset.id === assetId ? { ...asset, ...patch } : asset));
  }

  function handleReferenceAssetRemove(assetId: string) {
    setReferenceAssets((currentAssets) => {
      const asset = currentAssets.find((candidate) => candidate.id === assetId);
      if (asset?.previewUrl.startsWith("blob:")) URL.revokeObjectURL(asset.previewUrl);
      return currentAssets.filter((candidate) => candidate.id !== assetId);
    });
  }

  function handleVocalStemTranscriptStart(fileName: string) {
    setStoryState((current) => ({
      ...current,
      vocalStemName: fileName,
      transcriptSummary: null,
      storyGenerated: false,
      confirmedTreatmentId: null,
      confirmedTreatmentSnapshot: null,
      storyContentSignature: null,
    }));
  }

  function handleVocalStemTranscriptComplete(summary: DeepgramTranscriptSummary, fileName: string) {
    vocalStemAutosaveRequestedRef.current = true;
    setStoryState((current) => ({
      ...current,
      vocalStemName: fileName,
      transcriptSummary: summary,
      storyGenerated: false,
      confirmedTreatmentId: null,
      confirmedTreatmentSnapshot: null,
      storyContentSignature: null,
    }));
  }

  function handleVocalStemTranscriptFailed(_message: string) {
    setStoryState((current) => ({
      ...current,
      transcriptSummary: null,
    }));
  }

  async function handleAudioUpload(files: File[]) {
    const file = files[0];
    if (!file) return;

    const previousAudioUrl = beatJoinAnalysis?.audioUrl;
    const nextAudioUrl = URL.createObjectURL(file);

    setAudioError(null);
    setIsPreparingAudio(true);
    setAudioProgress(8);
    setAudioStatus(`Analyzing ${file.name}...`);

    let progressTimer: ReturnType<typeof setInterval> | null = setInterval(() => {
      setAudioProgress((current) => {
        if (current >= 88) return current;
        const nextStep = current + (current < 36 ? 8 : current < 64 ? 5 : 3);
        return Math.min(88, nextStep);
      });
    }, 280);

    try {
      const { waveform, duration } = await extractWaveformData(file);
      const response = await fetchEssentiaAnalysis(file);
      const parsed = parseEssentiaPayload({
        payload: response,
        fileName: file.name,
        waveform,
        waveformDuration: duration,
        audioUrl: nextAudioUrl,
      });

      if (!parsed) {
        throw new Error("Essentia returned no usable beats/onsets/sections.");
      }

      const storage = getEssentiaStorageFromPayload(response);
      const parsedWithStorage: BeatJoinAnalysis = storage
        ? { ...parsed, ...storage, audioUrl: storage.storageUrl }
        : { ...parsed, storageProvider: "local", storageStatus: "failed", storageError: "Essentia completed without durable source storage." };

      audioFileRef.current = file;

      startTransition(() => {
        setBeatJoinAnalysis(parsedWithStorage);
        setCommittedBeatSplit(null);
        setAudioProgress(100);
        setAudioStatus(`Ready · ${parsedWithStorage.sourceLabel}${parsedWithStorage.storageStatus === "uploaded" ? " · RustFS" : ""}`);
        setAudioError(null);
      });

      if (previousAudioUrl) {
        URL.revokeObjectURL(previousAudioUrl);
      }
    } catch (error) {
      URL.revokeObjectURL(nextAudioUrl);
      const message = error instanceof Error ? error.message : "Unknown analysis error";
      setAudioError(`Essentia has errored: ${message}`);
      setAudioProgress(0);
      setAudioStatus(beatJoinAnalysis ? `Ready · ${beatJoinAnalysis.sourceLabel}` : "Upload a song to unlock beat sync.");
      if (!beatJoinAnalysis) {
        setBeatJoinAnalysis(null);
      }
    } finally {
      if (progressTimer) {
        clearInterval(progressTimer);
        progressTimer = null;
      }
      setIsPreparingAudio(false);
    }
  }

  async function runProcess() {
    if (isRunning || previewState.activeRequestKey) return;

    if ((tab === "story" || tab === "compose" || tab === "shuffle" || tab === "generate" || tab === "join") && browserPreviewSegments.length > 0) {
      runBrowserPreview();
      return;
    }

    const requestKey = `preview-${Date.now()}`;
    const { startTime, endTime } = derivePreviewWindow({
      tab,
      splitSegments,
      beatSplitSegments,
      splitActiveClip,
      beatActiveClip,
      rampDur,
    });

    setIsRunning(true);
    setDone(false);
    setProgress(5);
    setPreviewState((current) =>
      startSectionRecompute(current, {
        requestKey,
        sectionId: `${tab}:${tab === "split" ? splitActiveClip : beatActiveClip}`,
        continuityMode: shuffleMode,
        paramsHash: JSON.stringify({ tab, splitActiveClip, beatActiveClip, shuffleMode, startTime, endTime }),
        startedAt: new Date().toISOString(),
        progress: 5,
      }),
    );
    setPreviewState((current) => markSectionRecomputeRunning(current, requestKey));

    try {
      const response = await fetch("/api/preview/section", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestKey, startTime, endTime }),
      });
      const payload = (await response.json()) as {
        success?: boolean;
        error?: string;
        runId?: string;
      };

      if (!response.ok || !payload.success || !payload.runId) {
        throw new Error(payload.error ?? "Preview generation failed.");
      }

      const output = await waitForTriggerRunOutput(payload.runId, { timeoutMs: 10 * 60 * 1_000, pollIntervalMs: 2_000 }) as {
        requestKey: string;
        assetKey: string;
        duration: number;
        generatedAt: string;
        videoUrl?: string;
      };
      const asset = {
        requestKey: output.requestKey,
        assetKey: output.assetKey,
        duration: output.duration,
        generatedAt: output.generatedAt,
        videoUrl: output.videoUrl,
      };

      setProgress(90);
      setPreviewState((current) => updateSectionRecomputeProgress(current, { requestKey, progress: 90 }));
      setPreviewState((current) => markSectionReady(current, asset));
      setPreviewState((current) => swapReadySection(current, requestKey));
      setProgress(100);
      setDone(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown preview generation error";
      setPreviewState((current) => failSectionRecompute(current, { requestKey, message }));
      setVideoError(message);
    } finally {
      setIsRunning(false);
    }
  }

  async function ensureOwnedMasterAudioForGeneration(): Promise<SeedanceMasterAudioRef> {
    if (!beatJoinAnalysis?.storageBucket || !beatJoinAnalysis.storagePath) {
      throw new Error("The restored project has no durable master audio to re-register.");
    }

    let audioFile: File;
    try {
      audioFile = await resolveMasterAudioFile(beatJoinAnalysis, audioFileRef.current);
    } catch {
      audioFile = await fetchStoredMediaAsFile(
        beatJoinAnalysis.storageBucket,
        beatJoinAnalysis.storagePath,
        beatJoinAnalysis.sourceLabel || "master-audio.wav",
        "audio/wav",
      );
    }

    const scopedAudio = await reuploadThroughScopedPath(audioFile, "media-uploads/source-audio");
    const migratedAnalysis = {
      ...beatJoinAnalysis,
      storageProvider: "rustfs" as const,
      storageBucket: scopedAudio.bucket,
      storagePath: scopedAudio.objectKey,
      storageStatus: "uploaded" as const,
      storageError: undefined,
    };
    setBeatJoinAnalysis(migratedAnalysis);
    audioFileRef.current = audioFile;
    await saveStudioProjectDraft(
      {
        analysis: migratedAnalysis,
        videoSources,
        storyState,
        musicVideoProject,
        referenceAssets,
        generatedAssets,
        captionSettings: buildSceneCaptionSettings(captionMode, migratedAnalysis, storyState, referenceAssets),
        workflowUiSettings: {
          activeTab: tab,
          splitMode,
          matchMode,
          matchOnsetDensity,
          matchLyricCueBlend,
          matchLyricMergeWindow,
          colorGradient,
          shaderPresetId,
          shaderAccentKinds,
          isPreviewExpanded,
          committedSplit: committedBeatSplit ?? undefined,
        },
      },
      { audioFile },
    );

    return {
      bucket: scopedAudio.bucket,
      objectKey: scopedAudio.objectKey,
      fileName: beatJoinAnalysis.sourceLabel || audioFile.name || "master-audio.wav",
      mimeType: audioFile.type || "audio/wav",
      duration: beatJoinAnalysis.duration,
    };
  }

  async function runFinalExport() {
    if (isFinalExporting || isShaderCaptureExporting || previewState.activeRequestKey) return;
    if (!beatJoinAnalysis) {
      setFinalExportError("Upload and analyze the master song before final export.");
      return;
    }
    if (!storyState.storyGenerated || storyPreviewSegments.length === 0 || !musicVideoProject) {
      setFinalExportError("Generate the Story layout and preview segments before final export.");
      return;
    }

    const requestKey = `final-export-${Date.now()}`;
    setIsFinalExporting(true);
    setDone(false);
    setProgress(5);
    setFinalExportError(null);
    setFinalExportStatus("Collecting master audio, source clips, beats, lyrics, and shader cues...");
    setPreviewState((current) =>
      startSectionRecompute(current, {
        requestKey,
        sectionId: "story:final-export",
        continuityMode: shuffleMode,
        paramsHash: `final-export:${shaderPresetId}:${storyPreviewSegments.length}`,
        startedAt: new Date().toISOString(),
        progress: 5,
      }),
    );
    setPreviewState((current) => markSectionRecomputeRunning(current, requestKey));

    try {
      // The export route authorizes durable refs against the caller's saved
      // studio draft, so flush a fresh save covering exactly this media.
      await saveStudioProjectDraft(
        {
          analysis: beatJoinAnalysis,
          videoSources,
          storyState,
          musicVideoProject,
          referenceAssets,
          generatedAssets,
          captionSettings: buildSceneCaptionSettings(captionMode, beatJoinAnalysis, storyState, referenceAssets),
          workflowUiSettings: {
            activeTab: tab,
            splitMode,
            matchMode,
            matchOnsetDensity,
            matchLyricCueBlend,
            matchLyricMergeWindow,
            colorGradient,
            shaderPresetId,
            shaderAccentKinds,
            isPreviewExpanded,
            committedSplit: committedBeatSplit ?? undefined,
          },
        },
        {
          audioFile: audioFileRef.current,
          videoFilesByMediaKey: videoFilesByMediaKeyRef.current,
        },
      );

      const uniqueVideoUrls = [...new Set(storyPreviewSegments.map((segment) => segment.videoUrl))];
      const videoUrlIndex = new Map(uniqueVideoUrls.map((url, index) => [url, index]));

      // Durable refs keep large media out of the serverless body cap (ef03ffe contract).
      const audioRef = beatJoinAnalysis.storageBucket && beatJoinAnalysis.storagePath
        ? { bucket: beatJoinAnalysis.storageBucket, objectKey: beatJoinAnalysis.storagePath }
        : null;
      const videoRefs: Array<{ bucket: string; objectKey: string }> = [];
      let missingVideoRef = false;
      for (const url of uniqueVideoUrls) {
        const source = videoSourcesRef.current.find((item) => item.videoUrl === url);
        const generated = generatedAssets.find((asset) => buildGeneratedAssetPlaybackUrl(asset) === url);
        const generatedObjectKey = generated?.fullStorage?.objectKey ?? generated?.fullStorage?.storagePath;
        if (source?.storageBucket && source?.storagePath) {
          videoRefs.push({ bucket: source.storageBucket, objectKey: source.storagePath });
        } else if (generated?.fullStorage?.bucket && generatedObjectKey) {
          videoRefs.push({ bucket: generated.fullStorage.bucket, objectKey: generatedObjectKey });
        } else {
          missingVideoRef = true;
          break;
        }
      }

      setProgress(20);
      setPreviewState((current) => updateSectionRecomputeProgress(current, { requestKey, progress: 20 }));

      const timelineItemsBySectionId = new Map(musicVideoProject.editPlan.timelineItems.map((item) => [item.sectionId, item]));
      const segments = storyPreviewSegments.map((segment) => {
        const item = timelineItemsBySectionId.get(segment.sectionId);
        return {
          sourceIndex: videoUrlIndex.get(segment.videoUrl) ?? 0,
          startTime: segment.startTime,
          endTime: segment.endTime,
          musicStart: segment.musicStart,
          musicEnd: segment.musicEnd,
          label: item?.label ?? segment.label,
        };
      });

      const buildBaseForm = () => {
        const form = new FormData();
        form.set("segments", JSON.stringify(segments));
        form.set("beats", JSON.stringify(beatJoinAnalysis.beats));
        form.set("lyricChunks", JSON.stringify(musicVideoProject.lyricChunks));
        form.set("shaderCues", JSON.stringify(shaderEffectCues));
        if (Object.keys(shaderAccentKinds).length > 0) {
          form.set("accentKinds", JSON.stringify(shaderAccentKinds));
        }
        form.set("shaderPresetId", shaderPresetId);
        form.set("requestKey", requestKey);
        return form;
      };
      const attachDurableRefs = (
        form: FormData,
        audioRef: { bucket: string; objectKey: string },
        videoRefs: Array<{ bucket: string; objectKey: string }>,
      ) => {
        form.set("audioRef", JSON.stringify(audioRef));
        form.set("videoRefs", JSON.stringify(videoRefs));
      };

      setProgress(45);
      setFinalExportStatus(`Rendering MP4 with ${MUSIC_VIDEO_SHADER_PRESETS.find((preset) => preset.id === shaderPresetId)?.label ?? shaderPresetId} shader cues...`);
      setPreviewState((current) => updateSectionRecomputeProgress(current, { requestKey, progress: 45 }));

      type ExportDispatchOutcome = {
        response: Response;
        payload: { success?: boolean; error?: string; runId?: string };
      };
      const sendExportForm = async (form: FormData): Promise<ExportDispatchOutcome> => {
        const response = await fetch("/api/export/final", { method: "POST", body: form });
        const rawBody = await response.text();
        let payload: { success?: boolean; error?: string; runId?: string };
        try {
          payload = JSON.parse(rawBody) as { success?: boolean; error?: string; runId?: string };
        } catch {
          throw new Error(response.ok ? "Final export returned an invalid response." : `Final export failed (${response.status}).`);
        }
        return { response, payload };
      };

      let outcome: ExportDispatchOutcome | null = null;
      if (audioRef && !missingVideoRef && videoRefs.length > 0) {
        const form = buildBaseForm();
        attachDurableRefs(form, audioRef, videoRefs);
        outcome = await sendExportForm(form);

        // Possession-based migration: pre-scoping keys are re-uploaded through
        // the owner-scoped storage path, then the export retries once.
        if (outcome.response.status === 403 && /not registered to this account/i.test(outcome.payload.error ?? "")) {
          setFinalExportStatus("Re-registering project media under your account before rendering...");
          const resolveMigratableAudio = async (): Promise<File> => {
            try {
              return await resolveMasterAudioFile(beatJoinAnalysis, audioFileRef.current);
            } catch {
              // Reloaded legacy sessions may hold only the durable audio ref;
              // recover a fresh download URL through the authenticated route.
              if (!beatJoinAnalysis.storageBucket || !beatJoinAnalysis.storagePath) {
                throw new Error("Master audio could not be recovered for migration; re-upload the song.");
              }
              return fetchStoredMediaAsFile(
                beatJoinAnalysis.storageBucket,
                beatJoinAnalysis.storagePath,
                `${beatJoinAnalysis.sourceLabel || "master-audio"}.wav`,
                "audio/wav",
              );
            }
          };
          const audioFile = await resolveMigratableAudio();
          const scopedAudio = await reuploadThroughScopedPath(audioFile, "media-uploads/source-audio");
          const scopedVideoRefs: Array<{ bucket: string; objectKey: string }> = [];
          for (const [index, url] of uniqueVideoUrls.entries()) {
            const bytes = await fetchMediaUrlAsFile(url, `migrate${index}.mp4`, "video/mp4");
            scopedVideoRefs.push(await reuploadThroughScopedPath(bytes, "media-uploads/video-source"));
          }
          setBeatJoinAnalysis((current) => (current ? { ...current, storageBucket: scopedAudio.bucket, storagePath: scopedAudio.objectKey } : current));
          setVideoSources((current) => current.map((source) => {
            const index = uniqueVideoUrls.indexOf(source.videoUrl);
            const scoped = index >= 0 ? scopedVideoRefs[index] : undefined;
            return scoped ? { ...source, storageBucket: scoped.bucket, storagePath: scoped.objectKey } : source;
          }));

          // Persist the migrated references immediately so a reload before the
          // next autosave cannot resurrect the unscoped keys.
          const migratedAnalysis = { ...beatJoinAnalysis, storageBucket: scopedAudio.bucket, storagePath: scopedAudio.objectKey };
          const migratedSources = videoSources.map((source) => {
            const index = uniqueVideoUrls.indexOf(source.videoUrl);
            const scoped = index >= 0 ? scopedVideoRefs[index] : undefined;
            return scoped ? { ...source, storageBucket: scoped.bucket, storagePath: scoped.objectKey } : source;
          });
          await saveStudioProjectDraft(
            {
              analysis: migratedAnalysis,
              videoSources: migratedSources,
              storyState,
              musicVideoProject,
              referenceAssets,
              generatedAssets,
              captionSettings: buildSceneCaptionSettings(captionMode, beatJoinAnalysis, storyState, referenceAssets),
              workflowUiSettings: {
                activeTab: tab,
                splitMode,
                matchMode,
                matchOnsetDensity,
                matchLyricCueBlend,
                matchLyricMergeWindow,
                colorGradient,
                shaderPresetId,
                shaderAccentKinds,
                isPreviewExpanded,
                committedSplit: committedBeatSplit ?? undefined,
              },
            },
            {
              audioFile: audioFileRef.current,
              videoFilesByMediaKey: videoFilesByMediaKeyRef.current,
            },
          );

          const retryForm = buildBaseForm();
          attachDurableRefs(retryForm, scopedAudio, scopedVideoRefs);
          outcome = await sendExportForm(retryForm);
        }
      } else {
        const form = buildBaseForm();
        // Byte-upload fallback for sessions without durable storage refs.
        const audioFile = await resolveMasterAudioFile(beatJoinAnalysis, audioFileRef.current);
        const sourceFiles = await Promise.all(uniqueVideoUrls.map((url, index) => fetchMediaUrlAsFile(url, `source${index}.mp4`, "video/mp4")));
        form.set("audio", audioFile);
        sourceFiles.forEach((file, index) => form.set(`file:${index}`, file));
        outcome = await sendExportForm(form);
      }
      const { response, payload } = outcome;

      if (!response.ok || !payload.success || !payload.runId) {
        throw new Error(payload.error ?? "Final export failed.");
      }
      setFinalExportStatus("Final export queued through Trigger.dev; waiting for the media worker...");
      const asset = await waitForTriggerRunOutput(payload.runId, { timeoutMs: 30 * 60 * 1_000, pollIntervalMs: 3_000 }) as {
        requestKey: string;
        assetKey: string;
        duration: number;
        generatedAt: string;
        videoUrl?: string;
        downloadFileName?: string;
        effectCues?: unknown[];
      };

      setProgress(90);
      setPreviewState((current) => updateSectionRecomputeProgress(current, { requestKey, progress: 90 }));
      setPreviewState((current) => markSectionReady(current, asset));
      setPreviewState((current) => swapReadySection(current, requestKey));
      setFinalExportUrl(asset.videoUrl ?? null);
      setFinalExportName(asset.downloadFileName ?? "stack-structure-final.mp4");
      setFinalExportCueCount(asset.effectCues?.length ?? 0);
      setFinalExportStatus(`Final MP4 ready · ${(asset.duration || 0).toFixed(1)}s · ${asset.effectCues?.length ?? 0} synced shader cues.`);
      workflowCheckpointAutosaveRequestedRef.current = true;
      setProgress(100);
      setDone(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown final export error.";
      setFinalExportError(message);
      setFinalExportStatus("Final export failed.");
      setPreviewState((current) => failSectionRecompute(current, { requestKey, message }));
    } finally {
      setIsFinalExporting(false);
    }
  }

  async function runWebGpuShaderCaptureExport() {
    if (isFinalExporting || isShaderCaptureExporting || previewState.activeRequestKey) return;
    if (!beatJoinAnalysis) {
      setFinalExportError("Upload and analyze the master song before WebGPU export.");
      return;
    }
    if (!storyState.storyGenerated || storyPreviewSegments.length === 0 || !musicVideoProject) {
      setFinalExportError("Generate the Story layout and preview segments before WebGPU export.");
      return;
    }

    const canvas = document.querySelector<HTMLCanvasElement>("[data-stutter-shader-preview]");
    if (!canvas || typeof canvas.captureStream !== "function") {
      setFinalExportError("Open the instant preview in a browser that supports canvas capture before WebGPU export.");
      return;
    }

    const requestKey = `webgpu-final-export-${Date.now()}`;
    setIsShaderCaptureExporting(true);
    setDone(false);
    setProgress(5);
    setFinalExportError(null);
    setFinalExportStatus("Recording live WebGPU shader preview in real time...");
    setPreviewState((current) =>
      startSectionRecompute(current, {
        requestKey,
        sectionId: "story:webgpu-final-export",
        continuityMode: shuffleMode,
        paramsHash: `webgpu-final-export:${shaderPresetId}:${storyPreviewSegments.length}`,
        startedAt: new Date().toISOString(),
        progress: 5,
      }),
    );
    setPreviewState((current) => markSectionRecomputeRunning(current, requestKey));

    try {
      const audioFile = await resolveMasterAudioFile(beatJoinAnalysis, audioFileRef.current);
      const mimeType = getBestMediaRecorderMimeType();
      canvas.dataset.stutterCaptureResolution = "720p";
      const stream = canvas.captureStream(24);
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks: BlobPart[] = [];
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      });

      setProgress(10);
      setPreviewState((current) => updateSectionRecomputeProgress(current, { requestKey, progress: 10 }));

      const stopped = new Promise<void>((resolve) => recorder.addEventListener("stop", () => resolve(), { once: true }));
      recorder.start(1000);
      previewPlayerRef.current.stop();
      await waitMs(80);
      await previewPlayerRef.current.play();

      setProgress(20);
      setFinalExportStatus("Capturing the actual WebGPU shader canvas; this runs in real time for the song duration.");
      setPreviewState((current) => updateSectionRecomputeProgress(current, { requestKey, progress: 20 }));

      await waitForPreviewPlayerToEnd(previewPlayerRef.current, Math.max(30, browserPreviewState.totalDuration + 90));
      if (recorder.state !== "inactive") recorder.stop();
      await stopped;
      stream.getTracks().forEach((track) => track.stop());

      const captureBlob = new Blob(chunks, { type: mimeType || "video/webm" });
      if (captureBlob.size === 0) {
        throw new Error("WebGPU shader capture produced an empty recording.");
      }

      setProgress(70);
      setFinalExportStatus("Muxing WebGPU shader capture with master audio into MP4...");
      setPreviewState((current) => updateSectionRecomputeProgress(current, { requestKey, progress: 70 }));

      const form = new FormData();
      form.set("audio", audioFile);
      form.set("shaderCapture", new File([captureBlob], `${requestKey}.webm`, { type: captureBlob.type || "video/webm" }));
      form.set("requestKey", requestKey);

      const response = await fetch("/api/export/shader-capture", { method: "POST", body: form });
      const payload = (await response.json()) as {
        success?: boolean;
        error?: string;
        runId?: string;
      };

      if (!response.ok || !payload.success || !payload.runId) {
        throw new Error(payload.error ?? "WebGPU shader capture export failed.");
      }
      const asset = await waitForTriggerRunOutput(payload.runId, { timeoutMs: 30 * 60 * 1_000, pollIntervalMs: 3_000 }) as {
        requestKey: string;
        assetKey: string;
        duration: number;
        generatedAt: string;
        videoUrl?: string;
        downloadFileName?: string;
        shaderRenderSource?: string;
      };

      setProgress(95);
      setPreviewState((current) => updateSectionRecomputeProgress(current, { requestKey, progress: 95 }));
      setPreviewState((current) => markSectionReady(current, asset));
      setPreviewState((current) => swapReadySection(current, requestKey));
      setFinalExportUrl(asset.videoUrl ?? null);
      setFinalExportName(asset.downloadFileName ?? "stack-structure-webgpu-final.mp4");
      setFinalExportCueCount(shaderEffectCues.length);
      setFinalExportStatus(`WebGPU MP4 ready · ${(asset.duration || 0).toFixed(1)}s · ${shaderEffectCues.length} live shader cues captured.`);
      workflowCheckpointAutosaveRequestedRef.current = true;
      setProgress(100);
      setDone(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown WebGPU shader capture export error.";
      setFinalExportError(message);
      setFinalExportStatus("WebGPU shader capture export failed.");
      setPreviewState((current) => failSectionRecompute(current, { requestKey, message }));
    } finally {
      canvas.dataset.stutterCaptureResolution = "";
      setIsShaderCaptureExporting(false);
    }
  }

  async function runBrowserPreview() {
    setRetainedBrowserPreviewSegments(browserPreviewSegments);
    setRetainedPreviewEffectCues(shaderEffectCues);
    setIsRunning(true);
    setDone(false);
    setProgress(5);

    const requestKey = `browser-preview-${Date.now()}`;
    setPreviewState((current) =>
      startSectionRecompute(current, {
        requestKey,
        sectionId: `${tab}:browser`,
        continuityMode: shuffleMode,
        paramsHash: `browser:${tab}`,
        startedAt: new Date().toISOString(),
        progress: 5,
      }),
    );
    setPreviewState((current) => markSectionRecomputeRunning(current, requestKey));

    const uniqueVideoUrls = [...new Set(browserPreviewSegments.map((s) => s.videoUrl))];
    const videoUrlIndex = new Map(uniqueVideoUrls.map((url, index) => [url, index]));

    try {
      setProgress(20);
      setPreviewState((current) => updateSectionRecomputeProgress(current, { requestKey, progress: 20 }));

      const segments = browserPreviewSegments.map((seg) => ({
        startTime: seg.startTime,
        endTime: seg.endTime,
        sourceIndex: videoUrlIndex.get(seg.videoUrl) ?? 0,
      }));

      // When every clip lives assembled in RustFS, send durable refs so the raw
      // files never re-enter the browser or cross Vercel's serverless body cap.
      const sourcesByUrl = new Map(videoSources.map((source) => [source.videoUrl, source]));
      const generatedByUrl = new Map(generatedAssets.map((asset) => [buildGeneratedAssetPlaybackUrl(asset), asset]));
      const durableRefs = uniqueVideoUrls.map((url) => {
        const source = sourcesByUrl.get(url);
        if (source?.storageBucket && source.storagePath && !source.uploadChunks) {
          return { bucket: source.storageBucket, objectKey: source.storagePath };
        }
        const generated = generatedByUrl.get(url);
        const generatedObjectKey = generated?.fullStorage?.objectKey ?? generated?.fullStorage?.storagePath;
        return generated?.fullStorage?.bucket && generatedObjectKey
          ? { bucket: generated.fullStorage.bucket, objectKey: generatedObjectKey }
          : null;
      });

      const gatewayForm = new FormData();
      if (durableRefs.length && durableRefs.every((ref) => ref !== null)) {
        gatewayForm.set("refs", JSON.stringify(durableRefs));
      } else {
        const sourceFiles = await Promise.all(uniqueVideoUrls.map(async (url, index) => {
          const response = await fetch(url);
          const blob = await response.blob();
          const ext = blob.type.includes("mp4") ? ".mp4" : blob.type.includes("webm") ? ".webm" : ".mp4";
          return new File([blob], `source${index}${ext}`, { type: blob.type || "video/mp4" });
        }));
        gatewayForm.set("file", sourceFiles[0]);
        sourceFiles.forEach((file, index) => {
          gatewayForm.set(`file:${index}`, file);
        });
      }
      gatewayForm.set("segments", JSON.stringify(segments));
      gatewayForm.set("requestKey", requestKey);

      setProgress(40);
      setPreviewState((current) => updateSectionRecomputeProgress(current, { requestKey, progress: 40 }));

      const gatewayResponse = await fetch("/api/preview/gateway", {
        method: "POST",
        body: gatewayForm,
      });

      const gatewayPayload = (await gatewayResponse.json()) as {
        success?: boolean;
        error?: string;
        runId?: string;
      };

      if (!gatewayResponse.ok || !gatewayPayload.success || !gatewayPayload.runId) {
        throw new Error(gatewayPayload.error ?? "Gateway preview generation failed.");
      }

      const output = await waitForTriggerRunOutput(gatewayPayload.runId, { timeoutMs: 10 * 60 * 1_000, pollIntervalMs: 2_000 }) as {
        requestKey: string;
        assetKey: string;
        duration: number;
        generatedAt: string;
        videoUrl?: string;
      };

      setProgress(90);
      setPreviewState((current) => updateSectionRecomputeProgress(current, { requestKey, progress: 90 }));

      const asset = {
        requestKey: output.requestKey,
        assetKey: output.assetKey,
        duration: output.duration,
        generatedAt: output.generatedAt,
      };

      setPreviewState((current) => markSectionReady(current, asset));
      setPreviewState((current) => swapReadySection(current, requestKey));
      setProgress(100);
      setDone(true);
      setIsRunning(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Browser preview failed.";
      setPreviewState((current) => failSectionRecompute(current, { requestKey, message }));
      setVideoError(message);
      setIsRunning(false);
    }
  }

  async function resolveMasterAudioFile(analysis: BeatJoinAnalysis, currentFile: File | null) {
    if (currentFile) return currentFile;
    if (!analysis.audioUrl) throw new Error("Master audio blob is not available in this browser session.");
    return fetchMediaUrlAsFile(analysis.audioUrl, `${analysis.sourceLabel || "master-audio"}.wav`, "audio/wav");
  }

  async function fetchMediaUrlAsFile(url: string, fileName: string, fallbackType: string) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not read media URL for export: ${response.status}`);
    const blob = await response.blob();
    return new File([blob], fileName, { type: blob.type || fallbackType });
  }

  async function fetchStoredMediaAsFile(bucket: string, objectKey: string, fileName: string, fallbackType: string) {
    const params = new URLSearchParams({ bucket, objectKey });
    const response = await fetch(`/api/storage/media?${params.toString()}`);
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(payload?.error ?? `Could not recover stored project media (${response.status}).`);
    }
    const blob = await response.blob();
    return new File([blob], fileName, { type: blob.type || fallbackType });
  }

  async function reuploadThroughScopedPath(file: File, folderBase: string): Promise<{ bucket: string; objectKey: string; chunks?: Array<{ bucket: string; objectKey: string }> }> {
    const chunked = await uploadFileInChunks(file, folderBase);
    if (chunked) {
      const response = await fetch("/api/storage/assemble", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          size: chunked.size,
          contentType: chunked.contentType || file.type,
          fileName: file.name,
          folder: folderBase,
          chunks: chunked.chunks,
        }),
      });
      const payload = (await response.json().catch(() => null)) as { bucket?: unknown; storagePath?: unknown; objectKey?: unknown; error?: unknown } | null;
      const bucket = typeof payload?.bucket === "string" ? payload.bucket : "";
      const objectKey = typeof payload?.objectKey === "string" ? payload.objectKey : typeof payload?.storagePath === "string" ? payload.storagePath : "";
      if (!response.ok || !bucket || !objectKey) {
        const message = typeof payload?.error === "string" ? payload.error : `HTTP ${response.status}`;
        throw new Error(`Scoped chunk assembly failed: ${message}`);
      }
      return { bucket, objectKey };
    }
    const formData = new FormData();
    formData.append("file", file);
    formData.append("folder", folderBase);
    const response = await fetch("/api/storage/upload", { method: "POST", body: formData });
    const payload = (await response.json().catch(() => null)) as { bucket?: unknown; storagePath?: unknown; objectKey?: unknown } | null;
    const bucket = typeof payload?.bucket === "string" ? payload.bucket : "";
    const objectKey = typeof payload?.objectKey === "string" ? payload.objectKey : typeof payload?.storagePath === "string" ? payload.storagePath : "";
    if (!response.ok || !bucket || !objectKey) {
      throw new Error(`Scoped re-upload failed (${response.status}).`);
    }
    return { bucket, objectKey };
  }

  function handleCommitSplit() {
    if (!splitSegments.length) return;

    setCommittedBeatSplit({
      kind: "workflow",
      segments: splitSegments.map((segment) => ({
        ...segment,
        sourceClipIds: [...segment.sourceClipIds],
      })),
      signature: splitSignature,
      committedAt: new Date().toISOString(),
    });
    workflowCheckpointAutosaveRequestedRef.current = true;
    setJoinClipStates(Object.fromEntries(splitSegments.map((_, index) => [index, true])) as Record<number, boolean>);
    setActiveClip(0);
    setDone(true);
    setProgress(100);
  }

  function handleSelectSemanticCandidate(sectionId: string, momentId: string) {
    setMusicVideoProject((currentProject) => {
      if (!currentProject) return currentProject;
      return selectStorySectionCandidate(currentProject, { sectionId, momentId });
    });
    setDone(false);
  }

  // Split commits itself: while the Split stage is open, the current cut set
  // is the committed one. Re-running when the signature changes keeps Match
  // and Join in step without a separate "Commit" click.
  const shouldAutoCommitSplit = tab === "split" && splitSegments.length > 0 && !isCommittedSplitCurrent;
  useEffect(() => {
    if (!shouldAutoCommitSplit) return;
    // The committed split is derived state that several stages read; syncing it
    // here (guarded by the signature) is the one place the derivation happens.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    handleCommitSplit();
    // handleCommitSplit closes over the latest split state; the signature guard prevents re-runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldAutoCommitSplit, splitSignature]);
  const audioPreviewSubtitle = useMemo(() => {
    switch (tab) {
      case "story":
        return "Master Audio Track · Story/Edit Plan";
      case "compose":
        return "Master Audio Track · Export";
      case "shuffle":
        return `Master Audio Track · Match ${shuffleMode}`;
      case "generate":
        return "Master Audio Track · Fill gaps with generated footage";
      case "split":
        return `Master Audio Track · Split ${formatSplitModeLabel(splitMode)}`;
      case "join":
        return "Master Audio Track · Join Timeline";
      case "ramp":
        return "Master Audio Track · Effects";
      default:
        return "Master Audio Track · Studio Timeline";
    }
  }, [shuffleMode, splitMode, tab]);
  const shuffleQueue = useMemo(
    () =>
      buildShuffleQueue({
        clipCount: joinClips.length,
        shuffleMode,
        activeClip: beatActiveClip,
        minScore,
        lookahead,
        keepPct,
        colorGradient,
      }),
    [joinClips.length, shuffleMode, beatActiveClip, minScore, lookahead, keepPct, colorGradient]
  );
  const manifestSegments = useMemo(() => {
    const totalDuration = sourceClips[sourceClips.length - 1]?.end ?? 0;
    if (!beatJoinAnalysis || totalDuration <= 0) return [];

    const cutEvents = buildMusicCutEvents({
      analysis: beatJoinAnalysis,
      mode: beatSplitMode,
      includeSectionBoundaries: true,
    });

    return buildSegmentManifest({
      sourceClips,
      cutEvents,
      totalDuration: Math.min(totalDuration, beatJoinAnalysis.duration),
    });
  }, [sourceClips, beatJoinAnalysis, beatSplitMode]);

  const manifestRankingPreview = useMemo(() => {
    if (!manifestSegments.length) return { ids: [] as string[], order: [] as number[] };

    const anchorSegment = manifestSegments[Math.min(beatActiveClip, Math.max(0, manifestSegments.length - 1))];
    if (!anchorSegment) return { ids: [] as string[], order: [] as number[] };
    const targetDuration = anchorSegment.duration;
    const previousDescriptor = anchorSegment.motionDescriptor;

    const ranked = rankManifestCandidates({
      mode: deriveManifestRankingMode(shuffleMode),
      previousDescriptor,
      randomSeed: `${tab}:${beatActiveClip}:${shuffleMode}`,
      candidates: manifestSegments.map((segment) => ({
        id: `SEG_${String(segment.id + 1).padStart(2, "0")}`,
        segment,
        musicalScore: Math.max(0, 1 - Math.abs(segment.duration - targetDuration) / Math.max(targetDuration, 0.001)),
        targetDuration,
        colorContinuityScore: normalizeColorScore({ sourceClipId: segment.sourceClipIds[0] ?? 0, gradient: colorGradient, clipCount: sourceClips.length }),
      })),
    });

    return {
      ids: ranked.slice(0, 3).map((candidate) => candidate.id),
      order: ranked.map((candidate) => candidate.segmentId),
    };
  }, [manifestSegments, beatActiveClip, shuffleMode, tab, colorGradient, sourceClips.length]);

  const effectiveClipOrder = deriveEffectiveClipOrder({
    manifestSegmentCount: manifestSegments.length,
    segmentPreviewCount: segmentPreviews.length,
    rankedOrder: manifestRankingPreview.order,
    defaultOrder: shuffleQueue,
  });
  const previewAssetUrl = buildPreviewAssetUrl(previewState.currentAssetKey);

  useEffect(() => {
    setGeneratePreviewRange((current) => {
      if (!current) return current;
      if (!storyPreviewSegments.length) return null;
      const lastIndex = storyPreviewSegments.length - 1;
      const startIndex = Math.min(current.startIndex, lastIndex);
      const endIndex = Math.min(Math.max(startIndex, current.endIndex), lastIndex);
      return startIndex === current.startIndex && endIndex === current.endIndex ? current : { startIndex, endIndex };
    });
  }, [storyPreviewSegments.length]);

  useEffect(() => {
    const density = normalizeStoryEditSettings(storyState.editSettings).cutDensity;
    setClipDur(density >= 0.7 ? 2 : density <= 0.4 ? 10 : 6);
  }, [storyState.editSettings]);

  const shaderPresetSummary = useMemo(() => describeMusicVideoShaderPreset(shaderPresetId), [shaderPresetId]);

  const browserPreviewSegments = useMemo<PreviewSegment[]>(() => {
    if (tab === "generate") {
      return generatedAuditionSegments ?? slicePreviewCutRange(storyPreviewSegments, generatePreviewRange);
    }

    if (tab === "story" || tab === "compose") {
      return storyPreviewSegments;
    }

    if (tab === "join") {
      return storyPreviewSegments;
    }

    if (tab === "shuffle") {
      return effectiveClipOrder
        .map((clipId): PreviewSegment | null => {
          const segment = workingBeatSplitSegments[clipId];
          if (!segment) return null;
          const sourceClipId = segment.sourceClipIds[0] ?? -1;
          const source = videoSources.find((candidate) => candidate.id === sourceClipId);
          if (!source) return null;
          const offset = getSourceClipTimeOffset(sourceClips, sourceClipId);
          return {
            videoUrl: source.videoUrl,
            startTime: Math.max(0, segment.start - offset),
            endTime: Math.max(0, segment.end - offset),
            musicStart: segment.start,
            musicEnd: segment.end,
            label: `SEG_${String(clipId + 1).padStart(2, "0")}`,
          };
        })
        .filter((s): s is PreviewSegment => s !== null && s.videoUrl !== undefined && s.endTime > s.startTime);
    }

    return [];
  }, [tab, storyPreviewSegments, generatePreviewRange, generatedAuditionSegments, effectiveClipOrder, workingBeatSplitSegments, videoSources, sourceClips]);

  useEffect(() => {
    if (tab !== "generate" || previewAuditionRequest === 0 || !browserPreviewSegments.length) return;
    if (handledPreviewAuditionRequestRef.current === previewAuditionRequest) return;
    handledPreviewAuditionRequestRef.current = previewAuditionRequest;
    setIsDockCollapsed(false);
    setIsPreviewExpanded(true);
    const player = previewPlayerRef.current;
    player.load(browserPreviewSegments);
    void player.play();
  }, [browserPreviewSegments, previewAuditionRequest, tab]);

  const shaderEffectCues = useMemo(
    () =>
      beatJoinAnalysis && musicVideoProject && storyPreviewSegments.length > 0
        ? buildAutoShaderCues({
            segments: storyPreviewSegments,
            beats: beatJoinAnalysis.beats,
            lyricChunks: musicVideoProject.lyricChunks,
            presetId: shaderPresetId,
            accentKinds: shaderAccentKinds,
          })
        : [],
    [beatJoinAnalysis, musicVideoProject, shaderAccentKinds, shaderPresetId, storyPreviewSegments],
  );

  useEffect(() => {
    if (shaderEffectCues.length > 0) {
      lastPreviewEffectCuesRef.current = shaderEffectCues;
    }
  }, [shaderEffectCues]);

  useEffect(() => {
    if ((tab !== "story" && tab !== "compose") || browserPreviewSegments.length === 0) return;
    setRetainedBrowserPreviewSegments(browserPreviewSegments);
    setRetainedPreviewEffectCues(shaderEffectCues);
  }, [browserPreviewSegments, shaderEffectCues, tab]);

  const displayedBrowserPreviewSegments = tab === "generate" && browserPreviewSegments.length > 0
    ? browserPreviewSegments
    : (tab === "story" || tab === "compose" || tab === "join") && browserPreviewSegments.length > 0
    ? browserPreviewSegments
    : retainedBrowserPreviewSegments.length > 0
      ? retainedBrowserPreviewSegments
      : browserPreviewSegments.length > 0
        ? browserPreviewSegments
        : previewPlayer.getSegments();
  const displayedPreviewEffectCues = tab === "join"
    ? []
    : tab === "generate" && generatePreviewRange
    ? []
    : (tab === "story" || tab === "compose") && shaderEffectCues.length > 0
    ? shaderEffectCues
    : retainedPreviewEffectCues.length > 0
      ? retainedPreviewEffectCues
      : shaderEffectCues.length > 0
        ? shaderEffectCues
        : lastPreviewEffectCuesRef.current;

  const ingestStats = useMemo(() => {
    const sceneCount = videoSources.reduce((total, source) => total + (source.scenes?.length ?? 0), 0);
    const captionReady = videoSources.reduce((total, source) => total + (source.scenes?.filter((scene) => Boolean(scene.caption)).length ?? 0), 0);
    const captionTotal = sceneCount;
    return { sceneCount, captionReady, captionTotal };
  }, [videoSources]);

  const pipeline = useMemo(() => buildPipelineState(buildStudioPipelineInput({
    activeTab: tab,
    hasAudioAnalysis: beatJoinAnalysis !== null,
    hasLyricTranscript: Boolean(storyState.transcriptSummary?.chunks.length),
    referenceAssets,
    videoCount: videoSources.length,
    sceneCount: ingestStats.sceneCount,
    captionReadyCount: ingestStats.captionReady,
    captionTotalCount: ingestStats.captionTotal,
    storyTreatmentSelected: Boolean(storyState.selectedTreatmentId || storyState.confirmedTreatmentId),
    storyAnchorsResolved: isStoryPlanConfirmable(storyState.confirmedTreatmentSnapshot),
    storyPlanConfirmed: storyState.storyGenerated
      && Boolean(storyState.confirmedTreatmentId)
      && Boolean(storyState.storyContentSignature),
    musicVideoProject,
    generatedAssets,
    storySegmentCount: storyPreviewSegments.length,
    hasCommittedSplit: isCommittedSplitCurrent,
    shaderPresetLabel: shaderPresetSummary.preset.label,
    finalExportReady: Boolean(finalExportUrl) && storyState.storyGenerated && isCommittedSplitCurrent,
  })), [
    tab,
    beatJoinAnalysis,
    storyState.storyGenerated,
    storyState.selectedTreatmentId,
    storyState.confirmedTreatmentId,
    storyState.confirmedTreatmentSnapshot,
    storyState.storyContentSignature,
    storyState.transcriptSummary,
    referenceAssets,
    videoSources.length,
    ingestStats,
    musicVideoProject,
    storyPreviewSegments.length,
    isCommittedSplitCurrent,
    shaderPresetSummary.preset.label,
    finalExportUrl,
    generatedAssets,
  ]);
  const activePipelineStage = pipeline.stages.find((stage) => stage.active) ?? null;
  const activeStageBlocked = Boolean(activePipelineStage && !activePipelineStage.available);

  const persistableProjectDraft = useMemo(() => createPersistableStudioProjectDraft({
    analysis: beatJoinAnalysis,
    videoSources,
    storyState,
    musicVideoProject,
    referenceAssets,
    generatedAssets,
    captionSettings: buildSceneCaptionSettings(captionMode, beatJoinAnalysis, storyState, referenceAssets),
    workflowUiSettings: {
      activeTab: tab,
      splitMode,
      matchMode,
      matchOnsetDensity,
      matchLyricCueBlend,
      matchLyricMergeWindow,
      colorGradient,
      shaderPresetId,
      shaderAccentKinds,
      isPreviewExpanded,
      committedSplit: committedBeatSplit ?? undefined,
    },
  }), [beatJoinAnalysis, captionMode, colorGradient, committedBeatSplit, generatedAssets, isPreviewExpanded, matchLyricCueBlend, matchLyricMergeWindow, matchMode, matchOnsetDensity, musicVideoProject, referenceAssets, shaderAccentKinds, shaderPresetId, splitMode, storyState, tab, videoSources]);

  useEffect(() => {
    const staleWorkflowSplit = tab === "split" && committedBeatSplit?.kind === "workflow" && !isCommittedSplitCurrent;
    const staleLegacySplit = tab === "split" && committedBeatSplit?.kind === "legacy" && !isCommittedBeatSplitCurrent;
    if (staleWorkflowSplit || staleLegacySplit) {
      setDone(false);
    }
  }, [committedBeatSplit, isCommittedBeatSplitCurrent, isCommittedSplitCurrent, tab]);

  function resetPreparedPreview(options: { preserveBrowserPreview?: boolean } = {}) {
    setDone(false);
    setProgress(0);
    setPreviewState(createSectionRecomputeState());
    if (!options.preserveBrowserPreview) {
      previewPlayerRef.current.stop();
      setIsBrowserPreviewActive(false);
    }
  }

  function handleSelectTab(t: Tab) {
    if (t === tab) return;
    // Switching stage is not an edit, and it is a natural checkpoint: skip the
    // dirty mark for this change and persist once the new tab is in the draft.
    skipNextDirtyMarkRef.current = true;
    setTab(t);
    resetPreparedPreview({ preserveBrowserPreview: true });
    window.setTimeout(() => {
      void flushPendingAutosaveRef.current?.();
    }, 0);
  }

  const needsVideoSource = tab !== "story" && tab !== "compose";
  const actionState = deriveActionDisabledState({
    needsVideoSource,
    videoSourceCount: videoSources.length,
    requiresAudioSource: false,
    hasAudioSource: beatJoinAnalysis !== null,
    activeRequestKey: previewState.activeRequestKey,
  });
  const storyActionReason = !storyState.storyGenerated
      ? "Confirm the treatment and resolve its anchors first."
    : storyPreviewSegments.length === 0
      ? "Upload source clips."
      : previewState.activeRequestKey
        ? "Preview already running."
        : null;
  const finalExportDisabledReason = !beatJoinAnalysis
    ? "Upload master audio first."
    : !storyState.storyGenerated || storyPreviewSegments.length === 0
      ? "Generate story preview first."
      : isFinalExporting
        ? "Final export running."
        : isShaderCaptureExporting
          ? "WebGPU export running."
        : previewState.activeRequestKey
          ? "Preview/export already running."
          : null;
  const splitActionReason = tab === "split" && videoSources.length > 0 && splitSegments.length === 0
    ? getSplitModeLockedReason(splitMode, {
      hasAnalysis: Boolean(beatJoinAnalysis),
      sceneCount: ingestStats.sceneCount,
    })
    : null;
  const actionDisabled = tab === "story" || tab === "compose"
    ? Boolean(storyActionReason)
    : tab === "split"
      ? Boolean(actionState.disabled || splitActionReason)
      : actionState.disabled;
  const actionDisabledReason = tab === "story" || tab === "compose"
    ? storyActionReason ?? "Unavailable"
    : tab === "split"
      ? splitActionReason ?? actionState.reason ?? "Unavailable"
      : actionState.reason ?? "Unavailable";

  const previewStatusLabel = derivePreviewStatusLabel(previewState);
  const completedLabel = tab === "story" || tab === "compose"
    ? `${tab === "compose" ? "Compose Preview Ready" : "Story Preview Ready"}${previewState.currentAssetKey ? ` — ${previewState.currentAssetKey.split(/[\\/]/).pop()}` : ""}`
    : deriveCompletedLabel(previewState.currentAssetKey);

  const isAnyRunRunning = isRunning || isFinalExporting || isShaderCaptureExporting;
  const stageHeaderModel = useMemo(() => buildStageHeaderModel({
    stages: pipeline.stages,
    activeTab: tab,
    canPreview: !actionDisabled,
    previewDisabledReason: actionDisabled ? actionDisabledReason : null,
    isBusy: isAnyRunRunning,
  }), [actionDisabled, actionDisabledReason, isAnyRunRunning, pipeline.stages, tab]);

  const stagePreviewRun = {
    isRunning: isAnyRunRunning,
    progress,
    // Split's completion is implicit (auto-commit); its header shows the cut count instead.
    done: done && tab !== "review" && tab !== "split",
    processingLabel: isFinalExporting ? "Rendering final MP4" : `Preparing preview · ${previewState.stage}`,
    completedLabel,
  };

  const splitNotice = tab === "split" && committedBeatSplit && isCommittedSplitCurrent
    ? { text: `Split committed automatically · ${committedBeatSplit.segments.length} cuts`, tone: "ok" as const }
    : null;

  function handleStagePrimary() {
    const action = stageHeaderModel?.primary;
    if (!action || action.disabledReason) return;
    if (action.targetTab) handleSelectTab(action.targetTab);
  }

  function handleStageSecondary() {
    const action = stageHeaderModel?.secondary;
    if (!action || action.disabledReason) return;
    if (action.kind === "preview") void runProcess();
  }

  const statusTone: StatusTone = previewState.activeRequestKey
    ? "processing"
    : previewState.error
      ? "failed"
      : done
        ? "ready"
        : "waiting";
  const activityLine = isPreparingAudio
    ? audioStatus
    : isPreparingVideos || isRerunningSceneAnalysis
      ? videoStatus
      : isFinalExporting || isShaderCaptureExporting
        ? finalExportStatus
        : pipeline.nextHint;
  const activityTone: StatusTone = audioError || videoError || finalExportError
    ? "failed"
    : isPreparingAudio || isPreparingVideos || isRerunningSceneAnalysis || isFinalExporting || isShaderCaptureExporting
      ? "processing"
      : "waiting";

  return (
    <div className="flex h-screen overflow-hidden bg-ink-1 font-sans text-fg-1 antialiased select-none">
      <StudioSidebar
        tab={tab}
        stages={pipeline.stages}
        collapsed={isSidebarCollapsed}
        onToggleCollapsed={() => setIsSidebarCollapsed((current) => !current)}
        onSelectTab={handleSelectTab}
      />

      <div className="flex flex-1 flex-col overflow-hidden">
        <StudioHeader
          songLabel={beatJoinAnalysis?.sourceLabel ?? null}
          songDuration={beatJoinAnalysis?.duration ?? null}
          saveState={saveState}
          projectDraft={persistableProjectDraft}
          activeProjectId={activeProjectId}
          activeProjectName={activeProjectName}
          onNewProject={handleNewProject}
          onProjectSelected={handleProjectSelected}
          onProjectSaved={handleProjectSaved}
        />

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <main className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            {stageHeaderModel ? (
              <StageHeader
                model={stageHeaderModel}
                preview={stagePreviewRun}
                notice={splitNotice}
                onPrimary={handleStagePrimary}
                onSecondary={handleStageSecondary}
                onResetPreview={resetPreparedPreview}
              />
            ) : null}

            {tab !== "review" && (beatJoinAnalysis || !activeStageBlocked) ? (
              <StudioAudioLane
                analysis={beatJoinAnalysis}
                isPreparingAudio={isPreparingAudio}
                audioProgress={audioProgress}
                audioError={audioError}
                bpmFallback={bpm}
                subtitle={audioPreviewSubtitle}
                onOpenIngest={() => handleSelectTab("review")}
                onPlayheadChange={setAudioPreviewPlayhead}
              />
            ) : null}

            {tab !== "review" && tab !== "story" && storyState.confirmedTreatmentSnapshot ? (
              <StoryPlanSummaryBar
                treatment={storyState.confirmedTreatmentSnapshot}
                confirmed={storyState.storyGenerated}
                onOpenStory={() => handleSelectTab("story")}
              />
            ) : null}

            {activeStageBlocked ? null : <>
            {tab === "review" && (
              <IngestTab
                analysis={beatJoinAnalysis}
                audioStatus={audioStatus}
                audioError={audioError}
                audioProgress={audioProgress}
                isPreparingAudio={isPreparingAudio}
                onAudioUpload={handleAudioUpload}
                vocalStemName={storyState.vocalStemName}
                transcriptSummary={storyState.transcriptSummary}
                videoSources={videoSources}
                videoStatus={videoStatus}
                videoError={videoError}
                isPreparingVideos={isPreparingVideos}
                isRerunningSceneAnalysis={isRerunningSceneAnalysis}
                captionMode={captionMode}
                onCaptionModeChange={setCaptionMode}
                onVideoUpload={handleVideoUpload}
                onAppendVideos={handleAppendVideos}
                onRemoveVideo={handleRemoveVideo}
                onRerunSceneAnalysis={(scope) => void handleRerunSceneAnalysis(scope)}
                onMergeScene={handleMergeSceneIntoPrevious}
                referenceAssets={referenceAssets}
                onReferenceAssetUpload={(role, files) => void handleReferenceAssetUpload(role, files)}
                onReferenceAssetUpdate={handleReferenceAssetUpdate}
                onReferenceAssetRemove={handleReferenceAssetRemove}
                onVocalStemTranscriptStart={handleVocalStemTranscriptStart}
                onVocalStemTranscriptComplete={handleVocalStemTranscriptComplete}
                onVocalStemTranscriptFailed={handleVocalStemTranscriptFailed}
              />
            )}
            {tab === "split" && (
              <SplitTab
                playhead={playhead}
                clipDur={clipDur}
                mode={splitMode}
                analysis={beatJoinAnalysis}
                videoSources={videoSources}
                videoStatus={videoStatus}
                videoError={videoError}
                isPreparingVideos={isPreparingVideos}
                sourceClips={sourceClips}
                segments={splitSegments}
                activeClip={splitActiveClip}
                onVideoUpload={handleVideoUpload}
                onClipDur={setClipDur}
                onModeChange={setSplitMode}
                onActiveClip={setActiveClip}
              />
            )}

            {tab === "story" && (
              <StoryTab
                analysis={beatJoinAnalysis}
                audioStatus={audioStatus}
                videoSources={videoSources}
                segmentPreviews={segmentPreviews}
                state={storyState}
                onStateChange={setStoryState}
                onProjectChange={setMusicVideoProject}
              />
            )}

            {tab === "compose" && (
              <ComposeTab
                analysis={beatJoinAnalysis}
                storyGenerated={storyState.storyGenerated}
                editSlotCount={musicVideoProject?.editPlan.timelineItems.length ?? 0}
                storySegmentCount={storyPreviewSegments.length}
                lyricChunkCount={musicVideoProject?.lyricChunks.length ?? 0}
                videoSourceCount={videoSources.length}
                shaderPresetId={shaderPresetId}
                shaderPresetSummary={shaderPresetSummary}
                shaderEffectCues={shaderEffectCues}
                accentKinds={shaderAccentKinds}
                onAccentKindChange={(sync, kind) => setShaderAccentKinds((current) => ({ ...current, [sync]: kind }))}
                finalExportStatus={finalExportStatus}
                finalExportError={finalExportError}
                finalExportUrl={finalExportUrl}
                finalExportName={finalExportName}
                finalExportCueCount={finalExportCueCount}
                finalExportDisabledReason={finalExportDisabledReason}
                isFinalExporting={isFinalExporting}
                isShaderCaptureExporting={isShaderCaptureExporting}
                onShaderPresetId={(id) => setShaderPresetId(id as typeof shaderPresetId)}
                onFinalExport={() => void runFinalExport()}
                onWebGpuExport={() => void runWebGpuShaderCaptureExport()}
                onSelectStory={() => handleSelectTab("story")}
              />
            )}

            {tab === "shuffle" && (
              <MatchTab
                project={musicVideoProject}
                analysis={beatJoinAnalysis}
                storyGenerated={storyState.storyGenerated}
                onsetDensity={matchOnsetDensity}
                lyricCueBlend={matchLyricCueBlend}
                lyricMergeWindow={matchLyricMergeWindow}
                videoSources={videoSources}
                onOnsetDensity={setMatchOnsetDensity}
                onLyricCueBlend={setMatchLyricCueBlend}
                onLyricMergeWindow={setMatchLyricMergeWindow}
                onSelectStory={() => handleSelectTab("story")}
                onSelectSplit={() => handleSelectTab("split")}
                onSelectCandidate={handleSelectSemanticCandidate}
              />
            )}

            {tab === "generate" && (
              <GenerateTab
                project={musicVideoProject}
                analysis={beatJoinAnalysis}
                storyGenerated={storyState.storyGenerated}
                onsetDensity={matchOnsetDensity}
                lyricCueBlend={matchLyricCueBlend}
                lyricMergeWindow={matchLyricMergeWindow}
                previewSegments={storyPreviewSegments}
                referenceAssets={referenceAssets}
                persistedGeneratedAssets={generatedAssets}
                masterAudioRef={beatJoinAnalysis?.storageBucket && beatJoinAnalysis.storagePath
                  ? {
                      bucket: beatJoinAnalysis.storageBucket,
                      objectKey: beatJoinAnalysis.storagePath,
                      fileName: beatJoinAnalysis.sourceLabel || "master-audio.wav",
                      duration: beatJoinAnalysis.duration,
                    }
                  : null}
                onEnsureOwnedMasterAudio={ensureOwnedMasterAudioForGeneration}
                onGeneratedAsset={(asset) => setGeneratedAssets((current) => [asset, ...current.filter((candidate) => candidate.id !== asset.id)])}
                selectedPreviewRange={generatePreviewRange}
                onSelectedPreviewRange={(range) => {
                  setGeneratedAuditionSegments(null);
                  setGeneratePreviewRange(range);
                }}
                onAuditionPreviewRange={(range) => {
                  setGeneratedAuditionSegments(null);
                  setGeneratePreviewRange(range);
                  setPreviewAuditionRequest((request) => request + 1);
                }}
                onAuditionGeneratedAsset={auditionGeneratedAsset}
                onSelectMatch={() => handleSelectTab("shuffle")}
                onSelectJoin={() => handleSelectTab("join")}
              />
            )}

            {tab === "join" && (
              <JoinTab
                previewSegments={storyPreviewSegments}
                activeClip={Math.min(activeClip, Math.max(0, storyPreviewSegments.length - 1))}
                onActiveClip={setActiveClip}
              />
            )}

            {tab === "ramp" && (
              <RampTab
                playhead={playhead}
                bpm={bpm}
                analysis={beatJoinAnalysis}
                segmentPreviews={segmentPreviews}
                isUsingCommittedSplit={isAnyCommittedSplitCurrent}
                rampPreset={rampPreset}
                minSpeed={minSpeed}
                maxSpeed={maxSpeed}
                rampDur={rampDur}
                energyThresh={energyThresh}
                buildBoost={buildBoost}
                dropSlowdown={dropSlowdown}
                onRampPreset={setRampPreset}
                onMinSpeed={setMinSpeed}
                onMaxSpeed={setMaxSpeed}
                onRampDur={setRampDur}
                onEnergyThresh={setEnergyThresh}
                onBuildBoost={setBuildBoost}
                onDropSlowdown={setDropSlowdown}
              />
            )}
            </>}
          </main>

          <PreviewDock
            collapsed={isDockCollapsed}
            onToggleCollapsed={() => setIsDockCollapsed((current) => !current)}
            expanded={isPreviewExpanded}
            onToggleExpanded={() => setIsPreviewExpanded((current) => !current)}
            previewPlayer={previewPlayer}
            browserPreviewSegments={displayedBrowserPreviewSegments}
            browserPreviewState={browserPreviewState}
            isBrowserPreviewActive={isBrowserPreviewActive}
            previewEffectCues={displayedPreviewEffectCues}
            audioTimeline={beatJoinAnalysis}
            masterAudioUrl={beatJoinAnalysis?.audioUrl ?? null}
            previewAssetKey={previewState.currentAssetKey}
            previewAssetUrl={previewAssetUrl}
          />
        </div>

        <StudioStatusBar
          statusLabel={previewStatusLabel}
          statusTone={statusTone}
          activity={activityLine}
          activityTone={activityTone}
        />
      </div>
    </div>
  );
}

function getBestMediaRecorderMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "";
}

function waitMs(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForPreviewPlayerToEnd(player: BrowserPreviewPlayer, timeoutSeconds: number) {
  return new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + timeoutSeconds * 1000;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let unsubscribe: (() => void) | null = null;

    const cleanup = () => {
      if (intervalId) clearInterval(intervalId);
      unsubscribe?.();
    };

    const check = (state = player.getState()) => {
      if (state.status === "ended") {
        cleanup();
        resolve();
        return;
      }
      if (state.status === "error") {
        cleanup();
        reject(new Error(state.errorMessage ?? "Preview playback failed during WebGPU capture."));
        return;
      }
      if (Date.now() > deadline) {
        cleanup();
        reject(new Error("Timed out while recording the WebGPU shader preview."));
      }
    };

    unsubscribe = player.subscribe(check);
    intervalId = setInterval(() => check(), 1000);
    check();
  });
}

function buildVideoSourceKey(source: Pick<UploadedVideoSource, "name" | "size" | "duration">) {
  return `${source.name}::${source.size}::${source.duration.toFixed(3)}`;
}

function StoryPlanSummaryBar({ treatment, confirmed, onOpenStory }: { treatment: StoryTreatment; confirmed: boolean; onOpenStory: () => void }) {
  const generationGaps = treatment.anchors.filter((anchor) => anchor.resolution === "generate").length;
  return (
    <button
      type="button"
      onClick={onOpenStory}
      className={`grid w-full gap-2 rounded-[2px] border px-3 py-2 text-left lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center ${confirmed ? "border-[#24492f] bg-[#071008]" : "border-[#5a3219] bg-[#120a05]"}`}
    >
      <span className={`text-[8px] uppercase tracking-[0.18em] ${confirmed ? "text-[#68b979]" : "text-[#d18a55]"}`}>{confirmed ? "Story locked" : "Story changed"}</span>
      <span className="truncate text-[10px] text-[#aaa39c]"><strong className="mr-2 text-[#d7d0c8]">{treatment.title}</strong>{treatment.logline}</span>
      <span className="font-mono text-[8px] uppercase text-[#6c665f]">{treatment.anchors.length} anchors · {generationGaps} generation gap{generationGaps === 1 ? "" : "s"} · edit story</span>
    </button>
  );
}

function buildSceneCaptionSettings(
  mode: SceneCaptionMode,
  analysis: BeatJoinAnalysis | null,
  storyState: ReturnType<typeof createDefaultStoryTabState>,
  referenceAssets: ReferenceAsset[],
) {
  const transcript = storyState.transcriptSummary?.transcript ?? "";
  const characters = referenceAssets
    .filter((asset) => asset.storageStatus === "uploaded" && (asset.role === "character-1" || asset.role === "character-2"))
    .map((asset) => ({
      name: asset.displayName.trim(),
      role: asset.role === "character-1" ? "primary" as const : "secondary" as const,
      identityInstruction: asset.promptHint.trim() || undefined,
    }))
    .filter((character) => Boolean(character.name));
  const locations = referenceAssets
    .filter((asset) => asset.storageStatus === "uploaded" && asset.role === "environment")
    .map((asset) => ({
      name: asset.displayName.trim(),
      continuityInstruction: asset.promptHint.trim() || undefined,
    }))
    .filter((location) => Boolean(location.name))
    .slice(0, 1);
  const referenceImages = referenceAssets
    .filter((asset) => asset.storageStatus === "uploaded" && (asset.role === "character-1" || asset.role === "character-2" || asset.role === "environment"))
    .flatMap((asset) => {
      const name = asset.displayName.trim();
      const bucket = asset.storageBucket?.trim();
      const objectKey = asset.storagePath?.trim();
      if (!name || !bucket || !objectKey) return [];
      return [{
        name,
        role: asset.role === "character-1"
          ? "primary" as const
          : asset.role === "character-2"
            ? "secondary" as const
            : "environment" as const,
        bucket,
        objectKey,
        fileName: asset.fileName,
      }];
    })
    .slice(0, 3);
  return {
    mode,
    referenceImages,
    context: {
      songTitle: analysis?.sourceLabel,
      vocalStemName: storyState.vocalStemName || undefined,
      lyricExcerpt: transcript ? transcript.slice(0, 900) : undefined,
      storySummary: storyState.confirmedTreatmentSnapshot?.synopsis
        || storyState.transcriptSummary?.summary
        || undefined,
      storyPrompts: (storyState.confirmedTreatmentSnapshot?.anchors
        .map((anchor) => anchor.description)
        ?? storyState.storyBeats.map((beat) => beat.prompt))
        .filter(Boolean)
        .slice(0, 10),
      projectIntent: "Music-video source footage captioning for later semantic matching against lyrics, story sections, action, mood, and setting.",
      captionStyle: "detailed-cinematic" as const,
      characters,
      locations,
    },
  };
}

function formatSplitModeLabel(mode: SplitMode) {
  switch (mode) {
    case "scene":
      return "Scene";
    case "beat":
      return "Rhythm";
    case "onset":
      return "Rhythm";
    case "scene-beat":
      return "Scene + Rhythm";
    case "scene-onset":
      return "Scene + Rhythm";
  }
}

function getSplitModeLockedReason(mode: SplitMode, state: { hasAnalysis: boolean; sceneCount: number }) {
  const needsScenes = mode === "scene" || mode === "scene-beat" || mode === "scene-onset";
  const needsAnalysis = mode === "beat" || mode === "onset" || mode === "scene-beat" || mode === "scene-onset";

  if (needsScenes && state.sceneCount === 0) {
    return "Scene detection must return cuts before this split mode can build.";
  }
  if (needsAnalysis && !state.hasAnalysis) {
    return "Upload and analyze the master song before using a rhythm split strategy.";
  }
  return "No split cuts are ready for this mode.";
}

function formatVideoStatus(
  mode: "replace" | "append",
  changedCount: number,
  skippedCount: number,
  sources: UploadedVideoSource[],
) {
  const sceneCount = sources.reduce((total, source) => total + (source.scenes?.length ?? 0), 0);
  const failedCount = sources.filter((source) => source.sceneStatus === "failed").length;
  const sceneLabel = failedCount
    ? `${failedCount} scene detection error${failedCount === 1 ? "" : "s"}`
    : sceneCount
      ? `${sceneCount} PySceneDetect scene${sceneCount === 1 ? "" : "s"}`
      : "scene detection pending";

  if (mode === "append") {
    if (!changedCount) {
      return `Skipped duplicate clip${skippedCount === 1 ? "" : "s"} · ${sources.length} total ready · ${sceneLabel}.`;
    }
    return `Added ${changedCount} clip${changedCount === 1 ? "" : "s"} · ${sources.length} total ready · ${sceneLabel}.`;
  }

  return `Loaded ${changedCount} clip${changedCount === 1 ? "" : "s"} · ${sources.length} total ready · ${sceneLabel}.`;
}

function resolveSceneForTimelineSegment(
  sources: UploadedVideoSource[],
  sourceClips: SourceClipSpan[],
  segment: SourceTimelineSegment,
) {
  const sourceId = segment.sourceClipIds[0];
  if (sourceId === undefined) return null;
  const source = sources.find((candidate) => candidate.id === sourceId);
  const span = sourceClips.find((clip) => clip.id === sourceId);
  if (!source || !span || !source.scenes?.length) return null;

  const localMidpoint = Math.max(0, Math.min(source.duration, ((segment.start + segment.end) / 2) - span.start));
  return source.scenes.find((scene) => localMidpoint >= scene.start && localMidpoint <= scene.end) ?? null;
}

function formatSourceRefs(sourceClipIds: number[]) {
  if (!sourceClipIds.length) return "S0";
  if (sourceClipIds.length === 1) return `S${sourceClipIds[0] + 1}`;
  const first = sourceClipIds[0] ?? 0;
  const last = sourceClipIds[sourceClipIds.length - 1] ?? first;
  return `S${first + 1}-${last + 1}`;
}
