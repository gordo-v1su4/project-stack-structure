import { describe, expect, test } from "bun:test";

import {
  buildMasterAudioSliceFilterComplex,
  planExportAudioAssembly,
  type ExportTimelineSegment,
} from "@/components/studio/exportGeneration";

function segment(overrides: Partial<ExportTimelineSegment> & Pick<ExportTimelineSegment, "inputPath" | "startTime" | "endTime">): ExportTimelineSegment {
  return { ...overrides };
}

describe("export audio window assembly planning", () => {
  test("S1: windowed segments produce ordered master-audio slices matching the browser preview", () => {
    const segments = [
      segment({ inputPath: "/tmp/a.mp4", startTime: 0, endTime: 1.25, musicStart: 10, musicEnd: 11.25, label: "Intro" }),
      segment({ inputPath: "/tmp/b.mp4", startTime: 2, endTime: 4, musicStart: 40, musicEnd: 42, label: "Chorus" }),
      segment({ inputPath: "/tmp/a.mp4", startTime: 5, endTime: 6.5, musicStart: 20, musicEnd: 21.5, label: "Verse" }),
    ];

    const plan = planExportAudioAssembly(segments);

    expect(plan.mode).toBe("windowed-slices");
    if (plan.mode !== "windowed-slices") throw new Error("unreachable");
    // Slices follow SEGMENT order (Intro -> Chorus -> Verse), not music-time order.
    expect(plan.slices).toEqual([
      { start: 10, end: 11.25 },
      { start: 40, end: 42 },
      { start: 20, end: 21.5 },
    ]);
  });

  test("S2: segments without music windows retain legacy audio-from-zero", () => {
    const plan = planExportAudioAssembly([
      segment({ inputPath: "/tmp/a.mp4", startTime: 0, endTime: 2 }),
      segment({ inputPath: "/tmp/b.mp4", startTime: 1, endTime: 3 }),
    ]);

    expect(plan.mode).toBe("legacy-from-zero");
  });

  test("mixed input keeps windowed mode; a missing window falls back to contiguous output-cursor mapping", () => {
    const plan = planExportAudioAssembly([
      segment({ inputPath: "/tmp/a.mp4", startTime: 0, endTime: 1.5, musicStart: 30, musicEnd: 31.5 }),
      segment({ inputPath: "/tmp/b.mp4", startTime: 0, endTime: 2 }),
      segment({ inputPath: "/tmp/a.mp4", startTime: 3, endTime: 4.25, musicStart: 50, musicEnd: 51.25 }),
    ]);

    expect(plan.mode).toBe("windowed-slices");
    if (plan.mode !== "windowed-slices") throw new Error("unreachable");
    // Fallback maps on the OUTPUT timeline from zero, mirroring buildAutoShaderCues (musicStart ?? outputStart).
    expect(plan.slices).toEqual([
      { start: 30, end: 31.5 },
      { start: 1.5, end: 3.5 },
      { start: 50, end: 51.25 },
    ]);
  });

  test("empty or invalid segment lists stay legacy", () => {
    expect(planExportAudioAssembly([]).mode).toBe("legacy-from-zero");
    expect(
      planExportAudioAssembly([segment({ inputPath: "", startTime: 0, endTime: 2, musicStart: 5, musicEnd: 7 })]).mode,
    ).toBe("legacy-from-zero");
  });
});

describe("master audio slice filter graph", () => {
  test("builds one atrim branch per slice in order and concats audio-only", () => {
    const { filterComplex, mapLabel } = buildMasterAudioSliceFilterComplex([
      { start: 10, end: 11.25 },
      { start: 40, end: 42 },
    ]);

    expect(filterComplex).toContain("[0:a]atrim=start=10:end=11.25,asetpts=N/SR/TB[a0]");
    expect(filterComplex).toContain("[0:a]atrim=start=40:end=42,asetpts=N/SR/TB[a1]");
    expect(filterComplex.endsWith("[a0][a1]concat=n=2:v=0:a=1[out]")).toBe(true);
    expect(mapLabel).toBe("[out]");
  });

  test("single slice skips concat and maps straight to its trimmed branch", () => {
    const { filterComplex, mapLabel } = buildMasterAudioSliceFilterComplex([{ start: 12.5, end: 14 }]);

    expect(filterComplex).toBe("[0:a]atrim=start=12.5:end=14,asetpts=N/SR/TB[a0]");
    expect(mapLabel).toBe("[a0]");
  });
});
