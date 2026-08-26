"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import {
  BrowserPreviewPlayer,
  type PreviewPlayerState,
  type PreviewSegment,
} from "./previewPlayer";
import type { ShaderEffectCue } from "./shaderEffectPlan";
import {
  selectActiveStutterRuntimePlan,
  StutterWebGpuPreviewRenderer,
  type StutterPreviewMode,
} from "./stutterWebGpuPreview";

type PreviewAudioTimeline = {
  waveform: number[];
  beats: number[];
  onsets: number[];
  duration: number;
};

type PreviewPlayerProps = {
  player: BrowserPreviewPlayer;
  segments: PreviewSegment[];
  state: PreviewPlayerState;
  segmentLabels?: string[];
  effectCues?: ShaderEffectCue[];
  audioTimeline?: PreviewAudioTimeline | null;
  isExpanded?: boolean;
  masterAudioUrl?: string | null;
};

export function PreviewPlayer({
  player,
  segments,
  state,
  segmentLabels,
  effectCues = [],
  audioTimeline = null,
  isExpanded = false,
  masterAudioUrl = null,
}: PreviewPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const standbyVideoRef = useRef<HTMLVideoElement>(null);
  const masterAudioRef = useRef<HTMLAudioElement>(null);
  const shaderCanvasRef = useRef<HTMLCanvasElement>(null);
  const shaderFallbackCanvasRef = useRef<HTMLCanvasElement>(null);
  const sourceMonitorRef = useRef<HTMLVideoElement>(null);
  const shaderRendererRef = useRef<StutterWebGpuPreviewRenderer | null>(null);
  const shaderModeRef = useRef<StutterPreviewMode>("disabled");
  const [shaderMode, setShaderMode] = useState<StutterPreviewMode>("disabled");
  const [shaderError, setShaderError] = useState<string | null>(null);
  const hasShaderCues = effectCues.length > 0;
  const activeShaderLabel = hasShaderCues ? selectActiveStutterRuntimePlan(effectCues, state.currentTime)?.shaderLabel ?? null : null;

  useEffect(() => {
    if (videoRef.current) {
      player.attach(videoRef.current, standbyVideoRef.current);
    }
    player.attachAudioElement(masterAudioUrl ? masterAudioRef.current : null);
    return () => {
      player.detach();
    };
  }, [player, masterAudioUrl]);

  useEffect(() => {
    if (segments === player.getSegments()) return;
    player.load(segments);
  }, [player, segments]);

  useEffect(() => {
    if (!hasShaderCues || !shaderCanvasRef.current || !shaderFallbackCanvasRef.current) {
      shaderRendererRef.current?.dispose();
      shaderRendererRef.current = null;
      shaderModeRef.current = "disabled";
      return;
    }

    let cancelled = false;
    const renderer = new StutterWebGpuPreviewRenderer();
    shaderRendererRef.current = renderer;
    renderer.init(shaderCanvasRef.current, shaderFallbackCanvasRef.current).then((mode) => {
      if (cancelled) return;
      shaderModeRef.current = mode;
      setShaderMode(mode);
      setShaderError(null);
    }).catch((error) => {
      if (cancelled) return;
      const message = error instanceof Error ? error.message : "WebGPU shader preview failed.";
      shaderModeRef.current = "disabled";
      setShaderMode("disabled");
      setShaderError(`WebGPU shader has errored: ${message}`);
    });

    return () => {
      cancelled = true;
      renderer.dispose();
      if (shaderRendererRef.current === renderer) {
        shaderRendererRef.current = null;
      }
    };
  }, [hasShaderCues]);

  useEffect(() => {
    const video = player.getActiveVideoElement() ?? videoRef.current;
    const renderer = shaderRendererRef.current;
    if (!video || !renderer || !hasShaderCues) return;

    const plan = selectActiveStutterRuntimePlan(effectCues, state.currentTime);
    renderer.render(video, plan, state.currentTime);
    shaderModeRef.current = renderer.getMode();
  }, [effectCues, hasShaderCues, player, shaderMode, state.currentIndex, state.currentTime, state.status]);

  const handlePlay = useCallback(() => {
    if (state.status === "paused") {
      player.resume();
    } else {
      player.play();
    }
  }, [player, state.status]);

  const handlePause = useCallback(() => {
    player.pause();
  }, [player]);

  const handleStop = useCallback(() => {
    player.stop();
  }, [player]);

  const handleSegmentClick = useCallback(
    (index: number) => {
      player.seekToSegment(index);
    },
    [player]
  );

  const progressPct =
    state.totalDuration > 0
      ? Math.min(100, (state.currentTime / state.totalDuration) * 100)
      : 0;

  const currentSegment = segments[state.currentIndex];
  const nextSegment = segments[Math.min(segments.length - 1, state.currentIndex + 1)];

  useEffect(() => {
    const monitor = sourceMonitorRef.current;
    if (!monitor || !currentSegment || isExpanded) return;
    const targetTime = Math.max(0, currentSegment.startTime + Math.max(0.01, (currentSegment.endTime - currentSegment.startTime) * 0.35));
    const seek = () => {
      try {
        const maxTime = Number.isFinite(monitor.duration) && monitor.duration > 0
          ? monitor.duration
          : targetTime;
        monitor.currentTime = Math.min(Math.max(0, targetTime), maxTime);
      } catch {
        // Some browsers reject metadata seeks until enough data is available; static source monitor can stay on first frame.
      }
    };
    if (monitor.readyState >= 1) seek();
    monitor.addEventListener("loadedmetadata", seek, { once: true });
    return () => monitor.removeEventListener("loadedmetadata", seek);
  }, [currentSegment, isExpanded]);

  return (
    <div className={isExpanded ? "space-y-2" : "space-y-1.5"}>
      <div className={isExpanded ? "grid items-start gap-2 xl:grid-cols-[minmax(0,1.45fr)_minmax(260px,0.75fr)]" : "grid grid-cols-[minmax(150px,1fr)_minmax(150px,1fr)_minmax(120px,0.62fr)] gap-2 items-start"}>
        <div className="relative min-w-0 self-start overflow-hidden bg-black">
          <video
            ref={videoRef}
            crossOrigin="anonymous"
            preload="auto"
            muted
            playsInline
            data-preview-engine={state.engineMode}
            data-shader-preview={hasShaderCues ? shaderMode : "disabled"}
            className={`block aspect-video rounded-[2px] border border-[#181818] bg-black object-contain ${isExpanded ? "w-full" : "h-[96px] w-full"}`}
          />
          {/* Standby buffer: the next cut is staged here off-screen, then the
              player swaps opacities at the boundary — no black frame. */}
          <video
            ref={standbyVideoRef}
            crossOrigin="anonymous"
            preload="auto"
            muted
            playsInline
            aria-hidden="true"
            data-preview-standby="true"
            className="pointer-events-none absolute inset-0 h-full w-full rounded-[2px] border border-[#181818] bg-[#050505] object-contain opacity-0"
          />
          <audio
            ref={masterAudioRef}
            src={masterAudioUrl ?? undefined}
            preload="auto"
            data-master-audio="true"
            className="hidden"
          />
          {isExpanded ? (
            <div className="pointer-events-none absolute bottom-2 left-2 rounded-[2px] border border-[#151515] bg-[#050505cc] px-2 py-1 font-mono text-[8px] uppercase tracking-[0.12em] text-[#777]">
              Composition A · master song timeline
            </div>
          ) : (
            <div className="pointer-events-none absolute bottom-1 left-1 rounded-[2px] border border-[#151515] bg-[#050505cc] px-1.5 py-0.5 font-mono text-[7px] uppercase tracking-[0.1em] text-[#777]">
              Comp
            </div>
          )}
          {hasShaderCues ? (
            <>
              <canvas
                ref={shaderCanvasRef}
                data-stutter-shader-preview={shaderMode === "webgpu" ? "webgpu" : undefined}
                className={`${shaderMode === "canvas2d" ? "hidden" : "block"} pointer-events-none absolute inset-0 aspect-video h-full w-full rounded-[2px] border border-[#e05c0020] bg-transparent`}
                aria-hidden="true"
              />
              <canvas
                ref={shaderFallbackCanvasRef}
                data-stutter-shader-preview={shaderMode === "canvas2d" ? "canvas2d" : undefined}
                className={`${shaderMode === "canvas2d" ? "block" : "hidden"} pointer-events-none absolute inset-0 aspect-video h-full w-full rounded-[2px] border border-[#e05c0020] bg-transparent`}
                aria-hidden="true"
              />
            </>
          ) : null}
          {hasShaderCues ? (
            <div className={`${isExpanded ? "left-2 top-2 px-2 py-1 text-[8px]" : "right-1 top-1 max-w-[72px] px-1 py-0.5 text-[6px]"} pointer-events-none absolute rounded-[2px] border border-[#e05c0040] bg-[#050505cc] font-mono uppercase tracking-[0.1em] text-[#e05c00]`}>
              Live {shaderMode === "webgpu" ? "WebGPU" : shaderMode === "canvas2d" ? "Canvas FX" : "Shader"}
              {isExpanded && activeShaderLabel ? ` · ${activeShaderLabel}` : ""}
            </div>
          ) : null}
          {hasShaderCues && shaderError ? (
            <div className="pointer-events-none absolute right-2 top-2 max-w-[65%] rounded-[2px] border border-[#8a2f27] bg-[#120504dd] px-2 py-1 font-mono text-[8px] uppercase tracking-[0.1em] text-[#d24b3f]">
              {shaderError}
            </div>
          ) : null}
          {state.status === "loading" && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#00000088] rounded-[2px]">
              <span className="text-[10px] font-mono text-[#e05c00] animate-pulse">
                LOADING SEGMENT...
              </span>
            </div>
          )}
          {state.status === "ended" && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#00000066] rounded-[2px]">
              <span className="text-[10px] font-mono text-[#3a8a3a]">
                PREVIEW COMPLETE
              </span>
            </div>
          )}
        </div>

        {!isExpanded ? (
          <div className="relative min-w-0">
            {currentSegment ? (
              <video
                key={`source-monitor-${currentSegment.videoUrl}:${currentSegment.startTime}:${state.currentIndex}`}
                ref={sourceMonitorRef}
                src={currentSegment.videoUrl}
                crossOrigin="anonymous"
                muted
                playsInline
                preload="metadata"
                data-source-monitor="compact-current"
                className="aspect-video h-[96px] w-full rounded-[2px] border border-[#181818] bg-[#050505] object-contain"
              />
            ) : (
              <div className="flex aspect-video h-[96px] w-full items-center justify-center rounded-[2px] border border-[#181818] bg-[#050505] font-mono text-[8px] uppercase tracking-[0.12em] text-[#444]">No source</div>
            )}
            <div className="pointer-events-none absolute bottom-1 left-1 rounded-[2px] border border-[#151515] bg-[#050505cc] px-1.5 py-0.5 font-mono text-[7px] uppercase tracking-[0.1em] text-[#777]">
              Source
            </div>
          </div>
        ) : null}

        {!isExpanded ? (
          <div className="min-w-0 rounded-[2px] border border-[#151515] bg-[#070707] p-2">
            <div className="mb-1 flex items-center justify-between gap-2 font-mono text-[8px] uppercase tracking-[0.1em]">
              <span className="truncate text-[#c0c0c0]">{currentSegment?.label ?? "No source selected"}</span>
              <span className="shrink-0 text-[#e05c00]">{state.segmentCount > 0 ? `${state.currentIndex + 1}/${state.segmentCount}` : "—"}</span>
            </div>
            <div className="mb-1 h-[2px] overflow-hidden rounded-full bg-[#141414]">
              <div className="h-full rounded-full bg-[#e05c00] transition-all duration-150" style={{ width: `${progressPct}%` }} />
            </div>
            <div className="flex items-center justify-between gap-2 font-mono text-[8px] text-[#555]">
              <span>{formatTime(state.currentTime)}</span>
              <span>{formatTime(state.totalDuration)}</span>
            </div>
            <div className="mt-1 truncate font-mono text-[8px] uppercase tracking-[0.1em] text-[#4b4b4b]">
              {state.engineMode === "warm-video" ? "warm comp" : "native comp"} · source still
            </div>
            <div className="mt-2 flex items-center justify-end gap-1">
              {state.status === "playing" ? (
                <button
                  type="button"
                  onClick={handlePause}
                  className="rounded-[2px] border border-[#e05c00] px-2 py-1 text-[8px] uppercase tracking-[0.14em] text-[#e05c00] hover:bg-[#e05c0012]"
                >
                  Pause
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handlePlay}
                  disabled={segments.length === 0}
                  className={`rounded-[2px] border px-2 py-1 text-[8px] uppercase tracking-[0.14em] ${
                    segments.length === 0
                      ? "border-[#2a2a2a] text-[#4a4a4a] cursor-not-allowed"
                      : "border-[#e05c00] text-[#e05c00] hover:bg-[#e05c0012]"
                  }`}
                >
                  {state.status === "paused" ? "Resume" : "Play"}
                </button>
              )}
              <button
                type="button"
                onClick={handleStop}
                className="rounded-[2px] border border-[#2a2a2a] px-2 py-1 text-[8px] uppercase tracking-[0.14em] text-[#555] hover:border-[#444] hover:text-[#888]"
              >
                Stop
              </button>
            </div>
          </div>
        ) : null}

        {isExpanded ? (
          <div className="grid gap-2 rounded-[2px] border border-[#181818] bg-[#070707] p-2">
            <div className="relative aspect-video overflow-hidden rounded-[2px] border border-[#151515] bg-[#040404]">
              {currentSegment ? (
                <video
                  key={`${currentSegment.videoUrl}:${currentSegment.startTime}:${state.currentIndex}`}
                  src={currentSegment.videoUrl}
                  crossOrigin="anonymous"
                  muted
                  playsInline
                  preload="metadata"
                  data-source-monitor="current"
                  className="h-full w-full object-contain opacity-75"
                  onLoadedMetadata={(event) => {
                    event.currentTarget.currentTime = Math.max(0, currentSegment.startTime);
                  }}
                />
              ) : null}
              <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.05)_0%,rgba(0,0,0,0.68)_100%)]" />
              <div className="absolute left-2 top-2 rounded-[2px] border border-[#202020] bg-[#050505cc] px-2 py-1 font-mono text-[8px] uppercase tracking-[0.12em] text-[#e05c00]">
                Source / Camera B
              </div>
              <div className="absolute bottom-2 left-2 right-2 font-mono text-[8px] leading-tight text-[#8a8a8a]">
                <div className="truncate text-[#c0c0c0]">{currentSegment?.label ?? "No source selected"}</div>
                <div>{currentSegment ? `${formatTime(currentSegment.startTime)} → ${formatTime(currentSegment.endTime)}` : "—"}</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 font-mono text-[8px] uppercase tracking-[0.1em] text-[#575757]">
              <div className="rounded-[2px] border border-[#151515] bg-[#050505] p-2">
                <div className="text-[#e05c00]">Current clip</div>
                <div className="mt-1 truncate text-[#8a8a8a]">{currentSegment?.label ?? "—"}</div>
              </div>
              <div className="rounded-[2px] border border-[#151515] bg-[#050505] p-2">
                <div className="text-[#777]">Next cut</div>
                <div className="mt-1 truncate text-[#8a8a8a]">{nextSegment?.label ?? "—"}</div>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className={isExpanded ? "flex items-center gap-2" : "hidden"}>
        {state.status === "playing" ? (
          <button
            type="button"
            onClick={handlePause}
            className="rounded-[2px] border border-[#e05c00] px-2 py-1 text-[8px] uppercase tracking-[0.14em] text-[#e05c00] hover:bg-[#e05c0012]"
          >
            Pause
          </button>
        ) : (
          <button
            type="button"
            onClick={handlePlay}
            disabled={segments.length === 0}
            className={`rounded-[2px] border px-2 py-1 text-[8px] uppercase tracking-[0.14em] ${
              segments.length === 0
                ? "border-[#2a2a2a] text-[#4a4a4a] cursor-not-allowed"
                : "border-[#e05c00] text-[#e05c00] hover:bg-[#e05c0012]"
            }`}
          >
            {state.status === "paused" ? "Resume" : "Play"}
          </button>
        )}
        <button
          type="button"
          onClick={handleStop}
          className="rounded-[2px] border border-[#2a2a2a] px-2 py-1 text-[8px] uppercase tracking-[0.14em] text-[#555] hover:border-[#444] hover:text-[#888]"
        >
          Stop
        </button>
        <span className="flex-1" />
        {isExpanded ? (
          <span className="font-mono text-[9px] text-[#4d4d4d]">
            {state.segmentCount > 0
              ? `${state.currentIndex + 1}/${state.segmentCount}`
              : "—"}
          </span>
        ) : null}
      </div>

      <div className={`${isExpanded ? "flex" : "hidden"} items-center justify-between font-mono text-[8px] uppercase tracking-[0.12em] text-[#3f3f3f]`}>
        <span>
          {state.engineMode === "warm-video" ? "Warm native preview" : "Native preview"}
          {hasShaderCues ? ` · ${shaderMode === "webgpu" ? "WebGPU shader" : shaderMode === "canvas2d" ? "Canvas FX fallback" : shaderError ? "shader error" : "shader initializing"}` : ""}
        </span>
        <span>
          {state.warmedSourceCount > 0 ? `${state.warmedSourceCount} hot source${state.warmedSourceCount === 1 ? "" : "s"}` : "no prewarm"}
          {state.usesFrameCallback ? " · frame callback" : ""}
        </span>
      </div>

      <div className={`${isExpanded ? "block" : "hidden"} h-[3px] overflow-hidden rounded-full bg-[#141414]`}>
        <div
          className="h-full bg-[#e05c00] rounded-full transition-all duration-150"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {currentSegment && isExpanded && (
        <div className="flex justify-between text-[9px]">
          <span className="font-mono text-[#666]">{currentSegment.label}</span>
          <span className="font-mono text-[#444]">
            {formatTime(state.currentTime)} / {formatTime(state.totalDuration)}
          </span>
        </div>
      )}

      {segments.length > 1 && isExpanded && (
        <PreviewEditTimeline
          segments={segments}
          currentIndex={state.currentIndex}
          currentTime={state.currentTime}
          totalDuration={state.totalDuration}
          segmentLabels={segmentLabels}
          audioTimeline={audioTimeline}
          isExpanded={isExpanded}
          onSegmentClick={handleSegmentClick}
        />
      )}

      {state.errorMessage && (
        <div className="text-[9px] text-[#b96c43]">{state.errorMessage}</div>
      )}
    </div>
  );
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${mins}:${String(secs).padStart(2, "0")}.${ms}`;
}


type PreviewEditTimelineProps = {
  segments: PreviewSegment[];
  currentIndex: number;
  currentTime: number;
  totalDuration: number;
  segmentLabels?: string[];
  audioTimeline?: PreviewAudioTimeline | null;
  isExpanded: boolean;
  onSegmentClick: (index: number) => void;
};

function PreviewEditTimeline({
  segments,
  currentIndex,
  currentTime,
  totalDuration,
  segmentLabels,
  audioTimeline,
  isExpanded,
  onSegmentClick,
}: PreviewEditTimelineProps) {
  const duration = Math.max(audioTimeline?.duration ?? totalDuration, totalDuration, 0.001);
  const viewWidth = 1000;
  const viewHeight = isExpanded ? 96 : 68;
  const waveTop = 10;
  const waveHeight = isExpanded ? 54 : 36;
  const blockTop = waveTop + waveHeight + 3;
  const blockHeight = isExpanded ? 20 : 14;
  const playheadX = clamp((currentTime / duration) * viewWidth, 0, viewWidth);
  const waveformPath = buildWaveformPath(audioTimeline?.waveform ?? [], viewWidth, waveTop, waveHeight);
  const markerDuration = Math.max(audioTimeline?.duration ?? duration, 0.001);
  const beatStep = (audioTimeline?.beats.length ?? 0) > 220 ? 4 : (audioTimeline?.beats.length ?? 0) > 110 ? 2 : 1;
  const onsetStep = (audioTimeline?.onsets.length ?? 0) > 500 ? 5 : (audioTimeline?.onsets.length ?? 0) > 260 ? 3 : 1;

  return (
    <div className="space-y-1">
      <div className="rounded-[2px] border border-[#151515] bg-[#050505] p-1">
        <svg
          className="block h-auto w-full"
          viewBox={`0 0 ${viewWidth} ${viewHeight}`}
          preserveAspectRatio="none"
          role="img"
          aria-label="Song-length waveform with beat, onset, and edit cut blocks"
        >
          <rect x="0" y="0" width={viewWidth} height={viewHeight} fill="#050505" />
          <line x1="0" y1={waveTop + waveHeight / 2} x2={viewWidth} y2={waveTop + waveHeight / 2} stroke="#222" strokeWidth="1" />

          {audioTimeline?.beats.map((beat, index) => {
            if (index % beatStep !== 0 || beat < 0 || beat > markerDuration) return null;
            const x = (beat / markerDuration) * viewWidth;
            const isBar = index % 4 === 0;
            return (
              <line
                key={`beat-${index}-${beat}`}
                x1={x}
                x2={x}
                y1={waveTop}
                y2={blockTop + blockHeight}
                stroke={isBar ? "#2f2f2f" : "#181818"}
                strokeWidth={isBar ? 1.1 : 0.55}
              />
            );
          })}

          {audioTimeline?.onsets.map((onset, index) => {
            if (index % onsetStep !== 0 || onset < 0 || onset > markerDuration) return null;
            const x = (onset / markerDuration) * viewWidth;
            return (
              <line
                key={`onset-${index}-${onset}`}
                x1={x}
                x2={x}
                y1={waveTop + waveHeight * 0.2}
                y2={waveTop + waveHeight * 0.8}
                stroke="#e05c00"
                strokeWidth="0.7"
                opacity="0.35"
              />
            );
          })}

          {waveformPath ? (
            <>
              <path d={waveformPath} fill="rgba(224, 92, 0, 0.22)" stroke="rgba(224, 92, 0, 0.44)" strokeWidth="1.2" />
              <clipPath id="preview-wave-played-clip">
                <rect x="0" y="0" width={playheadX} height={viewHeight} />
              </clipPath>
              <path d={waveformPath} fill="rgba(224, 92, 0, 0.45)" stroke="rgba(255, 174, 82, 0.6)" strokeWidth="1.2" clipPath="url(#preview-wave-played-clip)" />
            </>
          ) : (
            <rect x="0" y={waveTop + waveHeight * 0.42} width={viewWidth} height={waveHeight * 0.16} fill="rgba(224, 92, 0, 0.18)" />
          )}

          {segments.map((segment, index) => {
            const isActive = index === currentIndex;
            const isPast = index < currentIndex;
            const musicSegment = segment as PreviewSegment & { musicStart?: number; musicEnd?: number };
            const musicStart = Number.isFinite(musicSegment.musicStart) ? musicSegment.musicStart ?? 0 : 0;
            const musicEnd = Number.isFinite(musicSegment.musicEnd) ? musicSegment.musicEnd ?? musicStart : musicStart;
            const sequentialStart = segments.slice(0, index).reduce((sum, item) => sum + Math.max(0, item.endTime - item.startTime), 0);
            const start = Math.max(0, musicEnd > musicStart ? musicStart : sequentialStart);
            const end = Math.min(duration, Math.max(start + 0.025, musicEnd > musicStart ? musicEnd : sequentialStart + Math.max(0.025, segment.endTime - segment.startTime)));
            const x = (start / duration) * viewWidth;
            const width = Math.max(isExpanded ? 1.8 : 3, ((end - start) / duration) * viewWidth);
            return (
              <g key={`timeline-seg-${index}-${segment.label}`}>
                <rect
                  x={x}
                  y={blockTop}
                  width={width}
                  height={blockHeight}
                  rx="1"
                  fill={isActive ? "#e05c00" : isPast ? "#2b190c" : "#161616"}
                  stroke={isActive ? "#ff9340" : "#050505"}
                  strokeWidth="1"
                  className="cursor-pointer"
                  onClick={() => onSegmentClick(index)}
                >
                  <title>{`${index + 1} · ${formatTime(start)}-${formatTime(end)} · ${segmentLabels?.[index] ?? segment.label}`}</title>
                </rect>
                {(isExpanded || isActive) && width > 12 ? (
                  <text
                    x={x + Math.min(4, width / 3)}
                    y={blockTop + blockHeight - 4}
                    fill={isActive ? "#050505" : "#686868"}
                    fontSize={isExpanded ? 8 : 7}
                    fontFamily="monospace"
                  >
                    {index + 1}
                  </text>
                ) : null}
              </g>
            );
          })}

          <line x1={playheadX} y1="0" x2={playheadX} y2={viewHeight} stroke="#f2a45c" strokeWidth="1.6" />
          <polygon points={`${playheadX - 5},0 ${playheadX + 5},0 ${playheadX},8`} fill="#f2a45c" />
        </svg>
      </div>
      <div className="flex justify-between font-mono text-[8px] uppercase tracking-[0.12em] text-[#3f3f3f]">
        <span>Song-length waveform · beats/onsets · duration-scaled edit blocks</span>
        <span>{segments.length} cuts · {formatTime(duration)}</span>
      </div>
    </div>
  );
}

function buildWaveformPath(points: number[], width: number, top: number, height: number): string {
  if (!points.length) return "";
  const centerY = top + height / 2;
  const amp = Math.max(1, height / 2 - 2);
  const columns = Math.min(width, Math.max(80, Math.floor(width)));
  const upper: string[] = [];
  const lower: string[] = [];

  for (let x = 0; x <= columns; x += 1) {
    const start = Math.floor((x / columns) * points.length);
    const end = Math.max(start + 1, Math.floor(((x + 1) / columns) * points.length));
    let peak = 0;
    for (let index = start; index < end; index += 1) {
      peak = Math.max(peak, Math.abs(points[index] ?? 0));
    }
    const px = (x / columns) * width;
    const yTop = centerY - clamp(peak, 0, 1) * amp;
    const yBottom = centerY + clamp(peak, 0, 1) * amp;
    upper.push(`${upper.length ? "L" : "M"}${px.toFixed(2)},${yTop.toFixed(2)}`);
    lower.push(`L${px.toFixed(2)},${yBottom.toFixed(2)}`);
  }

  return `${upper.join(" ")} ${lower.reverse().join(" ")} Z`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
