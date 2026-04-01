"use client";

import { startTransition, useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { AudioPreview } from "./studio/AudioPreview";
import { extractWaveformData, fetchEssentiaAnalysis, parseEssentiaPayload } from "./studio/audioAnalysis";
import { NAV } from "./studio/constants";
import { prepareVideoSources } from "./studio/mediaUpload";
import { ProcessActionBar } from "./studio/ProcessActionBar";
import { buildReadout } from "./studio/readout";
import { BeatJoinTab } from "./studio/panels/BeatJoinTab";
import { BeatSplitTab } from "./studio/panels/BeatSplitTab";
import { JoinTab } from "./studio/panels/JoinTab";
import { RampTab } from "./studio/panels/RampTab";
import { ShuffleTab } from "./studio/panels/ShuffleTab";
import { SplitTab } from "./studio/panels/SplitTab";
import { StudioHeader } from "./studio/StudioHeader";
import { StudioRightPanel } from "./studio/StudioRightPanel";
import { StudioSidebar } from "./studio/StudioSidebar";
import { StudioStatusBar } from "./studio/StudioStatusBar";
import { buildShuffleQueue } from "./studio/shuffleQueue";
import { buildAudioDrivenSegments, buildBeatSegments, buildSourceClipSpans, buildStandardSegments } from "./studio/sourceTimeline";
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
  const beatSplitClipCount = beatSplitSegments.length;
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
      beatSplitSegments.map((segment, index) => {
        const source = videoSources[segment.sourceClipIds[0] ?? -1];
        return {
          clipId: index,
          label: source ? source.name.replace(/\.[^.]+$/, "") : `SEG_${String(index + 1).padStart(2, "0")}`,
          duration: segment.duration,
          thumbnailUrl: source?.thumbnailUrl,
          sourceClipIds: segment.sourceClipIds,
        };
      }),
    [beatSplitSegments, videoSources]
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

  async function handleVideoUpload(files: File[]) {
    setVideoError(null);
    setIsPreparingVideos(true);
    setVideoStatus(`Processing ${files.length} video clip${files.length === 1 ? "" : "s"}...`);

    try {
      const prepared = await prepareVideoSources(files);
      if (!prepared.length) {
        throw new Error("No readable video files were selected.");
      }

      startTransition(() => {
        setVideoSources(prepared);
        setJoinClipStates({});
        setActiveClip(0);
        setVideoStatus(`Loaded ${prepared.length} clip${prepared.length === 1 ? "" : "s"} · thumbnails ready.`);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown video processing error";
      setVideoError(message);
      setVideoStatus("Upload one or more video clips to begin.");
    } finally {
      setIsPreparingVideos(false);
    }
  }

  async function handleAudioUpload(files: File[]) {
    const file = files[0];
    if (!file) return;

    const previousAudioUrl = beatJoinAnalysis?.audioUrl;
    const nextAudioUrl = URL.createObjectURL(file);

    setAudioError(null);
    setIsPreparingAudio(true);
    setAudioStatus(`Analyzing ${file.name}...`);

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
        setAudioStatus(`Ready · ${parsed.sourceLabel}`);
      });

      if (previousAudioUrl) {
        URL.revokeObjectURL(previousAudioUrl);
      }
    } catch (error) {
      URL.revokeObjectURL(nextAudioUrl);
      const message = error instanceof Error ? error.message : "Unknown analysis error";
      setAudioError(message);
      setAudioStatus(beatJoinAnalysis ? `Ready · ${beatJoinAnalysis.sourceLabel}` : "Upload a song to unlock beat sync.");
      if (!beatJoinAnalysis) {
        setBeatJoinAnalysis(null);
      }
    } finally {
      setIsPreparingAudio(false);
    }
  }

  function runProcess() {
    if (isRunning) return;
    setIsRunning(true);
    setDone(false);
    setProgress(0);
    let p = 0;
    const id = setInterval(() => {
      p += Math.random() * 7 + 2;
      setProgress(Math.min(p, 100));
      if (p >= 100) {
        clearInterval(id);
        setIsRunning(false);
        setDone(true);
      }
    }, 160);
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

  function handleSelectTab(t: Tab) {
    setTab(t);
    setDone(false);
    setProgress(0);
  }

  const needsVideoSource = tab !== "beatjoin";
  const isMissingVideoSource = needsVideoSource && videoSources.length === 0;
  const isMissingAudioSource = tab === "beatjoin" && beatJoinAnalysis === null;
  const actionDisabled = isMissingVideoSource || isMissingAudioSource;
  const actionDisabledReason = isMissingVideoSource
    ? "Upload video clips to continue."
    : "Upload a song to unlock Beat Join.";

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
            {beatJoinAnalysis ? (
              <AudioPreview
                analysis={beatJoinAnalysis}
                bpmFallback={bpm}
                title={beatJoinAnalysis.sourceLabel}
                subtitle={audioPreviewSubtitle}
                helperText="Master song lane persists across the studio. Click to seek, play from here, and use 2x zoom for tighter timing."
                onPlayheadChange={(nextPlayhead) => setAudioPreviewPlayhead(nextPlayhead)}
              />
            ) : null}

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
                isPreparingAudio={isPreparingAudio}
                videoSources={videoSources}
                videoStatus={videoStatus}
                videoError={videoError}
                isPreparingVideos={isPreparingVideos}
                sourceClips={sourceClips}
                segments={beatSplitSegments}
                sensitivity={sensitivity}
                activeClip={beatActiveClip}
                onAudioUpload={handleAudioUpload}
                onVideoUpload={handleVideoUpload}
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
                clipOrder={shuffleQueue}
                segmentPreviews={segmentPreviews}
                shuffleMode={shuffleMode}
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
                clipOrder={shuffleQueue}
                segmentPreviews={segmentPreviews}
                shuffleMode={shuffleMode}
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
                clipOrder={shuffleQueue}
                shuffleMode={shuffleMode}
                activeClip={beatActiveClip}
                onMinDur={setMinDur}
                onMaxDur={setMaxDur}
                onEnergyResp={setEnergyResp}
                onChaos={setChaos}
                onOnsetBoost={setOnsetBoost}
                onEnergyReactive={setEnergyReactive}
                onLowEnergyRange={(value) => setLowEnergyRange(Math.min(value, highEnergyRange - 0.05))}
                onHighEnergyRange={(value) => setHighEnergyRange(Math.max(value, lowEnergyRange + 0.05))}
                onAudioUpload={handleAudioUpload}
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
              onRun={runProcess}
              onResetDone={() => setDone(false)}
            />
          </main>

          <StudioRightPanel readout={readout} tab={tab} shuffleMode={shuffleMode} />
        </div>

        <StudioStatusBar gpu={gpu} />
      </div>
    </div>
  );
}
