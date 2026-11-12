"use client";

import type { ComponentProps } from "react";
import type { BrowserPreviewPlayer } from "../previewPlayer";
import type { PreviewSegment } from "../previewPlayer";
import { animaticFootageSongTime } from "./AnimaticFootageLabels";
import { usePreviewPlayerState } from "../usePreviewPlayerState";
import { BeatSpine } from "./BeatSpine";
import { TransportBar } from "./TransportBar";

export function PreviewBeatSpine({ player, songPlayhead, segments = [], ...props }: Omit<ComponentProps<typeof BeatSpine>, "playhead"> & {
  player: BrowserPreviewPlayer | null;
  songPlayhead: number;
  segments?: PreviewSegment[];
}) {
  const state = usePreviewPlayerState(player);
  const playhead = player
    ? Math.max(0, Math.min(1, (animaticFootageSongTime(segments, state.currentIndex, state.currentTime) ?? state.currentTime) / Math.max(props.analysis.duration, 0.001)))
    : songPlayhead;
  return <BeatSpine {...props} playhead={playhead} />;
}

export function PreviewTransportBar({ player, transport, segments = [], songDuration, ...props }: ComponentProps<typeof TransportBar> & {
  player: BrowserPreviewPlayer | null;
  segments?: PreviewSegment[];
  songDuration?: number;
}) {
  const state = usePreviewPlayerState(player);
  const songTime = player && transport.source === "preview"
    ? animaticFootageSongTime(segments, state.currentIndex, state.currentTime) : null;
  const useSongTime = songTime !== null && songDuration !== undefined && Number.isFinite(songDuration) && songDuration > 0;
  return <TransportBar {...props} transport={player && transport.source === "preview"
    ? { ...transport, currentTime: useSongTime ? Math.min(songDuration!, Math.max(0, songTime!)) : state.currentTime,
      duration: useSongTime ? songDuration! : transport.duration,
      label: useSongTime ? `Song time · ${transport.label}` : transport.label }
    : transport} />;
}
