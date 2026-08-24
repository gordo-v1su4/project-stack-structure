"use client";

import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { extractWaveformData, fetchEssentiaAnalysis, getEssentiaStorageFromPayload, parseEssentiaPayload } from "./studio/audioAnalysis";
import { buildArrangementSegments } from "./studio/arrangementBuilder";
import type { ArrangementSegment } from "./studio/arrangementBuilder";
import { NAV } from "./studio/constants";
import { mergeUploadedVideoSourceUpdate, needsSceneDetectionRetry, prepareVideoSources, rerunSourceSceneAnalysis, revokePreparedVideoSources, selectSceneRetrySources } from "./studio/mediaUpload";
import type { VideoSceneUpdate } from "./studio/mediaUpload";
import { buildEditPlanPreviewSegments, normalizeStoryEditSettings, type EditPlanPreviewSegment, type MusicVideoProject } from "./studio/musicVideoProject";
import { selectStorySectionCandidate } from "./studio/musicVideoProjectSelection";
import { buildAutoShaderCues, describeMusicVideoShaderPreset, MUSIC_VIDEO_SHADER_PRESETS, type ShaderEffectCue } from "./studio/shaderEffectPlan";
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
  type RuntimeStudioProjectDraft,
} from "./studio/projectPersistence";
import type { StudioProjectSummary } from "@/lib/studioProjectStore";
import type { GeneratedStudioAsset } from "./studio/generatedAssets";
import { createLocalReferenceAsset, uploadReferenceAssetToRustFs, type ReferenceAsset, type ReferenceAssetRole } from "./studio/referenceAssets";
import { BrowserPreviewPlayer, createPreviewPlayerState, type PreviewPlayerState, type PreviewSegment } from "./studio/previewPlayer";
import { ProcessActionBar } from "./studio/ProcessActionBar";
import { buildReadout } from "./studio/readout";
import { ComposeTab } from "./studio/panels/ComposeTab";
import { IngestTab } from "./studio/panels/IngestTab";
import { GenerateTab } from "./studio/panels/GenerateTab";
import { JoinTab } from "./studio/panels/JoinTab";
import { RampTab } from "./studio/panels/RampTab";
import { MatchTab, type MatchMode } from "./studio/panels/MatchTab";
import { SplitTab } from "./studio/panels/SplitTab";
import { createDefaultStoryTabState, StoryTab } from "./studio/panels/StoryTab";
import { StudioHeader } from "./studio/StudioHeader";
import { StudioAudioLane } from "./studio/StudioAudioLane";
import { StudioRightPanel } from "./studio/StudioRightPanel";
import { StudioSidebar } from "./studio/StudioSidebar";
import { StudioStatusBar } from "./studio/StudioStatusBar";
import { buildPipelineState } from "./studio/studioPipeline";
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
import type {
  BeatJoinAnalysis,
  ColorGradient,
  JoinClip,
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
  const [matchMode, setMatchMode] = useState<MatchMode>("semantic");
  const [matchOnsetDensity, setMatchOnsetDensity] = useState(65);
  const [matchLyricCueBlend, setMatchLyricCueBlend] = useState(60);
  const [matchLyricMergeWindow, setMatchLyricMergeWindow] = useState(3.0);

  const [joinClipStates, setJoinClipStates] = useState<Record<number, boolean>>({});

  const [minDur] = useState(0.12);
  const [maxDur] = useState(0.8);
  const [energyResp] = useState(1.5);
  const [chaos] = useState(0.35);
  const [onsetBoost] = useState(0.6);
  const [energyReactive] = useState(true);
  const [lowEnergyRange] = useState(0.36);
  const [highEnergyRange] = useState(0.68);
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
  const [committedBeatSplit, setCommittedBeatSplit] = useState<{
    segments: SourceTimelineSegment[];
    signature: string;
    committedAt: string;
  } | null>(null);
  const [storyState, setStoryState] = useState(createDefaultStoryTabState);
  const [musicVideoProject, setMusicVideoProject] = useState<MusicVideoProject | null>(null);
  const [captionMode, setCaptionMode] = useState<SceneCaptionMode>("smart");
  const [referenceAssets, setReferenceAssets] = useState<ReferenceAsset[]>([]);
  const [generatedAssets, setGeneratedAssets] = useState<GeneratedStudioAsset[]>([]);
  const [shaderPresetId, setShaderPresetId] = useState(MUSIC_VIDEO_SHADER_PRESETS[0].id);
  const [finalExportStatus, setFinalExportStatus] = useState("Final export waits for a generated story preview and master audio.");
  const [finalExportError, setFinalExportError] = useState<string | null>(null);
  const [finalExportUrl, setFinalExportUrl] = useState<string | null>(null);
  const [finalExportName, setFinalExportName] = useState<string | null>(null);
  const [finalExportCueCount, setFinalExportCueCount] = useState(0);
  const [isFinalExporting, setIsFinalExporting] = useState(false);
  const [isShaderCaptureExporting, setIsShaderCaptureExporting] = useState(false);
  const [draftStatus, setDraftStatus] = useState("Project draft autosaves every 5 minutes after changes.");
  const [draftRestored, setDraftRestored] = useState(false);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeProjectName, setActiveProjectName] = useState("Untitled project");
  const pendingAutosaveRef = useRef<PendingStudioAutosave | null>(null);
  const autosaveInFlightRef = useRef(false);

  const audioFileRef = useRef<File | null>(null);
  const videoFilesByMediaKeyRef = useRef(new Map<string, Blob>());
  const previewPlayerRef = useRef(new BrowserPreviewPlayer({ warmSourceLimit: 4, warmAheadSegments: 8 }));
  const [browserPreviewState, setBrowserPreviewState] = useState<PreviewPlayerState>(createPreviewPlayerState);
  const [isBrowserPreviewActive, setIsBrowserPreviewActive] = useState(false);
  const [isPreviewExpanded, setIsPreviewExpanded] = useState(false);
  const [useSourceAudio, setUseSourceAudio] = useState(false);
  const [retainedBrowserPreviewSegments, setRetainedBrowserPreviewSegments] = useState<PreviewSegment[]>([]);
  const [retainedPreviewEffectCues, setRetainedPreviewEffectCues] = useState<ShaderEffectCue[]>([]);
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
        setDraftStatus(activeId ? "Restored saved project from RustFS." : "Restored local draft saved from this browser.");
        setDraftRestored(true);
      })
      .catch((error) => {
        console.warn("[Studio] Could not restore local project draft", error);
        if (!cancelled) {
          setDraftStatus("Could not restore the local project draft; starting fresh.");
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
        captionSettings: buildSceneCaptionSettings(captionMode, beatJoinAnalysis, storyState),
        workflowUiSettings: {
          activeTab: tab,
          splitMode,
          matchMode,
          matchOnsetDensity,
          matchLyricCueBlend,
          matchLyricMergeWindow,
          colorGradient,
          shaderPresetId,
          useSourceAudio,
          isPreviewExpanded,
        },
      },
    };
  }, [activeProjectId, activeProjectName, beatJoinAnalysis, captionMode, colorGradient, draftRestored, generatedAssets, isPreviewExpanded, matchLyricCueBlend, matchLyricMergeWindow, matchMode, matchOnsetDensity, musicVideoProject, referenceAssets, shaderPresetId, splitMode, storyState, tab, useSourceAudio, videoSources]);

  useEffect(() => {
    if (!draftRestored) return;

    const flushPendingAutosave = async () => {
      if (autosaveInFlightRef.current) return;
      const pending = pendingAutosaveRef.current;
      if (!pending) return;

      pendingAutosaveRef.current = null;
      autosaveInFlightRef.current = true;
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
        if (draft) {
          setDraftStatus(`Autosaved ${pending.projectId ? "saved project" : "local draft"} · ${new Date(draft.savedAt).toLocaleTimeString()}`);
        }
      } catch (error) {
        if (!pendingAutosaveRef.current) pendingAutosaveRef.current = pending;
        console.warn("[Studio] Could not autosave local project draft", error instanceof Error ? error : String(error));
        setDraftStatus("Autosave unavailable for this browser session; it will retry in 5 minutes.");
      } finally {
        autosaveInFlightRef.current = false;
      }
    };

    const saveTimer = window.setInterval(() => {
      void flushPendingAutosave();
    }, STUDIO_AUTOSAVE_INTERVAL_MS);
    return () => window.clearInterval(saveTimer);
  }, [draftRestored]);

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
    setVideoSources(draft.videoSources);
    setVideoStatus(draft.videoSources.length
      ? `Restored ${draft.videoSources.length} clip${draft.videoSources.length === 1 ? "" : "s"} from durable storage.`
      : "Upload one or more video clips to begin.");
    setStoryState({
      ...createDefaultStoryTabState(),
      ...draft.storyState,
      editSettings: normalizeStoryEditSettings(draft.storyState.editSettings),
    });
    setCaptionMode(draft.captionSettings?.mode ?? "smart");
    setMusicVideoProject(draft.musicVideoProject);
    setReferenceAssets(draft.referenceAssets ?? []);
    setGeneratedAssets(draft.generatedAssets ?? []);
    const workflowUi = draft.workflowUiSettings;
    if (workflowUi?.activeTab && NAV.some((item) => item.key === workflowUi.activeTab)) setTab(workflowUi.activeTab);
    if (workflowUi?.splitMode) setSplitMode(workflowUi.splitMode);
    if (isMatchMode(workflowUi?.matchMode)) setMatchMode(workflowUi.matchMode);
    if (workflowUi?.colorGradient) setColorGradient(workflowUi.colorGradient);
    if (workflowUi?.matchOnsetDensity !== undefined) setMatchOnsetDensity(workflowUi.matchOnsetDensity);
    if (workflowUi?.matchLyricCueBlend !== undefined) setMatchLyricCueBlend(workflowUi.matchLyricCueBlend);
    if (workflowUi?.matchLyricMergeWindow !== undefined) setMatchLyricMergeWindow(workflowUi.matchLyricMergeWindow);
    if (workflowUi?.shaderPresetId && MUSIC_VIDEO_SHADER_PRESETS.some((preset) => preset.id === workflowUi.shaderPresetId)) {
      setShaderPresetId(workflowUi.shaderPresetId as (typeof MUSIC_VIDEO_SHADER_PRESETS)[number]["id"]);
    }
    if (workflowUi?.useSourceAudio !== undefined) setUseSourceAudio(workflowUi.useSourceAudio);
    if (workflowUi?.isPreviewExpanded !== undefined) setIsPreviewExpanded(workflowUi.isPreviewExpanded);
    setFinalExportUrl(null);
    setFinalExportName(null);
    setDone(false);
  }

  function handleProjectSelected(project: StudioProjectSummary, draft: RuntimeStudioProjectDraft) {
    applyRestoredProjectDraft(draft);
    setActiveProjectId(project.id);
    setActiveProjectName(project.name);
    setDraftStatus(`Loaded ${project.name} from RustFS.`);
  }

  function handleProjectSaved(project: StudioProjectSummary) {
    setActiveProjectId(project.id);
    setActiveProjectName(project.name);
    setDraftStatus(`Saved ${project.name} to RustFS.`);
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
      }),
    [beatJoinAnalysis?.sourceLabel, clipDur, sensitivity, sourceClips, splitMode],
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
  const workingBeatSplitSegments = committedBeatSplit?.segments ?? beatSplitSegments;
  const isCommittedBeatSplitCurrent = committedBeatSplit?.signature === beatSplitSignature;
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
        const source = videoSources[segment.sourceClipIds[0] ?? -1];
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

  const handleJoinClips: Dispatch<SetStateAction<JoinClip[]>> = (value) => {
    setJoinClipStates((previous) => {
      const current = Array.from({ length: beatSplitClipCount }, (_, index) => ({
        id: index,
        on: previous[index] ?? true,
      }));
      const next = typeof value === "function" ? value(current) : value;

      return next.reduce<Record<number, boolean>>((accumulator, clip) => {
        if (clip.id >= 0 && clip.id < beatSplitClipCount) {
          accumulator[clip.id] = clip.on;
        }
        return accumulator;
      }, {});
    });
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
              return remapVideoSourceId(
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
        buildSceneCaptionSettings(captionMode, beatJoinAnalysis, storyState),
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
          const nextSources =
            mode === "append"
              ? [...currentSources, ...uniquePrepared].map((source, index) => remapVideoSourceId(source, index))
              : uniquePrepared.map((source, index) => remapVideoSourceId(source, index));

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
      const nextSources = currentSources
        .filter((source) => source.id !== sourceId)
        .map((source, index) => remapVideoSourceId(source, index));

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
            return remapVideoSourceId(
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
      const captionSettings = buildSceneCaptionSettings(captionMode, beatJoinAnalysis, storyState);
      const maxRounds = 3;
      let pending = targets;

      for (let round = 1; round <= maxRounds && pending.length; round += 1) {
        if (round > 1) {
          setVideoStatus(`Retrying ${pending.length} clip${pending.length === 1 ? "" : "s"} with missed captions (round ${round}/${maxRounds})...`);
          await new Promise((resolve) => setTimeout(resolve, 5_000 * (round - 1)));
        }

        const queue = [...pending];
        await Promise.all(
          Array.from({ length: Math.min(2, queue.length) }, async () => {
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

  async function handleReferenceAssetUpload(role: ReferenceAssetRole, files: File[]) {
    const file = files.find((candidate) => candidate.type.startsWith("image/"));
    if (!file) return;

    const previewUrl = URL.createObjectURL(file);
    const localAsset = createLocalReferenceAsset({ role, file, previewUrl });

    setReferenceAssets((currentAssets) => {
      for (const current of currentAssets.filter((asset) => asset.role === role && asset.previewUrl.startsWith("blob:"))) {
        URL.revokeObjectURL(current.previewUrl);
      }
      return [...currentAssets.filter((asset) => asset.role !== role), localAsset];
    });

    try {
      const storage = await uploadReferenceAssetToRustFs(file, role);
      setReferenceAssets((currentAssets) => currentAssets.map((asset) => asset.id === localAsset.id ? { ...asset, ...storage, previewUrl: storage.storageUrl ?? asset.previewUrl } : asset));
      if (previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Reference upload failed";
      setReferenceAssets((currentAssets) => currentAssets.map((asset) => asset.id === localAsset.id ? { ...asset, storageStatus: "failed", storageError: message } : asset));
    }
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

    if ((tab === "story" || tab === "compose" || tab === "shuffle" || tab === "generate" || tab === "join" || tab === "beatjoin") && browserPreviewSegments.length > 0) {
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
      const audioFile = await resolveMasterAudioFile(beatJoinAnalysis, audioFileRef.current);
      const uniqueVideoUrls = [...new Set(storyPreviewSegments.map((segment) => segment.videoUrl))];
      const videoUrlIndex = new Map(uniqueVideoUrls.map((url, index) => [url, index]));

      setProgress(20);
      setPreviewState((current) => updateSectionRecomputeProgress(current, { requestKey, progress: 20 }));

      const sourceFiles = await Promise.all(uniqueVideoUrls.map((url, index) => fetchMediaUrlAsFile(url, `source${index}.mp4`, "video/mp4")));
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

      const form = new FormData();
      form.set("audio", audioFile);
      sourceFiles.forEach((file, index) => form.set(`file:${index}`, file));
      form.set("segments", JSON.stringify(segments));
      form.set("beats", JSON.stringify(beatJoinAnalysis.beats));
      form.set("lyricChunks", JSON.stringify(musicVideoProject.lyricChunks));
      form.set("shaderPresetId", shaderPresetId);
      form.set("requestKey", requestKey);

      setProgress(45);
      setFinalExportStatus(`Rendering MP4 with ${MUSIC_VIDEO_SHADER_PRESETS.find((preset) => preset.id === shaderPresetId)?.label ?? shaderPresetId} shader cues...`);
      setPreviewState((current) => updateSectionRecomputeProgress(current, { requestKey, progress: 45 }));

      const response = await fetch("/api/export/final", { method: "POST", body: form });
      const payload = (await response.json()) as {
        success?: boolean;
        error?: string;
        runId?: string;
      };

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
      setFinalExportCueCount(browserPreviewEffectCues.length);
      setFinalExportStatus(`WebGPU MP4 ready · ${(asset.duration || 0).toFixed(1)}s · ${browserPreviewEffectCues.length} live shader cues captured.`);
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
    setRetainedPreviewEffectCues(browserPreviewEffectCues);
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

      const sourceFiles = await Promise.all(uniqueVideoUrls.map(async (url, index) => {
        const response = await fetch(url);
        const blob = await response.blob();
        const ext = blob.type.includes("mp4") ? ".mp4" : blob.type.includes("webm") ? ".webm" : ".mp4";
        return new File([blob], `source${index}${ext}`, { type: blob.type || "video/mp4" });
      }));

      const segments = browserPreviewSegments.map((seg) => ({
        startTime: seg.startTime,
        endTime: seg.endTime,
        sourceIndex: videoUrlIndex.get(seg.videoUrl) ?? 0,
      }));

      const gatewayForm = new FormData();
      gatewayForm.set("file", sourceFiles[0]);
      sourceFiles.forEach((file, index) => {
        gatewayForm.set(`file:${index}`, file);
      });
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

  function handleCommitBeatSplit() {
    if (!beatSplitSegments.length) return;

    setCommittedBeatSplit({
      segments: beatSplitSegments.map((segment) => ({
        ...segment,
        sourceClipIds: [...segment.sourceClipIds],
      })),
      signature: beatSplitSignature,
      committedAt: new Date().toISOString(),
    });
    setJoinClipStates(Object.fromEntries(beatSplitSegments.map((_, index) => [index, true])) as Record<number, boolean>);
    setActiveClip(0);
    setDone(true);
    setProgress(100);
  }

  function handleCommitSplit() {
    if (!splitSegments.length) return;

    setCommittedBeatSplit({
      segments: splitSegments.map((segment) => ({
        ...segment,
        sourceClipIds: [...segment.sourceClipIds],
      })),
      signature: splitSignature,
      committedAt: new Date().toISOString(),
    });
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

  const readout = useMemo(
    () =>
      buildReadout({
        tab,
        clipDur,
        splitSegmentCount: splitSegments.length,
        bpm,
        barsPerSeg,
        beatSplitSegmentCount: beatSplitSegments.length,
        shuffleMode,
        minScore,
        lookahead,
        joinClips,
        minDur,
        maxDur,
        lowEnergyRange,
        highEnergyRange,
        beatJoinReady: beatJoinAnalysis !== null,
        hasVideoSource: videoSources.length > 0,
        chaos,
        onsetBoost,
        rampPreset,
        minSpeed,
        maxSpeed,
        rampDur,
      }),
    [
      tab,
      clipDur,
      splitSegments.length,
      bpm,
      barsPerSeg,
      beatSplitSegments.length,
      shuffleMode,
      minScore,
      lookahead,
      joinClips,
      minDur,
      maxDur,
      lowEnergyRange,
      highEnergyRange,
      beatJoinAnalysis,
      videoSources.length,
      chaos,
      onsetBoost,
      rampPreset,
      minSpeed,
      maxSpeed,
      rampDur,
    ]
  );

  const tabLabel = NAV.find((n) => n.key === tab)?.label ?? "";
  const tabSub = NAV.find((n) => n.key === tab)?.sub ?? "";
  const audioPreviewSubtitle = useMemo(() => {
    switch (tab) {
      case "beatsplit":
        return `Master Audio Track · ${beatSplitMode === "beats" ? "Legacy Beat Mode" : "Legacy Onset Mode"}`;
      case "story":
        return "Master Audio Track · Story/Edit Plan";
      case "compose":
        return "Master Audio Track · Preview / Export";
      case "beatjoin":
        return "Master Audio Track · Legacy Reactive Join";
      case "shuffle":
        return `Master Audio Track · Match ${shuffleMode}`;
      case "generate":
        return "Master Audio Track · Fill gaps with generated footage";
      case "split":
        return `Master Audio Track · Split ${formatSplitModeLabel(splitMode)}`;
      case "join":
        return "Master Audio Track · Join Timeline";
      case "ramp":
        return "Master Audio Track · Transitions / Effects";
      default:
        return "Master Audio Track · Studio Timeline";
    }
  }, [beatSplitMode, shuffleMode, splitMode, tab]);
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

  const arrangementSegments = useMemo<ArrangementSegment[]>(() => {
    if (tab !== "beatjoin" || !beatJoinAnalysis) return [];
    return buildArrangementSegments({
      analysis: beatJoinAnalysis,
      clipOrder: effectiveClipOrder,
      minDur,
      maxDur,
      energyResp,
      energyReactive,
      lowEnergyRange,
      highEnergyRange,
      onsetBoost,
      chaos,
    });
  }, [tab, beatJoinAnalysis, effectiveClipOrder, minDur, maxDur, energyResp, energyReactive, lowEnergyRange, highEnergyRange, onsetBoost, chaos]);

  const storyPreviewSegments = useMemo<EditPlanPreviewSegment[]>(
    () =>
      storyState.storyGenerated
        ? buildEditPlanPreviewSegments({
            project: musicVideoProject,
            videoSources,
            editSettings: storyState.editSettings,
          })
        : [],
    [musicVideoProject, storyState.editSettings, storyState.storyGenerated, videoSources],
  );
  const shaderPresetSummary = useMemo(() => describeMusicVideoShaderPreset(shaderPresetId), [shaderPresetId]);

  const browserPreviewSegments = useMemo<PreviewSegment[]>(() => {
    if (tab === "story" || tab === "compose" || tab === "generate") {
      return storyPreviewSegments;
    }

    if (tab === "shuffle" || tab === "join") {
      return effectiveClipOrder
        .map((clipId) => {
          const segment = workingBeatSplitSegments[clipId];
          if (!segment) return null;
          const sourceClipId = segment.sourceClipIds[0] ?? -1;
          const source = videoSources[sourceClipId];
          if (!source) return null;
          const offset = getSourceClipTimeOffset(sourceClips, sourceClipId);
          return {
            videoUrl: source.videoUrl,
            startTime: Math.max(0, segment.start - offset),
            endTime: Math.max(0, segment.end - offset),
            label: `SEG_${String(clipId + 1).padStart(2, "0")}`,
          };
        })
        .filter((s): s is PreviewSegment => s !== null && s.videoUrl !== undefined && s.endTime > s.startTime);
    }

    if (tab === "beatjoin" && arrangementSegments.length > 0) {
      return arrangementSegments
        .map((segment) => {
          const source = videoSources[segment.clipId];
          if (!source) return null;
          const offset = getSourceClipTimeOffset(sourceClips, segment.clipId);
          return {
            videoUrl: source.videoUrl,
            startTime: Math.max(0, segment.start - offset),
            endTime: Math.max(0, segment.end - offset),
            label: segment.detailLabel,
          };
        })
        .filter((s): s is PreviewSegment => s !== null && s.videoUrl !== undefined && s.endTime > s.startTime);
    }

    return [];
  }, [tab, storyPreviewSegments, effectiveClipOrder, workingBeatSplitSegments, videoSources, sourceClips, arrangementSegments]);

  const browserPreviewEffectCues = useMemo(
    () =>
      (tab === "story" || tab === "compose") && beatJoinAnalysis && musicVideoProject && storyPreviewSegments.length > 0
        ? buildAutoShaderCues({
            segments: storyPreviewSegments,
            beats: beatJoinAnalysis.beats,
            lyricChunks: musicVideoProject.lyricChunks,
            presetId: shaderPresetId,
          })
        : [],
    [beatJoinAnalysis, musicVideoProject, shaderPresetId, storyPreviewSegments, tab],
  );

  useEffect(() => {
    if (browserPreviewEffectCues.length > 0) {
      lastPreviewEffectCuesRef.current = browserPreviewEffectCues;
    }
  }, [browserPreviewEffectCues]);

  useEffect(() => {
    if ((tab !== "story" && tab !== "compose") || browserPreviewSegments.length === 0) return;
    setRetainedBrowserPreviewSegments(browserPreviewSegments);
    setRetainedPreviewEffectCues(browserPreviewEffectCues);
  }, [browserPreviewEffectCues, browserPreviewSegments, tab]);

  const displayedBrowserPreviewSegments = (tab === "story" || tab === "compose") && browserPreviewSegments.length > 0
    ? browserPreviewSegments
    : retainedBrowserPreviewSegments.length > 0
      ? retainedBrowserPreviewSegments
      : browserPreviewSegments.length > 0
        ? browserPreviewSegments
        : previewPlayerRef.current.getSegments();
  const displayedPreviewEffectCues = (tab === "story" || tab === "compose") && browserPreviewEffectCues.length > 0
    ? browserPreviewEffectCues
    : retainedPreviewEffectCues.length > 0
      ? retainedPreviewEffectCues
      : browserPreviewEffectCues.length > 0
        ? browserPreviewEffectCues
        : lastPreviewEffectCuesRef.current;

  const ingestStats = useMemo(() => {
    const sceneCount = videoSources.reduce((total, source) => total + (source.scenes?.length ?? 0), 0);
    const captionReady = videoSources.reduce((total, source) => total + (source.scenes?.filter((scene) => Boolean(scene.caption)).length ?? 0), 0);
    const captionTotal = sceneCount;
    return { sceneCount, captionReady, captionTotal };
  }, [videoSources]);

  const pipeline = useMemo(() => {
    const timelineItems = musicVideoProject?.editPlan.timelineItems ?? [];
    return buildPipelineState({
      activeTab: tab,
      hasAudioAnalysis: beatJoinAnalysis !== null,
      hasTranscript: Boolean(storyState.transcriptSummary),
      videoCount: videoSources.length,
      sceneCount: ingestStats.sceneCount,
      captionReadyCount: ingestStats.captionReady,
      captionTotalCount: ingestStats.captionTotal,
      storyGenerated: storyState.storyGenerated,
      editSlotCount: timelineItems.length,
      matchedSlotCount: timelineItems.filter((item) => item.videoMomentId).length,
      gapSlotCount: timelineItems.filter((item) => !item.videoMomentId || (item.semanticMatch?.score ?? 0) < 0.45).length,
      storySegmentCount: storyPreviewSegments.length,
      hasCommittedSplit: Boolean(committedBeatSplit),
      shaderPresetLabel: shaderPresetSummary.preset.label,
      finalExportReady: Boolean(finalExportUrl),
    });
  }, [
    tab,
    beatJoinAnalysis,
    storyState.transcriptSummary,
    storyState.storyGenerated,
    videoSources.length,
    ingestStats,
    musicVideoProject,
    storyPreviewSegments.length,
    committedBeatSplit,
    shaderPresetSummary.preset.label,
    finalExportUrl,
  ]);

  const persistableProjectDraft = useMemo(() => createPersistableStudioProjectDraft({
    analysis: beatJoinAnalysis,
    videoSources,
    storyState,
    musicVideoProject,
    referenceAssets,
    generatedAssets,
    captionSettings: buildSceneCaptionSettings(captionMode, beatJoinAnalysis, storyState),
    workflowUiSettings: {
      activeTab: tab,
      splitMode,
      matchMode,
      matchOnsetDensity,
      matchLyricCueBlend,
      matchLyricMergeWindow,
      colorGradient,
      shaderPresetId,
      useSourceAudio,
      isPreviewExpanded,
    },
  }), [beatJoinAnalysis, captionMode, colorGradient, generatedAssets, isPreviewExpanded, matchLyricCueBlend, matchLyricMergeWindow, matchMode, matchOnsetDensity, musicVideoProject, referenceAssets, shaderPresetId, splitMode, storyState, tab, useSourceAudio, videoSources]);

  useEffect(() => {
    if (tab === "beatsplit" && committedBeatSplit && !isCommittedBeatSplitCurrent) {
      setDone(false);
    }
  }, [committedBeatSplit, isCommittedBeatSplitCurrent, tab]);

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
    setTab(t);
    resetPreparedPreview({ preserveBrowserPreview: true });
  }

  const needsVideoSource = tab !== "beatjoin" && tab !== "story" && tab !== "compose";
  const actionState = deriveActionDisabledState({
    needsVideoSource,
    videoSourceCount: videoSources.length,
    requiresAudioSource: tab === "beatjoin",
    hasAudioSource: beatJoinAnalysis !== null,
    activeRequestKey: previewState.activeRequestKey,
  });
  const storyActionReason = !storyState.storyGenerated
    ? "Generate story first."
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

  return (
    <div
      className="flex h-screen overflow-hidden bg-[#0a0a0a] text-[#c0c0c0] antialiased select-none"
      style={{ fontFamily: "'Inter','SF Pro Display',system-ui,sans-serif" }}
    >
      <StudioSidebar
        tab={tab}
        stages={pipeline.stages}
        collapsed={isSidebarCollapsed}
        onToggleCollapsed={() => setIsSidebarCollapsed((current) => !current)}
        sessionStats={{
          audioLabel: beatJoinAnalysis?.sourceLabel ?? null,
          videoCount: videoSources.length,
          sceneCount: ingestStats.sceneCount,
          captionReadyCount: ingestStats.captionReady,
          captionTotalCount: ingestStats.captionTotal,
        }}
        onSelectTab={handleSelectTab}
      />

      <div className="flex flex-1 flex-col overflow-hidden">
        <StudioHeader
          tabLabel={tabLabel}
          tabSub={tabSub}
          stepLabel={pipeline.stages.find((stage) => stage.active) ? `Step ${pipeline.stages.find((stage) => stage.active)!.step} of ${pipeline.stages.length}` : null}
          songLabel={beatJoinAnalysis?.sourceLabel ?? null}
          songDuration={beatJoinAnalysis?.duration ?? null}
          projectDraft={persistableProjectDraft}
          activeProjectId={activeProjectId}
          activeProjectName={activeProjectName}
          onNewProject={handleNewProject}
          onProjectSelected={handleProjectSelected}
          onProjectSaved={handleProjectSaved}
        />

        <div className="flex flex-1 flex-col overflow-hidden">
          <>
          <main className="flex-1 overflow-y-auto p-4 space-y-3">
            <StudioAudioLane
              analysis={beatJoinAnalysis}
              isPreparingAudio={isPreparingAudio}
              audioProgress={audioProgress}
              audioStatus={audioStatus}
              audioError={audioError}
              bpmFallback={bpm}
              subtitle={audioPreviewSubtitle}
              onAudioUpload={handleAudioUpload}
              onPlayheadChange={setAudioPreviewPlayhead}
            />

            <div className="rounded-[2px] border border-[#171717] bg-[#080808] px-2 py-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {pipeline.stages.map((stage) => (
                  <button
                    key={stage.key}
                    type="button"
                    onClick={() => handleSelectTab(stage.key)}
                    className={`min-w-[92px] flex-1 rounded-[2px] border px-2 py-1.5 text-left transition-colors ${
                      stage.active
                        ? "border-[#e05c00] bg-[#120b06]"
                        : stage.isNext
                          ? "border-[#7a3a10] bg-[#0d0803] hover:border-[#e05c00]"
                          : stage.ready
                            ? "border-[#202020] bg-[#0a0a0a] hover:border-[#333]"
                            : "border-[#151515] bg-[#070707] hover:border-[#242424]"
                    }`}
                    title={`${stage.label}: ${stage.status}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-[8px] uppercase tracking-[0.16em] ${stage.active ? "text-[#e05c00]" : "text-[#555]"}`}>
                        <span className="mr-1 font-mono text-[#3a3a3a]">{stage.step}</span>
                        {stage.label}
                        {stage.isNext && !stage.active ? <span className="ml-1 text-[#c07a3f]">· next</span> : null}
                      </span>
                      <span className={`h-1.5 w-1.5 rounded-full ${stage.ready ? "bg-[#3a8a3a]" : "bg-[#3d3d3d]"}`} />
                    </div>
                    <div className="mt-[2px] truncate font-mono text-[9px] text-[#777]">{stage.status}</div>
                  </button>
                ))}
              </div>
            </div>

            {tab === "review" && (
              <IngestTab
                analysis={beatJoinAnalysis}
                audioStatus={audioStatus}
                audioError={audioError}
                isPreparingAudio={isPreparingAudio}
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
                onSelectStory={() => handleSelectTab("story")}
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
                onAppendVideos={handleAppendVideos}
                onRemoveVideo={handleRemoveVideo}
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
                matchMode={matchMode}
                onsetDensity={matchOnsetDensity}
                lyricCueBlend={matchLyricCueBlend}
                lyricMergeWindow={matchLyricMergeWindow}
                colorGradient={colorGradient}
                videoSources={videoSources}
                onMatchMode={setMatchMode}
                onOnsetDensity={setMatchOnsetDensity}
                onLyricCueBlend={setMatchLyricCueBlend}
                onLyricMergeWindow={setMatchLyricMergeWindow}
                onColorGradient={setColorGradient}
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
                referenceAssets={referenceAssets}
                persistedGeneratedAssets={generatedAssets}
                onGeneratedAsset={(asset) => setGeneratedAssets((current) => [asset, ...current.filter((candidate) => candidate.id !== asset.id)])}
                onSelectMatch={() => handleSelectTab("shuffle")}
                onSelectJoin={() => handleSelectTab("join")}
              />
            )}

            {tab === "join" && (
              <JoinTab
                joinClips={joinClips}
                clipOrder={effectiveClipOrder}
                segmentPreviews={segmentPreviews}
                shuffleMode={shuffleMode}
                isUsingCommittedSplit={Boolean(committedBeatSplit)}
                activeClip={beatActiveClip}
                onJoinClips={handleJoinClips}
                onActiveClip={setActiveClip}
              />
            )}

            {tab === "ramp" && (
              <RampTab
                playhead={playhead}
                bpm={bpm}
                analysis={beatJoinAnalysis}
                segmentPreviews={segmentPreviews}
                isUsingCommittedSplit={Boolean(committedBeatSplit)}
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

            {tab !== "review" ? (
              <ProcessActionBar
                tab={tab}
                done={done}
                isRunning={isRunning || isFinalExporting || isShaderCaptureExporting}
                progress={progress}
                disabled={actionDisabled}
                disabledReason={actionDisabledReason}
                processingLabel={isFinalExporting ? "Rendering Final MP4" : `Preparing Preview · ${previewState.stage}`}
                completedLabel={
                  tab === "split"
                    ? `Split Committed — ${committedBeatSplit?.segments.length ?? splitSegments.length} cuts`
                    : tab === "beatsplit"
                    ? `Legacy Split Committed — ${committedBeatSplit?.segments.length ?? beatSplitSegments.length} segments`
                    : completedLabel
                }
                onRun={tab === "split" ? handleCommitSplit : tab === "beatsplit" ? handleCommitBeatSplit : () => void runProcess()}
                onResetDone={resetPreparedPreview}
              />
            ) : null}

          </main>

          <StudioRightPanel
            isDockCollapsed={isDockCollapsed}
            onToggleDockCollapsed={() => setIsDockCollapsed((current) => !current)}
            readout={readout}
            tab={tab}
            shuffleMode={shuffleMode}
            manifestSegmentCount={manifestSegments.length}
            rankedSegmentIds={manifestRankingPreview.ids}
            previewAssetKey={previewState.currentAssetKey}
            previewAssetUrl={previewAssetUrl}
            previewPlayer={previewPlayerRef.current}
            browserPreviewSegments={displayedBrowserPreviewSegments}
            browserPreviewState={browserPreviewState}
            isBrowserPreviewActive={isBrowserPreviewActive}
            previewEffectCues={displayedPreviewEffectCues}
            audioTimeline={beatJoinAnalysis}
            isPreviewExpanded={isPreviewExpanded}
            onTogglePreviewExpanded={() => setIsPreviewExpanded((current) => !current)}
            useSourceAudio={useSourceAudio}
            onUseSourceAudioChange={setUseSourceAudio}
            finalExportStatus={finalExportStatus}
            finalExportUrl={finalExportUrl}
            finalExportName={finalExportName}
            finalExportCueCount={finalExportCueCount}
            finalExportDisabledReason={finalExportDisabledReason}
            isFinalExporting={isFinalExporting}
            isShaderCaptureExporting={isShaderCaptureExporting}
            onFinalExport={() => void runFinalExport()}
            onWebGpuExport={() => void runWebGpuShaderCaptureExport()}
            audioStatus={audioStatus}
            videoStatus={videoStatus}
            draftStatus={draftStatus}
            nextHint={pipeline.nextHint}
          />
          </>
        </div>

        <StudioStatusBar
          previewStage={previewState.stage}
          activeRequestKey={previewState.activeRequestKey}
          assetKey={previewState.currentAssetKey}
          statusLabel={previewStatusLabel}
          draftStatus={draftStatus}
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

function isMatchMode(value: unknown): value is MatchMode {
  return value === "semantic" || value === "story" || value === "motion" || value === "energy" || value === "color";
}

function buildSceneCaptionSettings(
  mode: SceneCaptionMode,
  analysis: BeatJoinAnalysis | null,
  storyState: ReturnType<typeof createDefaultStoryTabState>,
) {
  const transcript = storyState.transcriptSummary?.transcript ?? "";
  return {
    mode,
    context: {
      songTitle: analysis?.sourceLabel,
      vocalStemName: storyState.vocalStemName || undefined,
      lyricExcerpt: transcript ? transcript.slice(0, 900) : undefined,
      storySummary: storyState.transcriptSummary?.summary || undefined,
      storyPrompts: storyState.storyBeats
        .map((beat) => beat.prompt)
        .filter(Boolean)
        .slice(0, 10),
      projectIntent: "Music-video source footage captioning for later semantic matching against lyrics, story sections, action, mood, and setting.",
    },
  };
}

function remapVideoSourceId(source: UploadedVideoSource, id: number): UploadedVideoSource {
  return {
    ...source,
    id,
    scenes: source.scenes?.map((scene) => ({ ...scene, sourceClipId: id })),
  };
}

function formatSplitModeLabel(mode: SplitMode) {
  switch (mode) {
    case "scene":
      return "Scene";
    case "beat":
      return "Beat";
    case "onset":
      return "Onset";
    case "scene-beat":
      return "Scene + Beat";
    case "scene-onset":
      return "Scene + Onset";
  }
}

function getSplitModeLockedReason(mode: SplitMode, state: { hasAnalysis: boolean; sceneCount: number }) {
  const needsScenes = mode === "scene" || mode === "scene-beat" || mode === "scene-onset";
  const needsAnalysis = mode === "beat" || mode === "onset" || mode === "scene-beat" || mode === "scene-onset";

  if (needsScenes && state.sceneCount === 0) {
    return "Scene detection must return cuts before this split mode can build.";
  }
  if (needsAnalysis && !state.hasAnalysis) {
    return "Upload and analyze the master song before beat/onset split modes.";
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
  const source = sources[sourceId];
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
