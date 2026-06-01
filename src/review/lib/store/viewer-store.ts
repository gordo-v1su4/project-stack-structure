import { create } from "zustand";

export type ViewerMode = "video" | "image" | "empty";
export type CompareMode = "off" | "wipe" | "side";

interface ViewerState {
  mode: ViewerMode;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  fps: number;
  playbackRate: number;
  loop: boolean;
  zoom: number; // image zoom, 1 = fit
  compare: CompareMode;
  annotateArmed: boolean;
  // image-load decode error
  decodeError: string | null;
  // intent the <video> element listens for (one-shot seek targets)
  seekRequest: number | null;
  stepRequest: number | null;

  setMode: (m: ViewerMode) => void;
  setPlaying: (p: boolean) => void;
  togglePlay: () => void;
  setCurrentTime: (t: number) => void;
  setDuration: (d: number) => void;
  setFps: (f: number) => void;
  setPlaybackRate: (r: number) => void;
  toggleLoop: () => void;
  setZoom: (z: number) => void;
  setCompare: (c: CompareMode) => void;
  setAnnotateArmed: (a: boolean) => void;
  setDecodeError: (e: string | null) => void;
  requestSeek: (t: number) => void;
  clearSeek: () => void;
  requestStep: (frames: number) => void;
  clearStep: () => void;
  reset: () => void;
}

export const useViewerStore = create<ViewerState>((set, get) => ({
  mode: "empty",
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  fps: 30,
  playbackRate: 1,
  loop: false,
  zoom: 1,
  compare: "off",
  annotateArmed: false,
  decodeError: null,
  seekRequest: null,
  stepRequest: null,

  setMode: (mode) => set({ mode }),
  setPlaying: (isPlaying) => set({ isPlaying }),
  togglePlay: () => set({ isPlaying: !get().isPlaying }),
  setCurrentTime: (currentTime) => set({ currentTime }),
  setDuration: (duration) => set({ duration }),
  setFps: (fps) => set({ fps }),
  setPlaybackRate: (playbackRate) => set({ playbackRate }),
  toggleLoop: () => set({ loop: !get().loop }),
  setZoom: (zoom) => set({ zoom: Math.max(0.1, Math.min(zoom, 8)) }),
  setCompare: (compare) => set({ compare }),
  setAnnotateArmed: (annotateArmed) => set({ annotateArmed }),
  setDecodeError: (decodeError) => set({ decodeError }),
  requestSeek: (seekRequest) => set({ seekRequest }),
  clearSeek: () => set({ seekRequest: null }),
  requestStep: (stepRequest) => set({ stepRequest }),
  clearStep: () => set({ stepRequest: null }),
  reset: () =>
    set({
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      playbackRate: 1,
      loop: false,
      zoom: 1,
      compare: "off",
      annotateArmed: false,
      decodeError: null,
      seekRequest: null,
      stepRequest: null,
    }),
}));
