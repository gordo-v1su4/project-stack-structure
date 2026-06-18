import { describe, expect, test } from "bun:test";

import {
  buildStorySections,
  createMusicVideoProject,
  normalizeLyricChunks,
  validateMusicVideoProject,
  buildEditPlanPreviewSegments,
  type MusicVideoProject,
} from "@/components/studio/musicVideoProject";
import type { BeatJoinAnalysis, SegmentPreview, UploadedVideoSource } from "@/components/studio/types";

function mockAnalysis(overrides: Partial<BeatJoinAnalysis> = {}): BeatJoinAnalysis {
  return {
    sourceLabel: "song.wav",
    audioUrl: "blob:song",
    waveform: [0.1, 0.4, 0.8],
    energy: [0.2, 0.7],
    beats: [0, 1, 2, 3, 4, 5],
    onsets: [0.5, 2.5, 4.5],
    sections: [
      { label: "Detected intro", start: 0, end: 2, energy: 0.2 },
      { label: "Detected chorus", start: 2, end: 6, energy: 0.9 },
    ],
    duration: 6,
    ...overrides,
  };
}

const drafts = [
  { id: "intro", label: "Intro", prompt: "open on the singer" },
  { id: "chorus", label: "Chorus", prompt: "big hook imagery" },
];

describe("musicVideoProject story sections", () => {
  test("uses detected BeatJoin section windows when they exist", () => {
    const sections = buildStorySections({ analysis: mockAnalysis(), duration: 6, drafts });

    expect(sections.map((section) => [section.id, section.start, section.end, section.source])).toEqual([
      ["intro", 0, 2, "analysis"],
      ["chorus", 2, 6, "analysis"],
    ]);
    expect(sections[0].prompt).toBe("open on the singer");
  });

  test("falls back to evenly timed section windows when analysis has no sections", () => {
    const sections = buildStorySections({ analysis: mockAnalysis({ sections: [] }), duration: 8, drafts });

    expect(sections.map((section) => [section.start, section.end, section.source])).toEqual([
      [0, 4, "fallback"],
      [4, 8, "fallback"],
    ]);
  });
});

describe("musicVideoProject lyrics", () => {
  test("normalizes SRT chunks with stable ids, text, and repaired minimum timing", () => {
    const chunks = normalizeLyricChunks([
      { index: 2, start: 3, end: 2, lyrics: "  hold   me " },
      { index: 1, start: 0, end: 1, text: "first line" },
    ]);

    expect(chunks.map((chunk) => chunk.id)).toEqual(["lyric-001-0.00", "lyric-002-3.00"]);
    expect(chunks.map((chunk) => chunk.text)).toEqual(["first line", "hold me"]);
    expect(chunks[1].end).toBeGreaterThan(chunks[1].start);
  });

  test("maps overlapping lyric chunks into story section ids", () => {
    const project = createMusicVideoProject({
      analysis: mockAnalysis(),
      duration: 6,
      storyDrafts: drafts,
      lyricChunks: [
        { index: 1, start: 0.5, end: 1.5, text: "verse words" },
        { index: 2, start: 3, end: 4, text: "hook words" },
      ],
      createdAt: "2026-06-18T00:00:00.000Z",
    });

    expect(project.storySections[0].lyricChunkIds).toEqual(["lyric-001-0.50"]);
    expect(project.storySections[1].lyricChunkIds).toEqual(["lyric-002-3.00"]);
    expect(project.editPlan.timelineItems.map((item) => item.lyricChunkIds.length)).toEqual([1, 1]);
  });
});

describe("musicVideoProject source moments and review contract", () => {
  test("prefers scene/segment previews and maps them into draft edit-plan slots", () => {
    const segmentPreviews: SegmentPreview[] = [
      {
        clipId: 12,
        label: "Close-up scene",
        duration: 1.5,
        thumbnailUrl: "blob:scene",
        sourceClipIds: [3],
        sourceRefLabel: "S4",
      },
    ];
    const videoSources: UploadedVideoSource[] = [
      { id: 3, name: "source.mov", duration: 9, size: 10, thumbnailUrl: "blob:source", videoUrl: "blob:video" },
    ];

    const project = createMusicVideoProject({
      analysis: mockAnalysis(),
      duration: 6,
      storyDrafts: drafts,
      videoSources,
      segmentPreviews,
      createdAt: "2026-06-18T00:00:00.000Z",
    });

    expect(project.videoMoments).toHaveLength(1);
    expect(project.videoMoments[0]).toMatchObject({ id: "segment-moment-12", sourceClipId: 3, label: "Close-up scene" });
    expect(project.storySections.every((section) => section.videoMomentIds.includes("segment-moment-12"))).toBe(true);
    expect(project.editPlan.timelineItems.every((item) => item.videoMomentId === "segment-moment-12")).toBe(true);
  });

  test("reports invalid projects instead of silently accepting empty edit plans", () => {
    const project: MusicVideoProject = {
      id: "bad",
      song: null,
      duration: 0,
      lyricChunks: [],
      storySections: [],
      videoMoments: [],
      editPlan: { id: "empty", createdAt: "2026-06-18T00:00:00.000Z", timelineItems: [] },
      reviewFindings: [],
    };

    expect(validateMusicVideoProject(project).map((finding) => finding.code)).toEqual([
      "missing-duration",
      "empty-edit-plan",
    ]);
  });
});

describe("musicVideoProject preview mapping", () => {
  test("turns edit-plan video moments into browser preview segments", () => {
    const project = createMusicVideoProject({
      analysis: mockAnalysis(),
      duration: 6,
      storyDrafts: drafts,
      lyricChunks: [{ index: 1, start: 0, end: 1, text: "open" }],
      videoSources: [{ id: 0, name: "source.mov", duration: 10, size: 10, thumbnailUrl: "thumb", videoUrl: "blob:video" }],
      segmentPreviews: [
        {
          clipId: 1,
          label: "Scene A",
          duration: 2,
          thumbnailUrl: "thumb",
          sourceClipIds: [0],
          sourceRefLabel: "S1",
          sourceStart: 3,
          sourceEnd: 5,
        },
      ],
      createdAt: "2026-06-18T00:00:00.000Z",
    });

    expect(buildEditPlanPreviewSegments({ project, videoSources: [{ id: 0, name: "source.mov", duration: 10, size: 10, thumbnailUrl: "thumb", videoUrl: "blob:video" }] })).toEqual([
      { videoUrl: "blob:video", startTime: 3, endTime: 5, label: "Intro · Scene A" },
      { videoUrl: "blob:video", startTime: 3, endTime: 5, label: "Chorus · Scene A" },
    ]);
  });
});
