"use client";

import { useEffect, useRef, useState } from "react";
import type { GeneratedStudioAsset } from "../generatedAssets";
import { BrowserPreviewPlayer, createPreviewPlayerState } from "../previewPlayer";
import { attachLiveDraftTakePlayback } from "../liveDraftTakePlayback";
import { Button } from "../ui";

/** Mounted for one explicitly opened take only; viewing never changes draft selection. */
export function LiveDraftTakeViewer({ asset, playbackUrl }: { asset: GeneratedStudioAsset; playbackUrl: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [player] = useState(() => new BrowserPreviewPlayer({ warmSourceLimit: 0 }));
  const [state, setState] = useState(createPreviewPlayerState);
  const start = asset.trimStart ?? 0;
  const duration = asset.target ? asset.target.songEnd - asset.target.songStart : asset.durationSeconds ?? 0;
  const end = Math.min(start + duration, asset.durationSeconds ?? start + duration);
  const valid = Number.isFinite(start) && start >= 0 && Number.isFinite(end) && end > start;
  useEffect(() => {
    const element = video.current;
    if (!element || !valid) return;
    return attachLiveDraftTakePlayback(player, element,
      { videoUrl: playbackUrl, startTime: start, endTime: end, label: asset.title ?? "Saved take", useClipAudio: true }, setState);
  }, [player, playbackUrl, start, end, valid, asset.title]);
  if (!valid) return <p className="text-xs text-fg-3">This take needs a valid saved playback window.</p>;
  return <div className="mt-2 space-y-2">
    <video ref={video} preload="none" playsInline className="max-h-80 w-full rounded-sm bg-ink-0" aria-label={`Saved take ${asset.title ?? asset.id}`} />
    <div className="flex gap-2">
      <Button onClick={() => state.status === "paused" ? player.resume() : void player.play()}>Play saved take</Button>
      <Button onClick={() => player.pause()}>Pause take</Button>
    </div>
    {state.errorMessage ? <p role="alert" className="text-xs text-danger">{state.errorMessage}</p> : null}
    <p className="text-xs text-fg-3">Viewing only · {duration.toFixed(2)}s edit window · selection and identity checks stay separate.</p>
  </div>;
}
