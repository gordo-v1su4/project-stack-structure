import { describe, expect, test } from "bun:test";
import { annotateMusicSections, matchesFallbackSectionBoundaries } from "@/components/studio/musicSectionProvenance";
import { parseEssentiaPayload } from "@/components/studio/audioAnalysis";

const duration = 246.69995464852607;
const boundaries = [0, 15, 45.24285066407515, 75.4857013281503, 105.72855199222546, 135.9714026563006, 166.21425332037578, 196.45710398445092, 226.69995464852607, duration];
const sections = boundaries.slice(0, -1).map((start, index) => ({ start, end: boundaries[index + 1], label: index === 0 ? "intro" : "verse" }));

describe("music section provenance", () => {
  test("baseline equal-time fallback is flagged with uncertainty without rewriting form", () => {
    expect(matchesFallbackSectionBoundaries(sections, duration + 0.00003)).toBe(true);
    const result = annotateMusicSections(sections, duration);
    expect(result[0].provenance.method).toBe("fallback-pattern");
    expect(result[0].provenance.reason).toContain("did not confirm");
    expect(result.map(({ label, start, end }) => ({ label, start, end }))).toEqual(sections);
  });
  test("uneven sections are not mislabeled fallback, but unverified form remains provisional", () => {
    const uneven = [{ label: "intro", start: 0, end: 12 }, { label: "verse", start: 12, end: 83 }, { label: "chorus", start: 83, end: duration }];
    expect(matchesFallbackSectionBoundaries(uneven, duration)).toBe(false);
    expect(annotateMusicSections(uneven, duration)[0].provenance.method).toBe("unverified-song-form");
  });
  test("explicit service metadata survives nested payload normalization", () => {
    const result = parseEssentiaPayload({ payload: { duration, structure: { sections, used_fallback: true } }, fileName: "song.wav", waveform: [], waveformDuration: duration, audioUrl: "song" });
    expect(result?.sections[0].provenance?.method).toBe("service-fallback");
    const roundtrip = parseEssentiaPayload({ payload: result, fileName: "song.wav", waveform: [], waveformDuration: duration, audioUrl: "song" });
    expect(roundtrip?.sections[0].provenance).toEqual(result?.sections[0].provenance);
  });
  test("missing sections become an editable section, not an invented intro", () => {
    const result = parseEssentiaPayload({ payload: { duration: 60, beats: [1] }, fileName: "song.wav", waveform: [], waveformDuration: 60, audioUrl: "song" });
    expect(result?.sections[0].label).toBe("Section");
    expect(result?.sections[0].provenance?.method).toBe("missing-analysis");
  });
});
