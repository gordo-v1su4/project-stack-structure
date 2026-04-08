"use client";

import { useRef, useState } from "react";
import { fmt } from "./math";
import { SolidWaveform } from "./SolidWaveform";
import type { BeatJoinAnalysis } from "./types";

type AudioPreviewProps = {
  analysis: BeatJoinAnalysis;
  bpmFallback: number;
  title: string;
  subtitle?: string;
  helperText?: string;
  accent?: string;
  height?: number;
  onPlayheadChange?: (playhead: number, timeSeconds: number) => void;
};

export function AudioPreview({
  analysis,
  bpmFallback,
  title,
  subtitle,
  accent = "#d4ae1d",
  height = 118,
  onPlayheadChange,
}: AudioPreviewProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioTime, setAudioTime] = useState(0);
  const [zoom, setZoom] = useState<1 | 2>(1);
  const [showGrid, setShowGrid] = useState(true);
  const duration = Math.max(analysis.duration, 0.001);
  const playhead = clamp(audioTime / duration, 0, 1);
  const displayBpm = Math.round(deriveDisplayBpm(analysis.beats, bpmFallback));

  function syncAudioTime(nextTime: number) {
    const clampedTime = clamp(nextTime, 0, duration);
    setAudioTime(clampedTime);
    onPlayheadChange?.(clamp(clampedTime / duration, 0, 1), clampedTime);
  }

  async function togglePlayback() {
    const audioElement = audioRef.current;
    if (!audioElement) return;

    if (audioElement.paused) {
      await audioElement.play();
      return;
    }

    audioElement.pause();
  }

  function rewindToStart() {
    const audioElement = audioRef.current;
    if (audioElement) {
      audioElement.pause();
      audioElement.currentTime = 0;
    }
    setIsPlaying(false);
    syncAudioTime(0);
  }

  function seekToPlayhead(nextPlayhead: number) {
    const nextTime = nextPlayhead * duration;
    const audioElement = audioRef.current;
    if (audioElement) {
      audioElement.currentTime = nextTime;
    }
    syncAudioTime(nextTime);
  }

  return (
    <div className="space-y-2 border border-[#181818] rounded-[3px] bg-[linear-gradient(180deg,#0e0e0e_0%,#090909_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="truncate text-[11px] uppercase tracking-[0.24em] text-[#d7d7d7]">{title}</div>
          {subtitle ? (
            <div className="truncate text-[8px] uppercase tracking-[0.18em] text-[#565656]">
              {subtitle}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-4 font-mono text-[10px] text-[#767676]">
          <span>
            BPM <span className="text-[#d4ae1d]">{displayBpm}</span>
          </span>
          <span>
            LEN <span className="text-[#d0d0d0]">{fmt(duration)}</span>
          </span>
          <span>
            B <span className="text-[#bfbfbf]">{analysis.beats.length}</span>
          </span>
          <span>
            O <span className="text-[#bfbfbf]">{analysis.onsets.length}</span>
          </span>
          <span>
            S <span className="text-[#bfbfbf]">{analysis.sections.length}</span>
          </span>
        </div>
      </div>

      <SolidWaveform
        points={analysis.waveform}
        playhead={playhead}
        bpm={displayBpm}
        beatTimes={analysis.beats}
        durationSeconds={duration}
        beatsPerBar={4}
        accent={accent}
        height={height}
        label=""
        showRuler={showGrid}
        zoom={zoom}
        onSeek={seekToPlayhead}
      />

      <div className="border border-[#1b1b1b] rounded-[3px] bg-[#070707] px-3 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void togglePlayback()}
              className="border border-[#2a2306] rounded-[2px] bg-[#171308] px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-[#dfcb76] hover:border-[#58460d]"
            >
              {isPlaying ? "Pause" : "Play"}
            </button>
            <button
              type="button"
              onClick={rewindToStart}
              className="border border-[#232323] rounded-[2px] px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-[#9a9a9a] hover:border-[#3a3a3a]"
            >
              Rewind
            </button>
            <button
              type="button"
              onClick={() => setZoom((current) => (current === 1 ? 2 : 1))}
              className={`border rounded-[2px] px-3 py-1 text-[10px] uppercase tracking-[0.14em] ${
                zoom === 2
                  ? "border-[#d4ae1d] text-[#d4ae1d] bg-[#d4ae1d14]"
                  : "border-[#232323] text-[#9a9a9a] hover:border-[#3a3a3a]"
              }`}
            >
              {zoom}x
            </button>
            <button
              type="button"
              onClick={() => setShowGrid((current) => !current)}
              className={`border rounded-[2px] px-3 py-1 text-[10px] uppercase tracking-[0.14em] ${
                showGrid
                  ? "border-[#3a3a3a] text-[#c0c0c0] hover:border-[#575757]"
                  : "border-[#232323] text-[#8a8a8a] hover:border-[#3a3a3a]"
              }`}
            >
              {showGrid ? "Hide Grid" : "Show Grid"}
            </button>
          </div>
          <div className="font-mono text-[10px] text-[#868686]">
            {fmt(audioTime)} / {fmt(duration)}
          </div>
        </div>
      </div>

      <audio
        key={analysis.audioUrl}
        ref={audioRef}
        src={analysis.audioUrl}
        preload="metadata"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={(event) => syncAudioTime(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => {
          setIsPlaying(false);
          syncAudioTime(event.currentTarget.currentTime);
        }}
        onEnded={() => {
          setIsPlaying(false);
          syncAudioTime(0);
        }}
      />
    </div>
  );
}

function deriveDisplayBpm(beats: number[], fallback: number) {
  if (beats.length < 2) return fallback;

  const intervals = beats
    .slice(1)
    .map((time, index) => time - beats[index])
    .filter((interval) => interval > 0.02)
    .sort((left, right) => left - right);
  const interval = intervals[Math.floor(intervals.length / 2)];
  return interval ? 60 / interval : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
