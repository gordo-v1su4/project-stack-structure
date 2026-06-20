import type { Tab } from "./types";

export const NAV: { key: Tab; label: string; sub: string }[] = [
  { key: "review", label: "Ingest", sub: "media ready" },
  { key: "story", label: "Story", sub: "SRT · sections" },
  { key: "split", label: "Split", sub: "scene · beat" },
  { key: "shuffle", label: "Match", sub: "lyrics · clips" },
  { key: "generate", label: "Generate", sub: "fill gaps" },
  { key: "join", label: "Join", sub: "assemble" },
  { key: "ramp", label: "Transitions / Effects", sub: "GLSL · ramps" },
  { key: "compose", label: "Preview / Export", sub: "MP4 · WebGPU" },
];

export const LOG = [
  { tag: "SYSTEM", msg: "INIT_KERNEL_SUCCESS", col: "#555" },
  { tag: "AUDIO", msg: "FFMPEG_LISTEN_PORT: 8080", col: "#e05c00" },
  { tag: "VIDEO", msg: "NV_ENC_CONTEXT_READY", col: "#555" },
  { tag: "GPU", msg: "TEMP_STABLE_42C", col: "#e05c00" },
  { tag: "CUDA", msg: "SM_120 ACTIVE · 16384 CORES", col: "#555" },
] as const;
