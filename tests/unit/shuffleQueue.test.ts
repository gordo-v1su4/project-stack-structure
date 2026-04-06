import { describe, expect, test } from "bun:test";
import { buildShuffleQueue } from "../../src/components/studio/shuffleQueue";

describe("shuffleQueue", () => {
  test("motion mode starts from the active clip and visits each clip once", () => {
    const queue = buildShuffleQueue({
      clipCount: 6,
      shuffleMode: "motion",
      activeClip: 3,
      minScore: 0.3,
      lookahead: 3,
      keepPct: 70,
      colorGradient: "Sunset",
    });

    expect(queue[0]).toBe(3);
    expect(queue).toHaveLength(6);
    expect(new Set(queue).size).toBe(6);
  });

  test("color mode is deterministic for the same inputs", () => {
    const left = buildShuffleQueue({
      clipCount: 8,
      shuffleMode: "color",
      activeClip: 0,
      minScore: 0.4,
      lookahead: 2,
      keepPct: 60,
      colorGradient: "Ocean",
    });
    const right = buildShuffleQueue({
      clipCount: 8,
      shuffleMode: "color",
      activeClip: 0,
      minScore: 0.4,
      lookahead: 2,
      keepPct: 60,
      colorGradient: "Ocean",
    });

    expect(left).toEqual(right);
  });
});
