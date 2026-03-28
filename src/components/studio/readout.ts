import { fmt, sv } from "./math";
import type { JoinClip, RampPreset, ShuffleMode, Tab } from "./types";

export function buildReadout(params: {
  tab: Tab;
  clipDur: number;
  gpu: number;
  bpm: number;
  barsPerSeg: number;
  shuffleMode: ShuffleMode;
  minScore: number;
  lookahead: number;
  joinClips: JoinClip[];
  minDur: number;
  maxDur: number;
  chaos: number;
  onsetBoost: number;
  rampPreset: RampPreset;
  minSpeed: number;
  maxSpeed: number;
  rampDur: number;
}): [string, string | number][] {
  const {
    tab,
    clipDur,
    gpu,
    bpm,
    barsPerSeg,
    shuffleMode,
    minScore,
    lookahead,
    joinClips,
    minDur,
    maxDur,
    chaos,
    onsetBoost,
    rampPreset,
    minSpeed,
    maxSpeed,
    rampDur,
  } = params;

  if (tab === "split") {
    return [
      ["Clip Dur", `${clipDur}s`],
      ["Est Clips", Math.floor(300 / clipDur)],
      ["GPU", `${gpu.toFixed(0)}%`],
      ["Codec", "H.264"],
    ];
  }
  if (tab === "beatsplit") {
    return [
      ["BPM", bpm],
      ["Bars/Seg", barsPerSeg],
      ["Segments", Math.floor(16 / barsPerSeg)],
      ["Confidence", "94%"],
    ];
  }
  if (tab === "shuffle") {
    return [
      ["Mode", shuffleMode],
      ["Clips", 12],
      ["Min Score", minScore.toFixed(2)],
      ["Lookahead", lookahead],
    ];
  }
  if (tab === "join") {
    const active = joinClips.filter((c) => c.on);
    return [
      ["Active", active.length],
      ["Duration", fmt(active.reduce((a, c) => a + sv(c.id + 1) * 8 + 1, 0))],
      ["Format", "MP4"],
      ["Output", "/output/"],
    ];
  }
  if (tab === "beatjoin") {
    return [
      ["Min Dur", `${minDur.toFixed(2)}s`],
      ["Max Dur", `${maxDur.toFixed(2)}s`],
      ["Chaos", chaos.toFixed(2)],
      ["Onset", onsetBoost.toFixed(2)],
    ];
  }
  return [
    ["Preset", rampPreset],
    ["Min Spd", `${minSpeed}×`],
    ["Max Spd", `${maxSpeed}×`],
    ["Ramp", `${rampDur}s`],
  ];
}
