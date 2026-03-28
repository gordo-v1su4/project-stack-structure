import type { Tab } from "./types";

export const NAV: { key: Tab; label: string; sub: string }[] = [
  { key: "split", label: "Standard Split", sub: "GPU / CUDA" },
  { key: "beatsplit", label: "Beat Split", sub: "BPM sync" },
  { key: "shuffle", label: "Shuffle Modes", sub: "5 algorithms" },
  { key: "join", label: "Standard Join", sub: "Concat" },
  { key: "beatjoin", label: "Beat Join", sub: "Energy reactive" },
  { key: "ramp", label: "Speed Ramp", sub: "Envelope curve" },
];

export const LOG = [
  { tag: "SYSTEM", msg: "INIT_KERNEL_SUCCESS", col: "#555" },
  { tag: "AUDIO", msg: "FFMPEG_LISTEN_PORT: 8080", col: "#e05c00" },
  { tag: "VIDEO", msg: "NV_ENC_CONTEXT_READY", col: "#555" },
  { tag: "GPU", msg: "TEMP_STABLE_42C", col: "#e05c00" },
  { tag: "CUDA", msg: "SM_120 ACTIVE · 16384 CORES", col: "#555" },
] as const;
