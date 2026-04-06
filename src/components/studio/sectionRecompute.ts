export type RecomputeStage = "idle" | "stale" | "recomputing" | "ready" | "swapped" | "cancelled";

export interface SectionPreviewJob {
  requestKey: string;
  sectionId: string;
  continuityMode: string;
  paramsHash: string;
  startedAt: string;
  progress: number;
}

export interface SectionPreviewReadyAsset {
  requestKey: string;
  assetKey: string;
  duration: number;
  generatedAt: string;
}

export interface SectionRecomputeState {
  stage: RecomputeStage;
  activeRequestKey: string | null;
  activeSectionId: string | null;
  staleRequestKeys: string[];
  progress: number;
  currentAssetKey: string | null;
  readyAsset: SectionPreviewReadyAsset | null;
  lastCompletedRequestKey: string | null;
  lastCancelledRequestKey: string | null;
  error: string | null;
}

export function createSectionRecomputeState(): SectionRecomputeState {
  return {
    stage: "idle",
    activeRequestKey: null,
    activeSectionId: null,
    staleRequestKeys: [],
    progress: 0,
    currentAssetKey: null,
    readyAsset: null,
    lastCompletedRequestKey: null,
    lastCancelledRequestKey: null,
    error: null,
  };
}

export function startSectionRecompute(state: SectionRecomputeState, job: SectionPreviewJob): SectionRecomputeState {
  const staleRequestKeys = state.activeRequestKey
    ? dedupe([state.activeRequestKey, ...state.staleRequestKeys])
    : [...state.staleRequestKeys];

  return {
    ...state,
    stage: state.currentAssetKey ? "stale" : "recomputing",
    activeRequestKey: job.requestKey,
    activeSectionId: job.sectionId,
    staleRequestKeys,
    progress: clampProgress(job.progress),
    readyAsset: null,
    error: null,
  };
}

export function markSectionRecomputeRunning(state: SectionRecomputeState, requestKey: string): SectionRecomputeState {
  if (state.activeRequestKey !== requestKey) return state;
  return {
    ...state,
    stage: "recomputing",
  };
}

export function updateSectionRecomputeProgress(
  state: SectionRecomputeState,
  params: { requestKey: string; progress: number },
): SectionRecomputeState {
  if (state.activeRequestKey !== params.requestKey) return state;
  return {
    ...state,
    progress: clampProgress(params.progress),
    stage: state.stage === "idle" ? "recomputing" : state.stage,
  };
}

export function markSectionReady(
  state: SectionRecomputeState,
  asset: SectionPreviewReadyAsset,
): SectionRecomputeState {
  if (state.activeRequestKey !== asset.requestKey) return state;

  return {
    ...state,
    stage: "ready",
    progress: 100,
    readyAsset: asset,
    error: null,
  };
}

export function swapReadySection(state: SectionRecomputeState, requestKey: string): SectionRecomputeState {
  if (state.activeRequestKey !== requestKey || state.readyAsset?.requestKey !== requestKey) {
    return state;
  }

  return {
    ...state,
    stage: "swapped",
    currentAssetKey: state.readyAsset.assetKey,
    lastCompletedRequestKey: requestKey,
    activeRequestKey: null,
    activeSectionId: null,
    staleRequestKeys: state.staleRequestKeys.filter((key) => key !== requestKey),
    progress: 100,
    readyAsset: null,
    error: null,
  };
}

export function cancelSectionRecompute(state: SectionRecomputeState, requestKey: string): SectionRecomputeState {
  const isActive = state.activeRequestKey === requestKey;
  const staleRequestKeys = state.staleRequestKeys.filter((key) => key !== requestKey);

  if (!isActive && staleRequestKeys.length === state.staleRequestKeys.length) {
    return state;
  }

  return {
    ...state,
    stage: "cancelled",
    activeRequestKey: isActive ? null : state.activeRequestKey,
    activeSectionId: isActive ? null : state.activeSectionId,
    staleRequestKeys,
    progress: isActive ? 0 : state.progress,
    readyAsset: isActive ? null : state.readyAsset,
    lastCancelledRequestKey: requestKey,
  };
}

export function failSectionRecompute(
  state: SectionRecomputeState,
  params: { requestKey: string; message: string },
): SectionRecomputeState {
  if (state.activeRequestKey !== params.requestKey) return state;
  return {
    ...state,
    stage: "cancelled",
    activeRequestKey: null,
    activeSectionId: null,
    progress: 0,
    readyAsset: null,
    lastCancelledRequestKey: params.requestKey,
    error: params.message,
  };
}

function clampProgress(progress: number) {
  return Math.max(0, Math.min(100, Math.round(progress)));
}

function dedupe(values: string[]) {
  return [...new Set(values)];
}
