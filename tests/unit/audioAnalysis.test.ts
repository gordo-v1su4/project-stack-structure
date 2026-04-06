import { describe, expect, test } from "bun:test";
import { parseEssentiaPayload } from "../../src/components/studio/audioAnalysis";

describe("audioAnalysis.parseEssentiaPayload", () => {
  test("normalizes nested payloads into the beat join analysis model", () => {
    const parsed = parseEssentiaPayload({
      payload: {
        analysis: {
          duration: 6,
          energy: { curve: [0.1, 0.3, 0.8] },
          beats: [0, 1, 2, 3],
          onsets: [0.2, 0.9, 1.8],
          structure: {
            sections: [
              { label: "Intro", start: 0, end: 2, energy: 0.2 },
              { label: "Drop", start: 2, end: 6, energy: 0.8 },
            ],
          },
        },
      },
      fileName: "song.wav",
      waveform: [0.2, 0.5, 0.9],
      waveformDuration: 6,
      audioUrl: "blob:song",
    });

    expect(parsed?.duration).toBe(6);
    expect(parsed?.beats).toEqual([0, 1, 2, 3]);
    expect(parsed?.sections.map((section) => section.label)).toEqual(["Intro", "Drop"]);
    expect(parsed?.waveform).toEqual([0.2, 0.5, 0.9]);
  });

  test("returns null for unusable payloads", () => {
    const parsed = parseEssentiaPayload({
      payload: { foo: "bar" },
      fileName: "song.wav",
      waveform: [],
      waveformDuration: 0,
      audioUrl: "blob:song",
    });

    expect(parsed).toBeNull();
  });
});
