import { BrowserPreviewPlayer, type PreviewPlayerListener, type PreviewSegment } from "./previewPlayer";
import { registerMediaPlaybackGroup } from "./mediaPlaybackOwnership";

/** One opened take owns one bounded player; cleanup also invalidates pending playback. */
export function attachLiveDraftTakePlayback(player: BrowserPreviewPlayer, element: HTMLVideoElement,
  segment: PreviewSegment, listener: PreviewPlayerListener, register = registerMediaPlaybackGroup) {
  player.attach(element);
  const unsubscribe = player.subscribe(listener);
  const release = register(player, [element], () => player.pause());
  player.load([segment]);
  return () => { release(); unsubscribe(); player.detach(); };
}
