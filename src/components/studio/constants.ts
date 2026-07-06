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
