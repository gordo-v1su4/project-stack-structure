import { fmt, sv } from "./math";
import type { JoinClip, RampPreset, ShuffleMode, Tab } from "./types";

export function buildReadout(params: {
  tab: Tab;
  clipDur: number;
  splitSegmentCount: number;
  bpm: number;
  barsPerSeg: number;
  beatSplitSegmentCount: number;
  shuffleMode: ShuffleMode;
  minScore: number;
  lookahead: number;
  joinClips: JoinClip[];
  resolvedJoinClipCount?: number;
  resolvedJoinDuration?: number;
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
    shuffleMode,
    minScore,
    lookahead,
    joinClips,
    resolvedJoinClipCount,
    resolvedJoinDuration,
    beatJoinReady,
    hasVideoSource = true,
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
        ["Audio", beatJoinReady ? "Analyzed" : "None"],
        ["Codec", "H.264"],
      ];
    }
    return [
      ["Clip Dur", `${clipDur}s`],
      ["Est Clips", splitSegmentCount],
      ["Audio", beatJoinReady ? "Analyzed" : "None"],
      ["Codec", "H.264"],
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
  if (tab === "generate") {
    return [
      ...(hasVideoSource
        ? []
        : ([
            ["Source", "Awaiting video"],
            ["State", "Locked"],
          ] as [string, string | number][])),
      ["Mode", "fill gaps"],
      ["Frames", "first/mid/last"],
      ["Queue", "pending"],
      ["Tracks", "A/B/C/D"],
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
    return [
      ["Cuts", resolvedJoinClipCount ?? joinClips.filter((clip) => clip.on).length],
      ["Duration", fmt(resolvedJoinDuration ?? joinClips.filter((clip) => clip.on).reduce((total, clip) => total + sv(clip.id + 1) * 8 + 1, 0))],
      ["Format", "MP4"],
      ["Source", "Resolved edit"],
    ];
  }
  if (tab === "story" || tab === "compose") {
    return [
      ...(hasVideoSource
        ? []
        : ([
            ["Source", "Awaiting video"],
            ["State", "Locked"],
          ] as [string, string | number][])),
      ["Story", tab === "compose" ? "Compose" : "Draft"],
      ["Lyrics", beatJoinReady ? "Timed" : "Waiting"],
      ["Preview", "Instant"],
      ["Export", "MP4/WebGPU"],
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
