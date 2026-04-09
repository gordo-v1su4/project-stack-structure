import { describe, expect, test } from "bun:test";
import {
  getEssentiaErrorMessage,
  parseEssentiaPayload,
  resolveEssentiaRequestTarget,
} from "../../src/components/studio/audioAnalysis";

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

describe("audioAnalysis.resolveEssentiaRequestTarget", () => {
  test("prefers direct browser uploads when public Essentia credentials are available", () => {
    const previousUrl = process.env.NEXT_PUBLIC_ESSENTIA_API_BASE_URL;
    const previousKey = process.env.NEXT_PUBLIC_ESSENTIA_API_KEY;

    process.env.NEXT_PUBLIC_ESSENTIA_API_BASE_URL = "https://essentia.example.dev/";
    process.env.NEXT_PUBLIC_ESSENTIA_API_KEY = "public-key";

    try {
      expect(resolveEssentiaRequestTarget()).toEqual({
        url: "https://essentia.example.dev/analyze/full",
        transport: "direct",
        headers: {
          Authorization: "Bearer public-key",
          "X-API-Key": "public-key",
        },
      });
    } finally {
      restoreEnvValue("NEXT_PUBLIC_ESSENTIA_API_BASE_URL", previousUrl);
      restoreEnvValue("NEXT_PUBLIC_ESSENTIA_API_KEY", previousKey);
    }
  });

  test("falls back to the local proxy when public Essentia credentials are missing", () => {
    const previousUrl = process.env.NEXT_PUBLIC_ESSENTIA_API_BASE_URL;
    const previousKey = process.env.NEXT_PUBLIC_ESSENTIA_API_KEY;

    delete process.env.NEXT_PUBLIC_ESSENTIA_API_BASE_URL;
    delete process.env.NEXT_PUBLIC_ESSENTIA_API_KEY;

    try {
      expect(resolveEssentiaRequestTarget()).toEqual({
        url: "/api/essentia/full",
        transport: "proxy",
      });
    } finally {
      restoreEnvValue("NEXT_PUBLIC_ESSENTIA_API_BASE_URL", previousUrl);
      restoreEnvValue("NEXT_PUBLIC_ESSENTIA_API_KEY", previousKey);
    }
  });
});

describe("audioAnalysis.getEssentiaErrorMessage", () => {
  test("explains 413 responses from the proxy path", () => {
    expect(
      getEssentiaErrorMessage({
        payload: null,
        status: 413,
        transport: "proxy",
      }),
    ).toContain("deployment");
  });

  test("surfaces direct Essentia error details when present", () => {
    expect(
      getEssentiaErrorMessage({
        payload: { detail: "Remote limit hit" },
        status: 413,
        transport: "direct",
      }),
    ).toBe("Remote limit hit");
  });
});

function restoreEnvValue(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}
