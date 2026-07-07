import { describe, expect, test } from "bun:test";

import {
  isDeepgramCoverageSparse,
  measureDeepgramWordCoverage,
  pickRicherDeepgramResponse,
} from "@/components/studio/deepgramUtils";

function makeResponse(duration: number, words: Array<[number, number]>) {
  return {
    metadata: { duration },
    results: {
      channels: [{
        alternatives: [{
          transcript: words.map(() => "word").join(" "),
          words: words.map(([start, end]) => ({ word: "word", start, end })),
        }],
      }],
    },
  };
}

describe("deepgram word coverage", () => {
  test("measures duration, last word end, and word count", () => {
    const coverage = measureDeepgramWordCoverage(makeResponse(158.6, [[21.7, 23.8], [80.1, 82.2]]));
    expect(coverage).toEqual({ duration: 158.6, lastWordEnd: 82.2, wordCount: 2 });
  });

  test("flags sung-vocal dropout: long audio whose words stop early (the 1:22 case)", () => {
    // Real failure: 158.6s song, nova-3 words end at 82.2s.
    expect(isDeepgramCoverageSparse({ duration: 158.6, lastWordEnd: 82.2, wordCount: 60 })).toBe(true);
    expect(isDeepgramCoverageSparse({ duration: 158.6, lastWordEnd: 0, wordCount: 0 })).toBe(true);
  });

  test("does not flag full coverage or short clips", () => {
    expect(isDeepgramCoverageSparse({ duration: 158.6, lastWordEnd: 150.2, wordCount: 240 })).toBe(false);
    expect(isDeepgramCoverageSparse({ duration: 20, lastWordEnd: 4, wordCount: 8 })).toBe(false);
  });
});

describe("pickRicherDeepgramResponse", () => {
  test("prefers the retry when its words cover meaningfully more of the song", () => {
    const primary = makeResponse(158.6, [[21.7, 82.2]]);
    const fallback = makeResponse(158.6, [[21.7, 82.2], [90, 150.4]]);
    expect(pickRicherDeepgramResponse(primary, fallback)).toBe(fallback);
  });

  test("keeps the primary when the retry is empty or not better", () => {
    const primary = makeResponse(158.6, [[21.7, 82.2], [90, 150.4]]);
    const empty = makeResponse(158.6, []);
    const similar = makeResponse(158.6, [[21.7, 82.2], [90, 149.0]]);
    expect(pickRicherDeepgramResponse(primary, empty)).toBe(primary);
    expect(pickRicherDeepgramResponse(primary, similar)).toBe(primary);
  });

  test("takes the retry when the primary heard nothing at all", () => {
    const primary = makeResponse(158.6, []);
    const fallback = makeResponse(158.6, [[10, 20]]);
    expect(pickRicherDeepgramResponse(primary, fallback)).toBe(fallback);
  });
});
