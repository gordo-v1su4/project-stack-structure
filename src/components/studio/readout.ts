import { fmt, sv } from "./math";
import type { JoinClip, RampPreset, ShuffleMode, Tab } from "./types";

export function buildReadout(params: {
  tab: Tab;
  clipDur: number;
  splitSegmentCount: number;
  gpu: number;
  bpm: number;
  barsPerSeg: number;
  beatSplitSegmentCount: number;
  shuffleMode: ShuffleMode;
  minScore: number;
  lookahead: number;
  joinClips: JoinClip[];
  minDur: number;
  maxDur: number;
  lowEnergyRange: number;
  highEnergyRange: number;
  beatJoinReady: boolean;
  hasVideoSource?: boolean;
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
    splitSegmentCount,
    gpu,
    bpm,
    barsPerSeg,
    beatSplitSegmentCount,
    shuffleMode,
    minScore,
    lookahead,
    joinClips,
    minDur,
    maxDur,
    lowEnergyRange,
    highEnergyRange,
    beatJoinReady,
    hasVideoSource = true,
    chaos,
    onsetBoost,
    rampPreset,
    minSpeed,
    maxSpeed,
    rampDur,
  } = params;

  if (tab === "split") {
    if (!hasVideoSource) {
      return [
        ["Source", "Awaiting video"],
        ["State", "Locked"],
        ["GPU", `${gpu.toFixed(0)}%`],
        ["Codec", "H.264"],
      ];
    }
    return [
      ["Clip Dur", `${clipDur}s`],
      ["Est Clips", splitSegmentCount],
      ["GPU", `${gpu.toFixed(0)}%`],
      ["Codec", "H.264"],
    ];
  }
  if (tab === "beatsplit") {
    if (!hasVideoSource) {
      return [
        ["Source", "Awaiting video"],
        ["State", "Locked"],
        ["BPM", bpm],
        ["Bars/Seg", barsPerSeg],
      ];
    }
    return [
      ["BPM", bpm],
      ["Bars/Seg", barsPerSeg],
      ["Segments", beatSplitSegmentCount],
      ["Confidence", "94%"],
    ];
  }
  if (tab === "shuffle") {
    if (!hasVideoSource) {
      return [
        ["Source", "Awaiting video"],
        ["State", "Locked"],
        ["Mode", shuffleMode],
        ["Lookahead", lookahead],
      ];
    }
    return [
      ["Mode", shuffleMode],
      ["Clips", joinClips.length],
      ["Min Score", minScore.toFixed(2)],
      ["Lookahead", lookahead],
    ];
  }
  if (tab === "join") {
    if (!hasVideoSource) {
      return [
        ["Source", "Awaiting video"],
        ["State", "Locked"],
        ["Format", "MP4"],
        ["Output", "/output/"],
      ];
    }
    const active = joinClips.filter((c) => c.on);
    return [
      ["Active", active.length],
      ["Duration", fmt(active.reduce((a, c) => a + sv(c.id + 1) * 8 + 1, 0))],
      ["Format", "MP4"],
      ["Output", "/output/"],
    ];
  }
  if (tab === "beatjoin") {
    if (!beatJoinReady) {
      return [
        ["Source", "Awaiting upload"],
        ["State", "Locked"],
        ["Low Eng", lowEnergyRange.toFixed(2)],
        ["High Eng", highEnergyRange.toFixed(2)],
      ];
    }

    return [
      ["Min Dur", `${minDur.toFixed(2)}s`],
      ["Max Dur", `${maxDur.toFixed(2)}s`],
      ["Low Eng", lowEnergyRange.toFixed(2)],
      ["High Eng", highEnergyRange.toFixed(2)],
      ["Onset", onsetBoost.toFixed(2)],
      ["Chaos", chaos.toFixed(2)],
    ];
  }
  return [
    ...(hasVideoSource
      ? []
      : ([
          ["Source", "Awaiting video"],
          ["State", "Locked"],
        ] as [string, string | number][])),
    ["Preset", rampPreset],
    ["Min Spd", `${minSpeed}×`],
    ["Max Spd", `${maxSpeed}×`],
    ["Ramp", `${rampDur}s`],
  ];
}
