"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAssetStore } from "@/review/lib/store/asset-store";
import { useViewerStore } from "@/review/lib/store/viewer-store";
import { useVideoFrame } from "@/review/hooks/use-video-frame";
import { useDropZone } from "@/review/hooks/use-drop-zone";
import { normalizeFps } from "@/review/lib/video/frame-utils";
import { Transport } from "./transport";
import { ScrubTrack } from "./scrub-track";
import { SceneStrip } from "@/review/components/sidebar/scene-strip";

export function MediaViewer() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const wellRef = useRef<HTMLDivElement>(null);

  const addFiles = useAssetStore((s) => s.addFiles);
  const asset = useAssetStore((s) =>
    s.assets.find((a) => a.id === s.activeAssetId)
  );
  const version = asset?.versions[asset.currentVersionIndex];

  const vs = useViewerStore();
  const {
    setMode,
    setCurrentTime,
    setDuration,
    setFps,
    setPlaying,
    requestSeek,
    clearSeek,
    clearStep,
    reset,
  } = vs;

  const { isOver, dropProps } = useDropZone((files) => void addFiles(files));

  const isVideo = version && asset?.type === "video";
  const isImage = version && asset?.type === "image";
  const transcoding =
    asset?.analysisStage === "detecting" ||
    asset?.analysisStage === "probing";
  const decodeError = asset?.analysisStage === "error";

  // Image zoom/pan local state.
  const [pan, setPan] = useState({ x: 0, y: 0 });
  useEffect(() => {
    setPan({ x: 0, y: 0 });
  }, [version?.id]);

  // Sync viewer mode + reset on asset/version change.
  useEffect(() => {
    if (isVideo) setMode("video");
    else if (isImage) setMode("image");
    else setMode("empty");
    reset();
    if (version) {
      setFps(version.fps || 30);
      setDuration(version.duration || 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version?.id, asset?.type]);

  // Drive play/pause.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (vs.isPlaying) v.play().catch(() => setPlaying(false));
    else v.pause();
  }, [vs.isPlaying, setPlaying]);

  // Playback rate.
  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = vs.playbackRate;
  }, [vs.playbackRate]);

  // Seek requests.
  useEffect(() => {
    if (vs.seekRequest != null && videoRef.current) {
      videoRef.current.currentTime = vs.seekRequest;
      setCurrentTime(vs.seekRequest);
      clearSeek();
    }
  }, [vs.seekRequest, setCurrentTime, clearSeek]);

  // Step requests (±N frames).
  useEffect(() => {
    if (vs.stepRequest != null && videoRef.current && version) {
      const fps = version.fps || 30;
      const next = Math.max(
        0,
        Math.min(
          videoRef.current.currentTime + vs.stepRequest / fps,
          version.duration
        )
      );
      videoRef.current.currentTime = next;
      setCurrentTime(next);
      clearStep();
    }
  }, [vs.stepRequest, version, setCurrentTime, clearStep]);

  // Frame-accurate time tracking while playing.
  const onFrame = useCallback(
    (mediaTime: number) => setCurrentTime(mediaTime),
    [setCurrentTime]
  );
  useVideoFrame(videoRef.current, onFrame, vs.isPlaying);

  // Keyboard map.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const fps = version?.fps || 30;
      switch (e.key) {
        case " ":
          e.preventDefault();
          vs.togglePlay();
          break;
        case "ArrowLeft":
          e.preventDefault();
          vs.requestStep(e.shiftKey ? -Math.round(fps) : -1);
          break;
        case "ArrowRight":
          e.preventDefault();
          vs.requestStep(e.shiftKey ? Math.round(fps) : 1);
          break;
        case ",":
          vs.requestStep(-1);
          break;
        case ".":
          vs.requestStep(1);
          break;
        case "l":
        case "L":
          vs.toggleLoop();
          break;
        case "+":
        case "=":
          if (isImage) vs.setZoom(vs.zoom * 1.2);
          break;
        case "-":
          if (isImage) vs.setZoom(vs.zoom / 1.2);
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version?.id, isImage]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden p-3">
      {/* MEDIA WELL */}
      <div
        ref={wellRef}
        {...dropProps}
        className={`relative flex flex-1 items-center justify-center overflow-hidden rounded-[2px] border bg-[var(--bg-well)] ${
          isOver
            ? "border-[var(--accent)]"
            : version
              ? "border-[var(--border)]"
              : "border-dashed border-[var(--border)]"
        }`}
      >
        {/* EMPTY STATE */}
        {!version && !isOver && (
          <div className="flex flex-col items-center gap-3 text-center">
            <p className="text-[12px] text-[var(--text-dim)]">
              Drop an image or video to begin review.
            </p>
            <p className="font-mono text-[9px] tracking-[0.18em] text-[var(--text-faint)]">
              MP4 · MOV · PNG · JPG · EXR · WEBM
            </p>
          </div>
        )}

        {/* DRAG OVERLAY */}
        {isOver && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-[var(--accent)]/5">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--accent)]">
              Release to ingest
            </p>
          </div>
        )}

        {/* VIDEO */}
        {isVideo && (
          <video
            ref={videoRef}
            src={version.src}
            className="max-h-full max-w-full"
            playsInline
            muted={false}
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              setDuration(v.duration);
              if (!version.fps) setFps(normalizeFps(30));
            }}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={(e) => {
              if (!vs.isPlaying) setCurrentTime(e.currentTarget.currentTime);
            }}
            onEnded={(e) => {
              if (vs.loop) {
                e.currentTarget.currentTime = 0;
                e.currentTarget.play().catch(() => {});
              } else {
                setPlaying(false);
              }
            }}
          />
        )}

        {/* IMAGE */}
        {isImage && (
          <div
            className="relative h-full w-full cursor-grab active:cursor-grabbing"
            onWheel={(e) => {
              vs.setZoom(vs.zoom * (e.deltaY < 0 ? 1.1 : 0.9));
            }}
            onDoubleClick={() => {
              vs.setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
            onMouseDown={(e) => {
              const start = { x: e.clientX - pan.x, y: e.clientY - pan.y };
              const move = (ev: MouseEvent) =>
                setPan({ x: ev.clientX - start.x, y: ev.clientY - start.y });
              const up = () => {
                window.removeEventListener("mousemove", move);
                window.removeEventListener("mouseup", up);
              };
              window.addEventListener("mousemove", move);
              window.addEventListener("mouseup", up);
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={version.src}
              alt={asset?.name}
              draggable={false}
              className="absolute left-1/2 top-1/2 max-h-none select-none"
              style={{
                transform: `translate(-50%,-50%) translate(${pan.x}px,${pan.y}px) scale(${vs.zoom})`,
              }}
            />
            <div className="absolute right-2 top-2 rounded-[2px] bg-[var(--bg-inset-deep)]/80 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-[var(--text-2)]">
              {Math.round(vs.zoom * 100)}%
            </div>
          </div>
        )}

        {/* TRANSCODING OVERLAY */}
        {transcoding && (
          <div className="absolute inset-x-0 bottom-0 z-10">
            <div className="bg-[var(--bg-well)]/90 px-4 py-2 text-center">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--gold)]">
                {asset?.analysisLabel ?? "TRANSCODING…"}{" "}
                {Math.round((asset?.analysisProgress ?? 0) * 100)}%
              </p>
            </div>
            <div
              className="h-[3px] bg-[var(--accent)] transition-all duration-200"
              style={{ width: `${(asset?.analysisProgress ?? 0) * 100}%` }}
            />
          </div>
        )}

        {/* DECODE ERROR */}
        {decodeError && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--bg-well)]/90">
            <p className="font-mono text-[11px] text-[var(--reject)]">
              {asset?.analysisLabel || "DECODE_FAILED · unsupported codec"}
            </p>
          </div>
        )}
      </div>

      {/* TRANSPORT + SCRUB */}
      {version && (
        <div className="shrink-0">
          <ScrubTrack />
          <Transport />
          <SceneStrip />
        </div>
      )}
    </div>
  );
}
