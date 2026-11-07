import { expect, test } from "bun:test";
import { buildAdaptiveCueMap } from "@/components/studio/adaptiveCueMap";
import type { BeatJoinAnalysis } from "@/components/studio/types";
import type { MusicVideoProject } from "@/components/studio/musicVideoProject";

const analysis: BeatJoinAnalysis = { sourceLabel: "master.wav", audioUrl: "", duration: 24,
  waveform: [0.3, 1, 0.4, 0.8], energy: [0.3, 1, 0.4, 0.8], beats: Array.from({ length: 48 }, (_, i) => i / 2),
  onsets: [1, 2.5, 4, 5.5, 7, 8.5, 10, 11.5, 13, 14.5, 16, 17.5, 19, 20.5, 22, 23], sections: [] };
const project: MusicVideoProject = { id: "unchanged", song: analysis, duration: 24, lyricChunks: [],
  storySections: [{ id: "verse", label: "Verse", start: 0, end: 24, energy: 0.7, prompt: "", source: "analysis", lyricChunkIds: [], videoMomentIds: [] }],
  videoMoments: [], editPlan: { id: "cut", createdAt: "2026-11-07", timelineItems: [] }, reviewFindings: [] };
const map = (fast: boolean, song = analysis) => buildAdaptiveCueMap({ analysis: song, project, density: 0.65,
  editSettings: { cutDensity: fast ? 0.82 : 0.55, preferOnsets: true } });

test("Fast exposes 1–3s cue-snapped suggestions while Balanced retains its four-second floor", () => {
  const before = JSON.stringify(project), fast = map(true), balanced = map(false);
  expect(fast.chunks.length).toBeGreaterThan(balanced.chunks.length);
  expect(fast.chunks.every(c => c.end - c.start >= 1 && c.end - c.start <= 3)).toBe(true);
  expect(balanced.chunks.every(c => c.end - c.start >= 4)).toBe(true);
  const actual = new Set([...analysis.onsets, ...analysis.beats]);
  for (const chunk of fast.chunks.slice(1)) expect(actual.has(chunk.start)).toBe(true);
  expect(JSON.stringify(project)).toBe(before);
});

test("Fast can use actual beats when onset detections are sparse", () => {
  const fast = map(true, { ...analysis, onsets: [] });
  expect(fast.markers.some(marker => marker.kind === "beat" && marker.active)).toBe(true);
  expect(fast.chunks.every(c => c.end - c.start >= 1 && c.end - c.start <= 3)).toBe(true);
  for (const chunk of fast.chunks.slice(1)) expect(analysis.beats.includes(chunk.start)).toBe(true);
});

test("dragging Fast density changes actual selected boundaries, not just the displayed percentage", () => {
  const low = buildAdaptiveCueMap({ analysis, project, density: 0.05, editSettings: { cutDensity: 0.82, preferOnsets: true } });
  const high = buildAdaptiveCueMap({ analysis, project, density: 1, editSettings: { cutDensity: 0.82, preferOnsets: true } });
  expect(low.chunks.map(c => [c.start, c.end])).not.toEqual(high.chunks.map(c => [c.start, c.end]));
  expect(high.chunks.length).toBeGreaterThan(low.chunks.length);
  const actual = new Set([...analysis.onsets, ...analysis.beats]);
  for (const result of [low, high]) {
    expect(result.chunks.every(c => c.end - c.start >= 1 && c.end - c.start <= 3)).toBe(true);
    for (const chunk of result.chunks.slice(1)) expect(actual.has(chunk.start)).toBe(true);
  }
});

test("Fast never fabricates a uniform snap grid when no real musical cues exist", () => {
  const fast = map(true, { ...analysis, onsets: [], beats: [] });
  expect(fast.chunks.map(c => [c.start, c.end])).toEqual([[0, 24]]);
  expect(fast.markers).toEqual([]);
});

test("Fast retains exact selected phrase timestamps and section endpoints", () => {
  const phraseProject = { ...project, lyricChunks: [
    { id: "phrase", index: 1, start: 3.125, end: 9.125, text: "phrase", lyrics: "phrase" },
  ] };
  const result = buildAdaptiveCueMap({ analysis, project: phraseProject, density: 1, lyricBlend: 1, lyricMergeWindowSeconds: 0,
    editSettings: { cutDensity: 0.82, preferOnsets: true } });
  const active = result.markers.filter(marker => marker.kind === "lyric" && marker.active);
  expect(active.length).toBeGreaterThan(0);
  for (const marker of active) expect(result.chunks.some(chunk => chunk.start === marker.time)).toBe(true);
  expect(result.chunks[0].start).toBe(0); expect(result.chunks.at(-1)!.end).toBe(24);
});
