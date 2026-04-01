"use client";

import { useEffect, useRef, useState } from "react";
import { fmt } from "./math";
import { AUDIO_METER_EVENT } from "./RealtimeMeters";
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
  helperText,
  accent = "#c8900a",
  height = 110,
  onPlayheadChange,
}: AudioPreviewProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const meterFrameRef = useRef<number | null>(null);
  const frequencyDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioTime, setAudioTime] = useState(0);
  const [zoom, setZoom] = useState<1 | 2>(1);
  const duration = Math.max(analysis.duration, 0.001);
  const playhead = clamp(audioTime / duration, 0, 1);
  const displayBpm = Math.round(deriveDisplayBpm(analysis.beats, bpmFallback));

  useEffect(() => {
    const audioElement = audioRef.current;
    if (!audioElement) return;

    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.78;

    const sourceNode = audioContext.createMediaElementSource(audioElement);
    sourceNode.connect(analyser);
    analyser.connect(audioContext.destination);

    audioContextRef.current = audioContext;
    analyserRef.current = analyser;
    sourceNodeRef.current = sourceNode;
    frequencyDataRef.current = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));

    return () => {
      if (meterFrameRef.current !== null) {
        window.cancelAnimationFrame(meterFrameRef.current);
      }
      dispatchMeterBins(Array.from({ length: 10 }, () => 0));
      sourceNode.disconnect();
      analyser.disconnect();
      void audioContext.close();
      audioContextRef.current = null;
      analyserRef.current = null;
      sourceNodeRef.current = null;
      frequencyDataRef.current = null;
    };
  }, [analysis.audioUrl]);

  useEffect(() => {
    if (!isPlaying) {
      if (meterFrameRef.current !== null) {
        window.cancelAnimationFrame(meterFrameRef.current);
        meterFrameRef.current = null;
      }
      dispatchMeterBins(Array.from({ length: 10 }, () => 0));
      return;
    }

    const analyser = analyserRef.current;
    const audioContext = audioContextRef.current;
    const frequencyData = frequencyDataRef.current;
    if (!analyser || !audioContext || !frequencyData) return;

    void audioContext.resume();

    const drawMeters = () => {
      analyser.getByteFrequencyData(frequencyData);
      dispatchMeterBins(compressFrequencyBins(frequencyData, 10));
      meterFrameRef.current = window.requestAnimationFrame(drawMeters);
    };

    meterFrameRef.current = window.requestAnimationFrame(drawMeters);

    return () => {
      if (meterFrameRef.current !== null) {
        window.cancelAnimationFrame(meterFrameRef.current);
        meterFrameRef.current = null;
      }
    };
  }, [isPlaying]);

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
    <div className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <div className="min-w-0">
          <div className="truncate text-[10px] uppercase tracking-[0.18em] text-[#585858]">{title}</div>
          {subtitle ? <div className="text-[9px] uppercase tracking-[0.14em] text-[#3f3f3f]">{subtitle}</div> : null}
        </div>
        <div className="font-mono text-[10px] text-[#505050]">
          {fmt(audioTime)} / {fmt(duration)}
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
        zoom={zoom}
        onSeek={seekToPlayhead}
      />

      <div className="border border-[#1a1a1a] rounded-[2px] bg-[#090909] px-3 py-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void togglePlayback()}
              className="border border-[#1f1f1f] rounded-[2px] px-3 py-1 text-[10px] uppercase tracking-[0.14em] text-[#d0d0d0] hover:border-[#343434]"
            >
              {isPlaying ? "Pause" : "Play"}
            </button>
            <button
              type="button"
              onClick={rewindToStart}
              className="border border-[#1f1f1f] rounded-[2px] px-3 py-1 text-[10px] uppercase tracking-[0.14em] text-[#9a9a9a] hover:border-[#343434]"
            >
              Rewind
            </button>
            <button
              type="button"
              onClick={() => setZoom((current) => (current === 1 ? 2 : 1))}
              className={`border rounded-[2px] px-3 py-1 text-[10px] uppercase tracking-[0.14em] ${
                zoom === 2 ? "border-[#e05c00] text-[#e05c00] bg-[#e05c0012]" : "border-[#1f1f1f] text-[#9a9a9a]"
              }`}
            >
              {zoom}x
            </button>
          </div>
          <div className="font-mono text-[10px] text-[#505050]">{fmt(audioTime)} / {fmt(duration)}</div>
        </div>
        <div className="mt-2 flex items-center justify-between gap-3">
          {helperText ? <span className="text-[10px] uppercase tracking-[0.14em] text-[#565656]">{helperText}</span> : null}
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

function compressFrequencyBins(data: Uint8Array, outputBins: number) {
  return Array.from({ length: outputBins }, (_, binIndex) => {
    const start = Math.floor((binIndex / outputBins) * data.length);
    const end = Math.max(start + 1, Math.floor(((binIndex + 1) / outputBins) * data.length));
    let total = 0;
    for (let index = start; index < end; index += 1) {
      total += data[index] ?? 0;
    }
    return clamp(total / Math.max(1, end - start) / 255, 0, 1);
  });
}

function dispatchMeterBins(bins: number[]) {
  window.dispatchEvent(new CustomEvent(AUDIO_METER_EVENT, { detail: { bins } }));
}
