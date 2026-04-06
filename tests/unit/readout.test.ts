import { describe, expect, test } from "bun:test";
import { buildReadout } from "../../src/components/studio/readout";
import { makeJoinClips } from "../helpers/studioFixtures";

describe("readout", () => {
  test("split tab without video returns locked status", () => {
    const rows = buildReadout({
      tab: "split",
      clipDur: 5,
      splitSegmentCount: 4,
      gpu: 20,
      bpm: 120,
      barsPerSeg: 2,
      beatSplitSegmentCount: 6,
      shuffleMode: "motion",
      minScore: 0.4,
      lookahead: 3,
      joinClips: makeJoinClips(),
      minDur: 0.2,
      maxDur: 0.8,
      lowEnergyRange: 0.3,
      highEnergyRange: 0.7,
      beatJoinReady: false,
      hasVideoSource: false,
      chaos: 0.3,
      onsetBoost: 0.6,
      rampPreset: "dynamic",
      minSpeed: 0.5,
      maxSpeed: 2,
      rampDur: 0.5,
    });

    expect(rows).toEqual([
      ["Source", "Awaiting video"],
      ["State", "Locked"],
      ["GPU", "20%"],
      ["Codec", "H.264"],
    ]);
  });

  test("beatjoin tab exposes onset and chaos when ready", () => {
    const rows = buildReadout({
      tab: "beatjoin",
      clipDur: 5,
      splitSegmentCount: 4,
      gpu: 20,
      bpm: 120,
      barsPerSeg: 2,
      beatSplitSegmentCount: 6,
      shuffleMode: "motion",
      minScore: 0.4,
      lookahead: 3,
      joinClips: makeJoinClips(),
      minDur: 0.22,
      maxDur: 0.88,
      lowEnergyRange: 0.31,
      highEnergyRange: 0.72,
      beatJoinReady: true,
      hasVideoSource: true,
      chaos: 0.35,
      onsetBoost: 0.65,
      rampPreset: "dynamic",
      minSpeed: 0.5,
      maxSpeed: 2,
      rampDur: 0.5,
    });

    expect(rows).toContainEqual(["Onset", "0.65"]);
    expect(rows).toContainEqual(["Chaos", "0.35"]);
  });
});
