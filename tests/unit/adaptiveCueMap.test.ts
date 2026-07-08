import { describe, expect, test } from "bun:test";

import { buildAdaptiveCueMap } from "@/components/studio/adaptiveCueMap";
import { shouldWarnForEarlySrtEnd } from "@/components/studio/panels/MatchMusicCueTimeline";
import type { MusicVideoProject } from "@/components/studio/musicVideoProject";
import type { BeatJoinAnalysis } from "@/components/studio/types";

const analysis: BeatJoinAnalysis = {
  sourceLabel: "song.wav",
  audioUrl: "",
  waveform: Array.from({ length: 40 }, (_, index) => (index % 5) / 5),
  energy: Array.from({ length: 40 }, (_, index) => 0.35 + (index % 7) / 14),
  beats: Array.from({ length: 20 }, (_, index) => index),
  onsets: [5, 10, 15],
  sections: [{ label: "Verse", start: 0, end: 20, energy: 0.5 }],
  duration: 20,
};

const project: MusicVideoProject = {
  id: "project",
  song: analysis,
  duration: 20,
  lyricChunks: [
    { id: "lyric-1", index: 1, start: 3, end: 8, text: "first phrase", lyrics: "first phrase" },
    { id: "lyric-2", index: 2, start: 9, end: 13, text: "second phrase", lyrics: "second phrase" },
    { id: "lyric-3", index: 3, start: 16, end: 18, text: "third phrase", lyrics: "third phrase" },
  ],
  storySections: [{ id: "verse", label: "Verse", start: 0, end: 20, energy: 0.5, prompt: "story", source: "analysis", lyricChunkIds: [], videoMomentIds: [] }],
  videoMoments: [],
  editPlan: { id: "plan", createdAt: "2026-06-20T00:00:00.000Z", timelineItems: [] },
  reviewFindings: [],
};

describe("adaptive cue map lyric/SRT blending", () => {
  test("keeps legacy onset-only behavior when lyric blend is zero", () => {
    const withoutLyrics = buildAdaptiveCueMap({ analysis, project, density: 0.65, lyricBlend: 0, lyricMergeWindowSeconds: 3 });

    expect(withoutLyrics.lyricCount).toBeGreaterThan(0);
    expect(withoutLyrics.lyricActiveCount).toBe(0);
    expect(withoutLyrics.lyricMergedCount).toBe(0);
    expect(withoutLyrics.chunks.every((chunk) => chunk.lyricCueCount === 0)).toBe(true);
  });

  test("adds SRT phrase boundaries as lyric cue cuts", () => {
    const onsetOnly = buildAdaptiveCueMap({ analysis, project, density: 0.65, lyricBlend: 0, lyricMergeWindowSeconds: 0 });
    const blended = buildAdaptiveCueMap({ analysis, project, density: 0.65, lyricBlend: 1, lyricMergeWindowSeconds: 0 });

    expect(blended.lyricActiveCount).toBeGreaterThan(0);
    expect(blended.chunks.length).toBeGreaterThan(onsetOnly.chunks.length);
    expect(blended.markers.some((marker) => marker.kind === "lyric" && marker.active)).toBe(true);
    expect(blended.chunks.some((chunk) => chunk.lyricCueCount > 0)).toBe(true);
  });

  test("covers the whole song even when story sections do not, so SRT cuts appear everywhere", () => {
    // Section only covers the first 8s of a 20s song; the singer keeps going.
    const partialProject: MusicVideoProject = {
      ...project,
      storySections: [{ id: "verse", label: "Verse", start: 0, end: 8, energy: 0.5, prompt: "story", source: "analysis", lyricChunkIds: [], videoMomentIds: [] }],
    };
    const map = buildAdaptiveCueMap({ analysis, project: partialProject, density: 0.65, lyricBlend: 1, lyricMergeWindowSeconds: 0 });

    const lastChunk = map.chunks[map.chunks.length - 1];
    expect(lastChunk?.end).toBe(20);
    expect(map.chunks.some((chunk) => chunk.sectionLabel === "Unmapped")).toBe(true);
    // Lyrics at 9–13s and 16–18s are outside the section but must become cuts.
    expect(map.markers.some((marker) => marker.kind === "lyric" && marker.time > 8 && marker.active)).toBe(true);
  });

  test("caps chunk duration so strength-clustered onsets cannot leave giant blocks", () => {
    const map = buildAdaptiveCueMap({ analysis, project, density: 0.9, lyricBlend: 0, lyricMergeWindowSeconds: 0 });
    const maxChunkSeconds = Math.max(1.2, 6.5 - 0.9 * 4.6);

    expect(map.chunks.length).toBeGreaterThan(3);
    for (const chunk of map.chunks) {
      expect(chunk.end - chunk.start).toBeLessThanOrEqual(maxChunkSeconds + 0.001);
    }
  });

  test("merges lyric cues near selected music onsets instead of double-counting cuts", () => {
    const noMerge = buildAdaptiveCueMap({ analysis, project, density: 0.65, lyricBlend: 1, lyricMergeWindowSeconds: 0 });
    const merged = buildAdaptiveCueMap({ analysis, project, density: 0.65, lyricBlend: 1, lyricMergeWindowSeconds: 2 });

    expect(merged.lyricMergedCount).toBeGreaterThan(0);
    expect(merged.chunks.length).toBeLessThan(noMerge.chunks.length);
    expect(merged.markers.some((marker) => marker.kind === "lyric" && marker.mergedWithTime !== undefined)).toBe(true);
  });

  test("does not warn about incomplete lyrics when sparse phrases still reach the end of the song", () => {
    expect(shouldWarnForEarlySrtEnd({ lyricCount: 46, lyricLastTime: 240.8 }, 246.5)).toBe(false);
    expect(shouldWarnForEarlySrtEnd({ lyricCount: 46, lyricLastTime: 104 }, 246.5)).toBe(true);
  });
});
