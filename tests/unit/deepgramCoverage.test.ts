import { describe, expect, test } from "bun:test";

import {
  isDeepgramCoverageSparse,
  measureDeepgramWordCoverage,
  mergeDeepgramTailResponse,
  pickRicherDeepgramResponse,
} from "@/components/studio/deepgramUtils";
import { sliceWavFromSeconds } from "@/lib/wavSlice";

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

describe("mergeDeepgramTailResponse", () => {
  function withUtterances(response: ReturnType<typeof makeResponse>, utterances: Array<{ start: number; end: number; transcript: string }>) {
    return { ...response, results: { ...response.results, utterances } };
  }

  test("stitches offset tail utterances after the primary coverage and drops junk", () => {
    const primary = withUtterances(makeResponse(158.6, [[21.7, 82.2]]), [
      { start: 21.7, end: 82.2, transcript: "Down on my knees." },
    ]);
    const tail = withUtterances(makeResponse(58.6, [[0.1, 5.3], [45.1, 46.9]]), [
      { start: 0.1, end: 5.3, transcript: "000000." },
      { start: 45.1, end: 46.9, transcript: "♪ Yeah yeah yeah ♪" },
    ]);

    const merged = mergeDeepgramTailResponse(primary, tail, 100) as typeof primary;
    const utterances = merged.results.utterances as Array<{ start: number; end: number; transcript: string }>;

    expect(utterances).toHaveLength(2);
    expect(utterances[1]).toMatchObject({ start: 145.1, end: 146.9, transcript: "Yeah yeah yeah" });
    // Junk with no letters ("000000.") is dropped even though it starts after coverage.
    expect(utterances.some((utterance) => utterance.transcript.includes("000000"))).toBe(false);
    const words = merged.results.channels[0].alternatives[0].words as Array<{ start: number }>;
    expect(words.some((word) => word.start > 100)).toBe(true);
  });

  test("returns the primary untouched when the tail found nothing new", () => {
    const primary = withUtterances(makeResponse(158.6, [[21.7, 82.2]]), [
      { start: 21.7, end: 82.2, transcript: "Down on my knees." },
    ]);
    const tail = withUtterances(makeResponse(58.6, []), []);
    expect(mergeDeepgramTailResponse(primary, tail, 100)).toBe(primary);
  });
});

describe("sliceWavFromSeconds", () => {
  function makeWav(seconds: number, sampleRate = 100, channels = 1, bytesPerSample = 2) {
    const blockAlign = channels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = seconds * byteRate;
    const out = new Uint8Array(44 + dataSize);
    const view = new DataView(out.buffer);
    const writeTag = (offset: number, tag: string) => { for (let i = 0; i < 4; i += 1) out[offset + i] = tag.charCodeAt(i); };
    writeTag(0, "RIFF");
    view.setUint32(4, out.length - 8, true);
    writeTag(8, "WAVE");
    writeTag(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bytesPerSample * 8, true);
    writeTag(36, "data");
    view.setUint32(40, dataSize, true);
    for (let i = 0; i < dataSize; i += 1) out[44 + i] = i % 251;
    return out;
  }

  test("slices PCM data at the requested time and patches header sizes", () => {
    const wav = makeWav(10);
    const sliced = sliceWavFromSeconds(wav, 6);

    expect(sliced).not.toBeNull();
    const view = new DataView(sliced!.buffer);
    expect(view.getUint32(40, true)).toBe(4 * 200); // 4 remaining seconds at 200 B/s
    expect(view.getUint32(4, true)).toBe(sliced!.length - 8);
    // First sliced data byte matches the source byte at the 6s offset.
    expect(sliced![44]).toBe(wav[44 + 6 * 200]);
  });

  test("rejects non-WAV bytes and out-of-range slices", () => {
    expect(sliceWavFromSeconds(new Uint8Array(64), 5)).toBeNull();
    expect(sliceWavFromSeconds(makeWav(10), 12)).toBeNull();
    expect(sliceWavFromSeconds(makeWav(10), 0)).toBeNull();
  });
});
