"use client";

import { useSyncExternalStore } from "react";
import type { BrowserPreviewPlayer } from "./previewPlayer";
import { getPreviewPlayerStore } from "./previewPlayerStore";

/** Full-rate clock belongs only to playback leaves, never the StudioApp root. */
export function usePreviewPlayerState(player: BrowserPreviewPlayer | null) {
  const store = getPreviewPlayerStore(player);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
}

export function usePreviewPlayerSummary(player: BrowserPreviewPlayer) {
  const store = getPreviewPlayerStore(player);
  return useSyncExternalStore(store.subscribeSummary, store.getSummary, store.getServerSummary);
}
