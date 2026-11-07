import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MusicCutExplorer } from "@/components/studio/panels/MusicCutExplorer";
import type { BeatJoinAnalysis } from "@/components/studio/types";

let seed = 1;
const nextSignal = () => { seed = seed * 16807 % 2147483647; return seed / 2147483647; };
const analysis: BeatJoinAnalysis = { sourceLabel: "master.wav", audioUrl: "", duration: 64,
  waveform: Array.from({ length: 64 }, nextSignal), energy: Array.from({ length: 64 }, nextSignal),
  onsets: Array.from({ length: 45 }, () => Math.round(nextSignal() * 63 * 2) / 2).sort((a, b) => a - b),
  beats: Array.from({ length: 128 }, (_, index) => index / 2), sections: [] };
const render = (density: number, song: BeatJoinAnalysis | null = analysis) => renderToStaticMarkup(createElement(MusicCutExplorer, {
  analysis: song, project: null, onsetDensity: density, lyricCueBlend: 60, lyricMergeWindow: 3,
  onOnsetDensity: () => {}, onLyricCueBlend: () => {}, onLyricMergeWindow: () => {},
}));

test("master-only exploration exposes sliders and precise block selection without a confirmed story or footage", () => {
  const markup = render(65);
  for (const label of ["Music and cut timing", "Cue density", "Lyric influence", "Combine nearby cues", "Reset suggestions", "Selected suggestion:"])
    expect(markup).toContain(label);
  expect(markup).toContain('aria-label="Suggested block ');
  expect(markup).toContain('aria-pressed="true"');
  expect(markup).toContain("do not change your saved cut or approvals");
  expect(markup).toContain("section and spacing boundaries may fall between beats");
});

test("density changes the live suggestion while preserving input analysis and nullable project", () => {
  const before = JSON.stringify(analysis);
  const blocks = (density: number) => [...render(density).matchAll(/aria-label="Suggested block ([^"]+)"/g)].map(match => match[1]);
  expect(blocks(5)).not.toEqual(blocks(100));
  expect(JSON.stringify(analysis)).toBe(before);
});

test("missing analysis retains visible controls and an honest empty graph", () => {
  const markup = render(65, null);
  expect(markup).toContain("0 suggested blocks");
  expect(markup).toContain("Upload/analyze master song");
  expect(markup).not.toContain("Selected suggestion:");
});
