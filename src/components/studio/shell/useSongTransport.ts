"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface SongTransport {
  /** Attach to a hidden <audio> element rendered by the shell. */
  audioRef: React.RefObject<HTMLAudioElement | null>;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  /** 0..1 */
  playhead: number;
  toggle: () => void;
  stop: () => void;
  seek: (playhead: number) => void;
}

/**
 * Master-song playback for the beat spine when no prepared cut is loaded.
 * The transport bar drives it; the spine reads its playhead.
 */
export function useSongTransport(audioUrl: string | null, fallbackDuration: number): SongTransport {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setCurrentTime(audio.currentTime);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onLoaded = () => setMediaDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("ended", onEnded);
    };
  }, [audioUrl]);

  const duration = mediaDuration > 0 ? mediaDuration : Math.max(fallbackDuration, 0.001);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;
    if (audio.paused) void audio.play().catch(() => setIsPlaying(false));
    else audio.pause();
  }, [audioUrl]);

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    setCurrentTime(0);
  }, []);

  const seek = useCallback((playhead: number) => {
    const audio = audioRef.current;
    const next = Math.max(0, Math.min(1, playhead)) * duration;
    if (audio) audio.currentTime = next;
    setCurrentTime(next);
  }, [duration]);

  return {
    audioRef,
    isPlaying,
    currentTime,
    duration,
    playhead: Math.max(0, Math.min(1, currentTime / duration)),
    toggle,
    stop,
    seek,
  };
}
