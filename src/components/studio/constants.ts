import type { SceneCaptionMode, Tab } from "./types";

/** Fast (LFM) captions stay in code for dev comparison; Smart is the product default. */
export const FAST_CAPTIONS_ENABLED = process.env.NEXT_PUBLIC_ENABLE_FAST_CAPTIONS === "1";

/**
 * Caption mode for the session. A draft saved while the Fast lane was enabled
 * must not reopen in a mode the UI can no longer switch away from.
 */
export function resolveCaptionMode(saved: SceneCaptionMode | undefined): SceneCaptionMode {
  if (saved === "fast" && !FAST_CAPTIONS_ENABLED) return "smart";
  return saved ?? "smart";
}

export const NAV: { key: Tab; label: string; sub: string }[] = [
  { key: "review", label: "Ingest", sub: "media ready" },
  { key: "story", label: "Story", sub: "SRT · sections" },
  { key: "split", label: "Split", sub: "scene · rhythm" },
  { key: "shuffle", label: "Match", sub: "lyrics · clips" },
  { key: "generate", label: "Generate", sub: "fill gaps" },
  { key: "join", label: "Join", sub: "assemble" },
  { key: "ramp", label: "Effects", sub: "GLSL · ramps" },
  { key: "compose", label: "Export", sub: "MP4 · WebGPU" },
];
