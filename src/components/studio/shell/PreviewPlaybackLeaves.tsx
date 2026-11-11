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

export function PreviewTransportBar({ player, transport, ...props }: ComponentProps<typeof TransportBar> & {
  player: BrowserPreviewPlayer | null;
}) {
  const state = usePreviewPlayerState(player);
  return <TransportBar {...props} transport={player && transport.source === "preview"
    ? { ...transport, currentTime: state.currentTime }
    : transport} />;
}
