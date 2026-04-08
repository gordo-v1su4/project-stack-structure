"use client";

import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { extractWaveformData, fetchEssentiaAnalysis, parseEssentiaPayload } from "./studio/audioAnalysis";
import { NAV } from "./studio/constants";
import { prepareVideoSources, revokePreparedVideoSources } from "./studio/mediaUpload";
import { ProcessActionBar } from "./studio/ProcessActionBar";
import { buildReadout } from "./studio/readout";
import { BeatJoinTab } from "./studio/panels/BeatJoinTab";
import { BeatSplitTab } from "./studio/panels/BeatSplitTab";
import { JoinTab } from "./studio/panels/JoinTab";
import { RampTab } from "./studio/panels/RampTab";
import { ShuffleTab } from "./studio/panels/ShuffleTab";
import { SplitTab } from "./studio/panels/SplitTab";
import { StudioHeader } from "./studio/StudioHeader";
import { StudioAudioLane } from "./studio/StudioAudioLane";
import { StudioRightPanel } from "./studio/StudioRightPanel";
import { StudioSidebar } from "./studio/StudioSidebar";
import { StudioStatusBar } from "./studio/StudioStatusBar";
import { buildShuffleQueue } from "./studio/shuffleQueue";
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
import { buildAudioDrivenSegments, buildBeatSegments, buildSourceClipSpans, buildStandardSegments } from "./studio/sourceTimeline";
import type { SourceTimelineSegment } from "./studio/sourceTimeline";
import type {
  BeatJoinAnalysis,
  ColorGradient,
  JoinClip,
  RampPreset,
  SegmentPreview,
  ShuffleMode,
  Tab,
  UploadedVideoSource,
} from "./studio/types";

