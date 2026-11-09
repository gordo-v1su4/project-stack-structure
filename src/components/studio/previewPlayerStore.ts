import { createPreviewPlayerState, type BrowserPreviewPlayer, type PreviewPlayerState } from "./previewPlayer";

/** Root/editor state deliberately excludes the per-frame playback clock. */
export type PreviewPlayerSummary = Omit<PreviewPlayerState, "currentTime">;
type PlayerSource = Pick<BrowserPreviewPlayer, "getState" | "subscribe">;

function summarize(state: PreviewPlayerState): PreviewPlayerSummary {
  return {
    status: state.status, currentIndex: state.currentIndex, segmentCount: state.segmentCount,
    totalDuration: state.totalDuration, errorMessage: state.errorMessage, engineMode: state.engineMode,
    warmedSourceCount: state.warmedSourceCount, usesFrameCallback: state.usesFrameCallback,
    presentationMode: state.presentationMode,
  };
}

function sameSummary(a: PreviewPlayerSummary, b: PreviewPlayerSummary) {
  return a.status === b.status && a.currentIndex === b.currentIndex && a.segmentCount === b.segmentCount
    && a.totalDuration === b.totalDuration && a.errorMessage === b.errorMessage
    && a.engineMode === b.engineMode && a.warmedSourceCount === b.warmedSourceCount
    && a.usesFrameCallback === b.usesFrameCallback && a.presentationMode === b.presentationMode;
}

/** Cached snapshots for useSyncExternalStore; getState() itself allocates on every read. */
export function createPreviewPlayerStore(player: PlayerSource) {
  let state = player.getState();
  let summary = summarize(state);
  const serverState = state;
  const serverSummary = summary;
  const frameListeners = new Set<() => void>();
  const summaryListeners = new Set<() => void>();
  let unsubscribe: (() => void) | null = null;

  const receive = (next: PreviewPlayerState) => {
    const nextSummary = summarize(next);
    const structuralChange = !sameSummary(summary, nextSummary);
    if (!structuralChange && state.currentTime === next.currentTime) return;
    state = next;
    if (structuralChange) summary = nextSummary;
    for (const listener of [...frameListeners]) listener();
    if (structuralChange) for (const listener of [...summaryListeners]) listener();
  };

  const subscribe = (listeners: Set<() => void>, listener: () => void) => {
    listeners.add(listener);
    if (!unsubscribe) {
      unsubscribe = player.subscribe(receive);
      // Catch a load/seek between render and subscription, including remounts.
      receive(player.getState());
    }
    return () => {
      listeners.delete(listener);
      if (frameListeners.size === 0 && summaryListeners.size === 0) {
        unsubscribe?.();
        unsubscribe = null;
      }
    };
  };

  return {
    getSnapshot: () => state,
    getServerSnapshot: () => serverState,
    subscribe: (listener: () => void) => subscribe(frameListeners, listener),
    getSummary: () => summary,
    getServerSummary: () => serverSummary,
    subscribeSummary: (listener: () => void) => subscribe(summaryListeners, listener),
  };
}

const stores = new WeakMap<PlayerSource, ReturnType<typeof createPreviewPlayerStore>>();
const emptyStore = createPreviewPlayerStore({ getState: createPreviewPlayerState, subscribe: () => () => {} });

export function getPreviewPlayerStore(player: PlayerSource | null) {
  if (!player) return emptyStore;
  let store = stores.get(player);
  if (!store) {
    store = createPreviewPlayerStore(player);
    stores.set(player, store);
  }
  return store;
}
