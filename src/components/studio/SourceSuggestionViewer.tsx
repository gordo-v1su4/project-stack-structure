"use client";
import { useEffect, useRef, useState } from "react";
import { BrowserPreviewPlayer } from "./previewPlayer";
import { attachLiveDraftTakePlayback } from "./liveDraftTakePlayback";
import { usePreviewPlayerState } from "./usePreviewPlayerState";
import type { SourceSuggestionPreview } from "./sourceSuggestionPreview";
import { Button } from "./ui";

/** One explicitly opened source, with bounded normal-speed playback and no adoption. */
export function SourceSuggestionViewer({ preview }: { preview: SourceSuggestionPreview }) {
  const video = useRef<HTMLVideoElement>(null);
  const [player] = useState(() => new BrowserPreviewPlayer({ warmSourceLimit: 0 }));
  const state = usePreviewPlayerState(player);
  useEffect(() => {
    if (!video.current) return;
    return attachLiveDraftTakePlayback(player, video.current,
      { videoUrl: preview.videoUrl, startTime: preview.start, endTime: preview.end, label: preview.label, useClipAudio: true }, () => {});
  }, [player, preview]);
  return <div className="space-y-2 rounded-md border border-line p-2" aria-label="Source suggestion preview">
    <p className="text-xs text-fg-2">{preview.label} · source {preview.start.toFixed(2)}–{preview.end.toFixed(2)}s</p>
    <video ref={video} preload="none" playsInline aria-label="Suggested source video" className="aspect-video w-full rounded-sm bg-ink-0 object-contain" />
    <div className="flex gap-2"><Button size="sm" onClick={() => state.status === "paused" ? player.resume() : void player.play()}>Play source</Button>
      <Button size="sm" onClick={() => player.pause()}>Pause source</Button></div>
    <p className="text-xs text-fg-3">Viewing source footage and its audio. Your cut stays selected; this does not replace a shot or approve a take.</p>
    {state.errorMessage ? <p role="alert" className="text-xs text-danger">{state.errorMessage}</p> : null}
  </div>;
}