export default function StudioApp() {
  const videoSourcesRef = useRef<UploadedVideoSource[]>([]);
  const [tab, setTab] = useState<Tab>("split");
  const [playhead, setPlayhead] = useState(0.08);
  const [audioPreviewPlayhead, setAudioPreviewPlayhead] = useState(0);
  const [activeClip, setActiveClip] = useState(2);

  const [gpu, setGpu] = useState(24);
  const [cpu, setCpu] = useState(11);
  const [vram, setVram] = useState(7.8);

  const [clipDur, setClipDur] = useState(5);
  const [barsPerSeg, setBarsPerSeg] = useState(2);
  const [bpm] = useState(130);
  const [sensitivity, setSensitivity] = useState(68);
  const [beatSplitMode, setBeatSplitMode] = useState<"beats" | "onsets">("beats");
  const [videoSources, setVideoSources] = useState<UploadedVideoSource[]>([]);
  const [videoStatus, setVideoStatus] = useState("Upload one or more video clips to begin.");
  const [videoError, setVideoError] = useState<string | null>(null);
  const [isPreparingVideos, setIsPreparingVideos] = useState(false);
  const [audioStatus, setAudioStatus] = useState("Upload a song to unlock beat sync.");
  const [audioError, setAudioError] = useState<string | null>(null);
  const [isPreparingAudio, setIsPreparingAudio] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0);

  const [shuffleMode, setShuffleMode] = useState<ShuffleMode>("motion");
  const [minScore, setMinScore] = useState(0.5);
  const [lookahead, setLookahead] = useState(3);
  const [keepPct, setKeepPct] = useState(70);
  const [colorGradient, setColorGradient] = useState<ColorGradient>("Sunset");

  const [joinClipStates, setJoinClipStates] = useState<Record<number, boolean>>({});

  const [minDur, setMinDur] = useState(0.12);
  const [maxDur, setMaxDur] = useState(0.8);
  const [energyResp, setEnergyResp] = useState(1.5);
  const [chaos, setChaos] = useState(0.35);
  const [onsetBoost, setOnsetBoost] = useState(0.6);
  const [energyReactive, setEnergyReactive] = useState(true);
  const [lowEnergyRange, setLowEnergyRange] = useState(0.36);
  const [highEnergyRange, setHighEnergyRange] = useState(0.68);
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

  useEffect(() => {
    const id = setInterval(() => setPlayhead((p) => (p >= 0.97 ? 0.02 : p + 0.003)), 80);
    return () => clearInterval(id);
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
    return () => {
      revokePreparedVideoSources(videoSourcesRef.current);
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      setGpu((g) => Math.max(10, Math.min(48, g + (Math.random() - 0.5) * 3)));
      setCpu((c) => Math.max(5, Math.min(28, c + (Math.random() - 0.5) * 2)));
      setVram((v) => Math.max(5, Math.min(14, v + (Math.random() - 0.5) * 0.15)));
    }, 1400);
    return () => clearInterval(id);
  }, []);

  const sourceClips = useMemo(() => buildSourceClipSpans(videoSources), [videoSources]);
  const splitSegments = useMemo(() => buildStandardSegments(sourceClips, clipDur), [sourceClips, clipDur]);
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
  const beatSplitPreviewActiveClip = Math.min(activeClip, Math.max(0, beatSplitSegments.length - 1));
  const beatActiveClip = Math.min(activeClip, Math.max(0, beatSplitClipCount - 1));
  const segmentPreviews = useMemo<SegmentPreview[]>(
    () =>
      workingBeatSplitSegments.map((segment, index) => {
        const source = videoSources[segment.sourceClipIds[0] ?? -1];
        return {
          clipId: index,
          label: `SEG_${String(index + 1).padStart(2, "0")}`,
          duration: segment.duration,
          thumbnailUrl: source?.thumbnailUrl,
          sourceClipIds: segment.sourceClipIds,
          sourceRefLabel: formatSourceRefs(segment.sourceClipIds),
          timeLabel: `${segment.start.toFixed(1)}–${segment.end.toFixed(1)}`,
        };
      }),
    [videoSources, workingBeatSplitSegments]
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
    setVideoError(null);
    setIsPreparingVideos(true);
    setVideoStatus(
      `${mode === "append" ? "Adding" : "Processing"} ${files.length} video clip${files.length === 1 ? "" : "s"}...`,
    );

    try {
      const prepared = await prepareVideoSources(files);
      if (!prepared.length) {
        throw new Error("No readable video files were selected.");
      }

      startTransition(() => {
        setVideoSources((currentSources) => {
          const existingKeys = new Set(currentSources.map(buildVideoSourceKey));
          const uniquePrepared = mode === "append"
            ? prepared.filter((source) => !existingKeys.has(buildVideoSourceKey(source)))
            : prepared;
          const skippedPrepared = mode === "append"
            ? prepared.filter((source) => existingKeys.has(buildVideoSourceKey(source)))
            : [];

          if (skippedPrepared.length) {
            revokePreparedVideoSources(skippedPrepared);
          }

          const nextSources =
            mode === "append"
              ? [...currentSources, ...uniquePrepared].map((source, index) => ({ ...source, id: index }))
              : uniquePrepared.map((source, index) => ({ ...source, id: index }));

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
            mode === "append"
              ? uniquePrepared.length
                ? `Added ${uniquePrepared.length} clip${uniquePrepared.length === 1 ? "" : "s"} · ${nextSources.length} total ready.`
                : `Skipped duplicate clip${skippedPrepared.length === 1 ? "" : "s"} · ${nextSources.length} total ready.`
              : `Loaded ${uniquePrepared.length} clip${uniquePrepared.length === 1 ? "" : "s"} · ${nextSources.length} total ready.`,
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
      const nextSources = currentSources
        .filter((source) => source.id !== sourceId)
        .map((source, index) => ({ ...source, id: index }));

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
      const [{ waveform, duration }, response] = await Promise.all([
        extractWaveformData(file),
        fetchEssentiaAnalysis(file),
      ]);
      const parsed = parseEssentiaPayload({
        payload: response,
        fileName: file.name,
        waveform,
        waveformDuration: duration,
        audioUrl: nextAudioUrl,
      });

      if (!parsed) {
        throw new Error("The upload finished, but no usable beats/onsets/sections came back.");
      }

      startTransition(() => {
        setBeatJoinAnalysis(parsed);
        setCommittedBeatSplit(null);
        setAudioProgress(100);
        setAudioStatus(`Ready · ${parsed.sourceLabel}`);
      });

      if (previousAudioUrl) {
        URL.revokeObjectURL(previousAudioUrl);
      }
    } catch (error) {
      URL.revokeObjectURL(nextAudioUrl);
      const message = error instanceof Error ? error.message : "Unknown analysis error";
      setAudioError(message);
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
        asset?: {
          requestKey: string;
          assetKey: string;
          duration: number;
          generatedAt: string;
        };
      };

      if (!response.ok || !payload.success || !payload.asset) {
        throw new Error(payload.error ?? "Preview generation failed.");
      }

      setProgress(90);
      setPreviewState((current) => updateSectionRecomputeProgress(current, { requestKey, progress: 90 }));
      setPreviewState((current) => markSectionReady(current, payload.asset!));
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

  const readout = useMemo(
    () =>
      buildReadout({
        tab,
        clipDur,
        splitSegmentCount: splitSegments.length,
        gpu,
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
      gpu,
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
        return `Master Audio Track · ${beatSplitMode === "beats" ? "Beat Split" : "Onset Split"}`;
      case "beatjoin":
        return "Master Audio Track · Beat Join";
      case "shuffle":
        return `Master Audio Track · Shuffle ${shuffleMode}`;
      case "join":
        return "Master Audio Track · Standard Join";
      case "ramp":
        return "Master Audio Track · Speed Ramp";
      default:
        return "Master Audio Track · Studio Timeline";
    }
  }, [beatSplitMode, shuffleMode, tab]);
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
    fallbackOrder: shuffleQueue,
  });
  const previewAssetUrl = buildPreviewAssetUrl(previewState.currentAssetKey);

  const pipelineStages = [
    {
      label: "Split",
      status: committedBeatSplit
        ? isCommittedBeatSplitCurrent
          ? `Committed · ${committedBeatSplit.segments.length}`
          : "Stale preview"
        : "Draft",
      active: tab === "beatsplit",
      ready: Boolean(committedBeatSplit && isCommittedBeatSplitCurrent),
    },
    {
      label: "Shuffle",
      status: committedBeatSplit ? shuffleMode : "Waiting for split",
      active: tab === "shuffle",
      ready: Boolean(committedBeatSplit),
    },
    {
      label: "Join",
      status: committedBeatSplit ? `${joinClips.filter((clip) => clip.on).length} active` : "Waiting for split",
      active: tab === "join",
      ready: Boolean(committedBeatSplit),
    },
    {
      label: "Beat Join",
      status: committedBeatSplit && beatJoinAnalysis ? "Ready" : committedBeatSplit ? "Waiting for song" : "Waiting for split",
      active: tab === "beatjoin",
      ready: Boolean(committedBeatSplit && beatJoinAnalysis),
    },
  ];

  useEffect(() => {
    if (tab === "beatsplit" && committedBeatSplit && !isCommittedBeatSplitCurrent) {
      setDone(false);
    }
  }, [committedBeatSplit, isCommittedBeatSplitCurrent, tab]);

  function resetPreparedPreview() {
    setDone(false);
    setProgress(0);
    setPreviewState(createSectionRecomputeState());
  }

  function handleSelectTab(t: Tab) {
    setTab(t);
    resetPreparedPreview();
  }

  const needsVideoSource = tab !== "beatjoin";
  const actionState = deriveActionDisabledState({
    needsVideoSource,
    videoSourceCount: videoSources.length,
    requiresAudioSource: tab === "beatjoin",
    hasAudioSource: beatJoinAnalysis !== null,
    activeRequestKey: previewState.activeRequestKey,
  });
  const actionDisabled = actionState.disabled;
  const actionDisabledReason = actionState.reason ?? "Unavailable";

  const previewStatusLabel = derivePreviewStatusLabel(previewState);
  const completedLabel = deriveCompletedLabel(previewState.currentAssetKey);

  return (
    <div
      className="flex h-screen overflow-hidden bg-[#0a0a0a] text-[#c0c0c0] antialiased select-none"
      style={{ fontFamily: "'Inter','SF Pro Display',system-ui,sans-serif" }}
    >
      <StudioSidebar tab={tab} gpu={gpu} cpu={cpu} vram={vram} onSelectTab={handleSelectTab} />

      <div className="flex flex-1 flex-col overflow-hidden">
        <StudioHeader tabLabel={tabLabel} tabSub={tabSub} playhead={playhead} bpm={bpm} />

        <div className="flex flex-1 overflow-hidden">
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

            <div className="grid gap-2 md:grid-cols-4">
              {pipelineStages.map((stage) => (
                <div
                  key={stage.label}
                  className={`rounded-[2px] border px-3 py-2 ${
                    stage.active
                      ? "border-[#e05c00] bg-[#120b06]"
                      : stage.ready
                        ? "border-[#1f1f1f] bg-[#0b0b0b]"
                        : "border-[#171717] bg-[#090909]"
                  }`}
                >
                  <div className={`text-[9px] uppercase tracking-[0.18em] ${stage.active ? "text-[#e05c00]" : "text-[#505050]"}`}>
                    {stage.label}
                  </div>
                  <div className="mt-1 font-mono text-[10px] text-[#9a9a9a]">{stage.status}</div>
                </div>
              ))}
            </div>

            {tab === "split" && (
              <SplitTab
                playhead={playhead}
                clipDur={clipDur}
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
                onActiveClip={setActiveClip}
              />
            )}

            {tab === "beatsplit" && (
              <BeatSplitTab
                playhead={playhead}
                bpm={bpm}
                barsPerSeg={barsPerSeg}
                splitMode={beatSplitMode}
                analysis={beatJoinAnalysis}
                audioStatus={audioStatus}
                audioError={audioError}
                videoSources={videoSources}
                videoStatus={videoStatus}
                videoError={videoError}
                isPreparingVideos={isPreparingVideos}
                sourceClips={sourceClips}
                segments={beatSplitSegments}
                sensitivity={sensitivity}
                activeClip={beatSplitPreviewActiveClip}
                committedSegmentCount={committedBeatSplit?.segments.length ?? 0}
                isCommittedCurrent={isCommittedBeatSplitCurrent}
                onVideoUpload={handleVideoUpload}
                onAppendVideos={handleAppendVideos}
                onRemoveVideo={handleRemoveVideo}
                onBarsPerSeg={setBarsPerSeg}
                onSensitivity={setSensitivity}
                onSplitMode={setBeatSplitMode}
                onActiveClip={setActiveClip}
              />
            )}

            {tab === "shuffle" && (
              <ShuffleTab
                playhead={playhead}
                bpm={bpm}
                clipCount={joinClips.length}
                clipOrder={effectiveClipOrder}
                segmentPreviews={segmentPreviews}
                shuffleMode={shuffleMode}
                isUsingCommittedSplit={Boolean(committedBeatSplit)}
                minScore={minScore}
                lookahead={lookahead}
                keepPct={keepPct}
                colorGradient={colorGradient}
                activeClip={beatActiveClip}
                onShuffleMode={setShuffleMode}
                onMinScore={setMinScore}
                onLookahead={setLookahead}
                onKeepPct={setKeepPct}
                onColorGradient={setColorGradient}
                onActiveClip={setActiveClip}
              />
            )}

            {tab === "join" && (
              <JoinTab
                playhead={playhead}
                bpm={bpm}
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

            {tab === "beatjoin" && (
              <BeatJoinTab
                playhead={playhead}
                minDur={minDur}
                maxDur={maxDur}
                energyResp={energyResp}
                chaos={chaos}
                onsetBoost={onsetBoost}
                energyReactive={energyReactive}
                lowEnergyRange={lowEnergyRange}
                highEnergyRange={highEnergyRange}
                analysis={beatJoinAnalysis}
                audioPlayhead={audioPreviewPlayhead}
                analysisStatus={audioStatus}
                analysisError={audioError}
                isAnalyzing={isPreparingAudio}
                clipOrder={effectiveClipOrder}
                shuffleMode={shuffleMode}
                isUsingCommittedSplit={Boolean(committedBeatSplit)}
                activeClip={beatActiveClip}
                onMinDur={setMinDur}
                onMaxDur={setMaxDur}
                onEnergyResp={setEnergyResp}
                onChaos={setChaos}
                onOnsetBoost={setOnsetBoost}
                onEnergyReactive={setEnergyReactive}
                onLowEnergyRange={(value) => setLowEnergyRange(Math.min(value, highEnergyRange - 0.05))}
                onHighEnergyRange={(value) => setHighEnergyRange(Math.max(value, lowEnergyRange + 0.05))}
                onActiveClip={setActiveClip}
              />
            )}

            {tab === "ramp" && (
              <RampTab
                playhead={playhead}
                bpm={bpm}
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

            <ProcessActionBar
              tab={tab}
              done={done}
              isRunning={isRunning}
              progress={progress}
              disabled={actionDisabled}
              disabledReason={actionDisabledReason}
              processingLabel={`Preparing Preview · ${previewState.stage}`}
              completedLabel={
                tab === "beatsplit"
                  ? `Beat Split Committed — ${committedBeatSplit?.segments.length ?? beatSplitSegments.length} segments`
                  : completedLabel
              }
              onRun={tab === "beatsplit" ? handleCommitBeatSplit : () => void runProcess()}
              onResetDone={resetPreparedPreview}
            />
          </main>

          <StudioRightPanel
            readout={readout}
            tab={tab}
            shuffleMode={shuffleMode}
            manifestSegmentCount={manifestSegments.length}
            rankedSegmentIds={manifestRankingPreview.ids}
            previewAssetKey={previewState.currentAssetKey}
            previewAssetUrl={previewAssetUrl}
          />
        </div>

        <StudioStatusBar
          gpu={gpu}
          previewStage={previewState.stage}
          activeRequestKey={previewState.activeRequestKey}
          assetKey={previewState.currentAssetKey}
          statusLabel={previewStatusLabel}
        />
      </div>
    </div>
  );
}

function buildVideoSourceKey(source: Pick<UploadedVideoSource, "name" | "size" | "duration">) {
  return `${source.name}::${source.size}::${source.duration.toFixed(3)}`;
}

function formatSourceRefs(sourceClipIds: number[]) {
  if (!sourceClipIds.length) return "S0";
  if (sourceClipIds.length === 1) return `S${sourceClipIds[0] + 1}`;
  const first = sourceClipIds[0] ?? 0;
  const last = sourceClipIds[sourceClipIds.length - 1] ?? first;
  return `S${first + 1}-${last + 1}`;
}
