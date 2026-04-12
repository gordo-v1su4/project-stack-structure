import { describe, expect, test } from "bun:test";

import {
  abbreviateSectionLabel,
  buildArrangementSegments,
  classifyEnergyTone,
  getSegmentColor,
} from "@/components/studio/arrangementBuilder";
import type { BeatJoinAnalysis } from "@/components/studio/types";

function createMockAnalysis(overrides: Partial<BeatJoinAnalysis> = {}): BeatJoinAnalysis {
  return {
    sourceLabel: "test-song.wav",
    audioUrl: "blob:test",
    waveform: [0.3, 0.5, 0.7, 0.5, 0.3, 0.6, 0.8, 0.4],
    energy: [0.2, 0.4, 0.6, 0.8, 0.3, 0.5, 0.7, 0.4],
    beats: [0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0],
    onsets: [0.1, 0.6, 1.1, 1.8, 2.3],
    sections: [
      { label: "Intro", start: 0, end: 1.5 },
      { label: "Drop", start: 1.5, end: 3.0 },
    ],
    duration: 3.0,
    ...overrides,
  };
}

describe("classifyEnergyTone", () => {
  test("returns mid when not energy reactive", () => {
    expect(classifyEnergyTone(0.1, 0.3, 0.7, false)).toBe("mid");
  });

  test("returns low for low energy", () => {
    expect(classifyEnergyTone(0.1, 0.3, 0.7, true)).toBe("low");
  });

  test("returns high for high energy", () => {
    expect(classifyEnergyTone(0.8, 0.3, 0.7, true)).toBe("high");
  });

  test("returns mid for mid energy", () => {
    expect(classifyEnergyTone(0.5, 0.3, 0.7, true)).toBe("mid");
  });
});

describe("abbreviateSectionLabel", () => {
  test("abbreviates intro", () => {
    expect(abbreviateSectionLabel("Intro")).toBe("I");
  });

  test("abbreviates verse with number", () => {
    expect(abbreviateSectionLabel("Verse 2")).toBe("V2");
  });

  test("abbreviates chorus", () => {
    expect(abbreviateSectionLabel("Chorus")).toBe("Ch");
  });

  test("abbreviates bridge", () => {
    expect(abbreviateSectionLabel("Bridge")).toBe("Br");
  });

  test("abbreviates outro", () => {
    expect(abbreviateSectionLabel("Outro")).toBe("O");
  });

  test("abbreviates drop", () => {
    expect(abbreviateSectionLabel("Drop")).toBe("Dr");
  });

  test("truncates unknown labels", () => {
    expect(abbreviateSectionLabel("Breakdown")).toBe("Bre");
  });

  test("handles empty string", () => {
    expect(abbreviateSectionLabel("")).toBe("S");
  });
});

describe("getSegmentColor", () => {
  test("returns gradient for low tone segment", () => {
    const segment = { id: 0, clipId: 0, start: 0, end: 1, duration: 1, energy: 0.1, detailLabel: "HOLD", tone: "low" as const };
    const color = getSegmentColor(segment, "motion");
    expect(color).toContain("linear-gradient");
  });

  test("returns gradient for high tone segment", () => {
    const segment = { id: 0, clipId: 0, start: 0, end: 1, duration: 1, energy: 0.9, detailLabel: "RUSH", tone: "high" as const };
    const color = getSegmentColor(segment, "motion");
    expect(color).toContain("linear-gradient");
  });

  test("returns gradient for mid tone segment", () => {
    const segment = { id: 0, clipId: 0, start: 0, end: 1, duration: 1, energy: 0.5, detailLabel: "CUT", tone: "mid" as const };
    const color = getSegmentColor(segment, "motion");
    expect(color).toContain("linear-gradient");
  });
});

describe("buildArrangementSegments", () => {
  test("returns empty array when no analysis provided", () => {
    const result = buildArrangementSegments({
      analysis: createMockAnalysis({ duration: 0, beats: [], onsets: [], sections: [], waveform: [], energy: [] }),
      clipOrder: [],
      minDur: 0.12,
      maxDur: 0.8,
      energyResp: 1.5,
      energyReactive: true,
      lowEnergyRange: 0.36,
      highEnergyRange: 0.68,
      onsetBoost: 0.6,
      chaos: 0.35,
    });
    expect(result).toEqual([]);
  });

  test("produces segments from mock analysis", () => {
    const result = buildArrangementSegments({
      analysis: createMockAnalysis(),
      clipOrder: [0, 1],
      minDur: 0.12,
      maxDur: 0.8,
      energyResp: 1.5,
      energyReactive: true,
      lowEnergyRange: 0.36,
      highEnergyRange: 0.68,
      onsetBoost: 0.6,
      chaos: 0.35,
    });
    expect(result.length).toBeGreaterThan(0);
    for (const segment of result) {
      expect(segment.duration).toBeGreaterThan(0);
      expect(segment.end).toBeGreaterThan(segment.start);
      expect(segment.clipId).toBeGreaterThanOrEqual(0);
      expect(["low", "mid", "high"]).toContain(segment.tone);
    }
  });

  test("each segment has required fields", () => {
    const result = buildArrangementSegments({
      analysis: createMockAnalysis(),
      clipOrder: [0],
      minDur: 0.12,
      maxDur: 0.8,
      energyResp: 1.5,
      energyReactive: false,
      lowEnergyRange: 0.36,
      highEnergyRange: 0.68,
      onsetBoost: 0.6,
      chaos: 0.35,
    });
    for (const segment of result) {
      expect(typeof segment.id).toBe("number");
      expect(typeof segment.clipId).toBe("number");
      expect(typeof segment.start).toBe("number");
      expect(typeof segment.end).toBe("number");
      expect(typeof segment.duration).toBe("number");
      expect(typeof segment.energy).toBe("number");
      expect(typeof segment.detailLabel).toBe("string");
      expect(["low", "mid", "high"]).toContain(segment.tone);
    }
  });
});
