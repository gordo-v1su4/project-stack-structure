import { describe, expect, test } from "bun:test";

import {
  buildStorySections,
  createMusicVideoProject,
  getDefaultStorySectionDrafts,
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

  test("marks section timing missing instead of synthesizing section windows", () => {
    const sections = buildStorySections({ analysis: mockAnalysis({ sections: [] }), duration: 8, drafts });

    expect(sections.map((section) => [section.start, section.end, section.source])).toEqual([
      [0, 0, "missing-analysis"],
      [0, 0, "missing-analysis"],
    ]);
  });

  test("maps detected musical roles to matching story templates instead of array positions", () => {
    const sections = buildStorySections({
      analysis: mockAnalysis({
        duration: 128,
        sections: [
          { label: "intro", start: 0, end: 12 },
          { label: "verse", start: 12, end: 45 },
          { label: "chorus", start: 45, end: 77 },
          { label: "bridge", start: 77, end: 109 },
          { label: "outro", start: 109, end: 128 },
        ],
      }),
      duration: 128,
      drafts: getDefaultStorySectionDrafts(),
    });

    expect(sections.map((section) => [section.id, section.label, section.start, section.end])).toEqual([
      ["intro", "Intro", 0, 12],
      ["verse-1", "Verse", 12, 45],
      ["chorus-1", "Chorus", 45, 77],
      ["bridge", "Bridge", 77, 109],
      ["outro", "Outro", 109, 128],
    ]);
  });

  test("numbers repeated roles and gives ambiguous detected sections neutral part labels", () => {
    const sections = buildStorySections({
      analysis: mockAnalysis({
        duration: 20,
        sections: [
          { label: "verse", start: 0, end: 4 },
          { label: "chorus", start: 4, end: 8 },
          { label: "verse", start: 8, end: 12 },
          { label: "chorus", start: 12, end: 16 },
          { label: "section", start: 16, end: 20 },
        ],
      }),
      duration: 20,
      drafts: getDefaultStorySectionDrafts(),
    });

    expect(sections.map((section) => section.label)).toEqual(["Verse 1", "Chorus 1", "Verse 2", "Chorus 2", "Part A"]);
  });

  test("keeps every repeated detected role addressable after starter templates run out", () => {
    const sections = buildStorySections({
      analysis: mockAnalysis({
        duration: 28,
        sections: [
          { label: "verse", start: 0, end: 4 },
          { label: "verse", start: 4, end: 8 },
          { label: "verse", start: 8, end: 12 },
          { label: "verse", start: 12, end: 16 },
          { label: "chorus", start: 16, end: 20 },
          { label: "chorus", start: 20, end: 24 },
          { label: "chorus", start: 24, end: 28 },
        ],
      }),
      duration: 28,
      drafts: getDefaultStorySectionDrafts(),
    });

    expect(sections.map((section) => section.id)).toEqual([
      "verse-1",
      "verse-2",
      "verse-3",
      "verse-4",
      "chorus-1",
      "chorus-2",
      "chorus-3",
    ]);
    expect(new Set(sections.map((section) => section.id)).size).toBe(sections.length);
  });

  test("uses explicit edited timing as the canonical downstream story plan", () => {
    const sections = buildStorySections({
      analysis: mockAnalysis({ sections: [{ label: "verse", start: 0, end: 8 }] }),
      duration: 8,
      drafts: [
        { id: "verse-1", label: "Verse 1", start: 0, end: 4, timingSource: "manual" },
        { id: "chorus-1", label: "Chorus 1", start: 4, end: 8, timingSource: "manual" },
      ],
    });

    expect(sections.map((section) => [section.id, section.start, section.end, section.source])).toEqual([
      ["verse-1", 0, 4, "manual"],
      ["chorus-1", 4, 8, "manual"],
    ]);
  });

  test("does not drop untimed sections from a partially timed saved plan", () => {
    const sections = buildStorySections({
      analysis: mockAnalysis({
        sections: [
          { label: "verse", start: 0, end: 4 },
          { label: "chorus", start: 4, end: 8 },
        ],
      }),
      duration: 8,
      drafts: [
        { id: "verse-1", label: "Verse 1", start: 0, end: 4, timingSource: "manual" },
        { id: "chorus-1", label: "Chorus 1" },
      ],
    });

    expect(sections.map((section) => [section.id, section.start, section.end])).toEqual([
      ["verse-1", 0, 4],
      ["chorus-1", 4, 8],
    ]);
  });

  test("keeps extra planned cards when partial timing and detection counts differ", () => {
    const sections = buildStorySections({
      analysis: mockAnalysis({
        sections: [
          { label: "verse", start: 0, end: 4 },
          { label: "chorus", start: 4, end: 8 },
        ],
      }),
      duration: 8,
      drafts: [
        { id: "verse-1", label: "Verse 1", start: 0, end: 4, timingSource: "manual" },
        { id: "part-1", label: "Part A" },
        { id: "chorus-1", label: "Chorus 1" },
      ],
    });

    expect(sections.map((section) => section.id)).toEqual(["verse-1", "part-1", "chorus-1"]);
    expect(sections[0]?.start).toBe(0);
    expect(sections.at(-1)?.end).toBe(8);
    expect(sections.every((section, index) => index === 0 || section.start === sections[index - 1]?.end)).toBe(true);
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
    expect(project.editPlan.timelineItems.every((item) => item.semanticMatch?.momentId === "segment-moment-12")).toBe(true);
  });

  test("carries semantic clip-choice scores and reasons into story sections and edit-plan items", () => {
    const project = createMusicVideoProject({
      analysis: mockAnalysis(),
      duration: 6,
      storyDrafts: [
        { id: "intro", label: "Intro", prompt: "singer under blue neon light" },
        { id: "chorus", label: "Chorus", prompt: "dancers in rain" },
      ],
      lyricChunks: [
        { index: 1, start: 0, end: 1, text: "blue neon" },
        { index: 2, start: 3, end: 4, text: "rain keeps falling" },
      ],
      videoSources: [{
        id: 0,
        name: "captioned.mp4",
        duration: 8,
        size: 10,
        thumbnailUrl: "thumb",
        videoUrl: "blob:video",
        scenes: [
          {
            id: 0,
            sourceClipId: 0,
            label: "Scene 01",
            start: 0,
            end: 3,
            duration: 3,
            detector: "pyscenedetect-adaptive",
            caption: "Close-up of a singer under blue neon light.",
            captionMeta: { subjects: ["singer"], lighting: "blue neon light" },
            captionSource: "lfm-webgpu",
            visualAnalysis: {
              contentHash: "hash-scene-0",
              keyframeTimestamps: [0, 1.5, 3],
              color: {
                palette: [{ hex: "#2244ff", weight: 0.8 }],
                firstPalette: [{ hex: "#101030", weight: 1 }],
                lastPalette: [{ hex: "#2266ff", weight: 1 }],
              },
            },
            motionDescriptor: {
              id: "motion-0",
              targetKind: "segment",
              filePath: "captioned.mp4",
              segmentId: 0,
              start: 0,
              end: 3,
              dominantAngleDeg: 8,
              dominantMagnitude: 0.5,
              motionCoherence: 0.8,
              cameraMotionType: "pan",
              cameraMotionStrength: 0.6,
              residualMotionStrength: 0.2,
              motionEntropy: 0.2,
              acceleration: 0.1,
              confidence: { overall: 0.9, camera: 0.8, residual: 0.7 },
              provenance: { kind: "optical-flow", tool: "opencv-farneback", generatedAt: "2026-06-19T00:00:00.000Z" },
            },
            contentHash: "hash-scene-0",
            keyframeTimestamps: [0, 1.5, 3],
            splitKind: "micro-shot",
          },
          {
            id: 1,
            sourceClipId: 0,
            label: "Scene 02",
            start: 3,
            end: 8,
            duration: 5,
            detector: "pyscenedetect-adaptive",
            caption: "Wide shot of dancers moving through heavy rain.",
            captionMeta: { subjects: ["dancers"], weather: "rain" },
            captionSource: "lfm-server",
          },
        ],
      }],
      createdAt: "2026-06-18T00:00:00.000Z",
    });

    expect(project.storySections[0].semanticMatch?.momentId).toBe("scene-moment-0-0");
    expect(project.videoMoments[0].visualAnalysis?.color?.palette[0]?.hex).toBe("#2244ff");
    expect(project.videoMoments[0].motionDescriptor?.provenance.kind).toBe("optical-flow");
    expect(project.videoMoments[0].contentHash).toBe("hash-scene-0");
    expect(project.videoMoments[0].keyframeTimestamps).toEqual([0, 1.5, 3]);
    expect(project.videoMoments[0].splitKind).toBe("micro-shot");
    expect(project.storySections[0].semanticMatch?.reasons).toContain("caption/query match");
    expect(project.storySections[0].semanticMatch?.reasons).toContain("lyric/caption match");
    expect(project.storySections[1].semanticMatch?.momentId).toBe("scene-moment-0-1");
    expect(project.editPlan.timelineItems[0].semanticMatch).toEqual(project.storySections[0].semanticMatch);
    expect(project.editPlan.timelineItems[1].semanticMatch?.score).toBeGreaterThan(0.4);
  });

  test("keeps several ranked semantic source moments per section for varied auto-edit filling", () => {
    const project = createMusicVideoProject({
      analysis: mockAnalysis({
        sections: [
          { label: "Intro", start: 0, end: 2, energy: 0.3 },
          { label: "Chorus", start: 2, end: 10, energy: 0.9 },
        ],
        duration: 10,
      }),
      duration: 10,
      storyDrafts: [
        { id: "intro", label: "Intro", prompt: "blue singer close up" },
        { id: "chorus", label: "Chorus", prompt: "rain dancers night city" },
      ],
      lyricChunks: [
        { index: 1, start: 0, end: 1, text: "blue light" },
        { index: 2, start: 3, end: 5, text: "dance in the night rain" },
      ],
      videoSources: [{
        id: 0,
        name: "varied-scenes.mp4",
        duration: 6,
        size: 10,
        thumbnailUrl: "thumb",
        videoUrl: "blob:varied",
        scenes: [
          {
            id: 0,
            sourceClipId: 0,
            label: "Blue singer",
            start: 0,
            end: 2,
            duration: 2,
            detector: "pyscenedetect-adaptive",
            caption: "Close-up of a singer in blue light.",
            captionMeta: { subjects: ["singer"], lighting: "blue light" },
            captionSource: "lfm-webgpu",
          },
          {
            id: 1,
            sourceClipId: 0,
            label: "Rain dancers",
            start: 2,
            end: 4,
            duration: 2,
            detector: "pyscenedetect-adaptive",
            caption: "Dancers move through night rain in a city.",
            captionMeta: { subjects: ["dancers"], action: "dance", setting: "night city", weather: "rain" },
            captionSource: "lfm-webgpu",
          },
          {
            id: 2,
            sourceClipId: 0,
            label: "City motion",
            start: 4,
            end: 6,
            duration: 2,
            detector: "pyscenedetect-adaptive",
            caption: "Fast night city motion with wet streets.",
            captionMeta: { action: "motion", setting: "night city", weather: "rain" },
            captionSource: "lfm-webgpu",
          },
        ],
      }],
      createdAt: "2026-06-18T00:00:00.000Z",
    });

    const chorus = project.storySections.find((section) => section.id === "chorus");
    expect(chorus?.semanticMatch?.momentId).toBe("scene-moment-0-1");
    expect(chorus?.videoMomentIds.length).toBeGreaterThan(1);
    expect(chorus?.candidateMatches?.length).toBeGreaterThan(1);
    expect(chorus?.candidateMatches?.[0]).toEqual(chorus?.semanticMatch);
    expect(chorus?.candidateMatches?.[0]?.score ?? 0).toBeGreaterThanOrEqual(chorus?.candidateMatches?.[1]?.score ?? 1);
    expect(chorus?.candidateMatches?.[1]?.reasons.length).toBeGreaterThan(0);

    const segments = buildEditPlanPreviewSegments({
      project,
      videoSources: [{ id: 0, name: "varied-scenes.mp4", duration: 6, size: 10, thumbnailUrl: "thumb", videoUrl: "blob:varied" }],
    }).filter((segment) => segment.sectionId === "chorus");

    expect(segments.reduce((total, segment) => total + segment.musicEnd - segment.musicStart, 0)).toBe(8);
    expect(new Set(segments.map((segment) => segment.startTime)).size).toBeGreaterThan(1);
    expect(segments.slice(0, 3).map((segment) => segment.label)).toEqual([
      "Chorus · Dancers move through night rain in a city. · beat",
      "Chorus · Fast night city motion with wet streets. · beat",
      "Chorus · Close-up of a singer in blue light. · beat",
    ]);
  });

  test("prefers a moment that covers the music window over a higher-ranked short moment", () => {
    const videoSources: UploadedVideoSource[] = [{
      id: 0,
      name: "mixed.mp4",
      duration: 10,
      size: 10,
      thumbnailUrl: "thumb",
      videoUrl: "blob:mixed",
      scenes: [
        {
          id: 0,
          sourceClipId: 0,
          label: "Singer close-up",
          start: 0,
          end: 1,
          duration: 1,
          detector: "pyscenedetect-adaptive",
          caption: "Close-up of a singer face in blue light.",
          captionMeta: { action: "singing", shotType: "close-up" },
          captionSource: "lfm-webgpu",
        },
        {
          id: 1,
          sourceClipId: 0,
          label: "Wide landscape",
          start: 2,
          end: 6,
          duration: 4,
          detector: "pyscenedetect-adaptive",
          caption: "Wide empty landscape.",
          captionMeta: { setting: "landscape" },
          captionSource: "lfm-webgpu",
        },
      ],
    }];

    const project = createMusicVideoProject({
      analysis: mockAnalysis({
        beats: [],
        onsets: [],
        sections: [{ label: "Chorus", start: 0, end: 4, energy: 0.5 }],
        duration: 4,
      }),
      duration: 4,
      storyDrafts: [{ id: "chorus", label: "Chorus", prompt: "close up singer face blue light" }],
      videoSources,
      createdAt: "2026-06-18T00:00:00.000Z",
    });

    // Premise: the short close-up outranks the long landscape semantically.
    expect(project.storySections[0]?.videoMomentIds[0]).toBe("scene-moment-0-0");

    const segments = buildEditPlanPreviewSegments({ project, videoSources });

    // Without beat cues the whole section is one music window; slicing the
    // 1s close-up first would force an off-cue cut, so the 4s landscape
    // moment fills the window in a single musically aligned slice.
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ startTime: 2, endTime: 6, musicStart: 0, musicEnd: 4 });
  });

  test("alternates moments instead of repeating the clip that just played", () => {
    const videoSources: UploadedVideoSource[] = [{
      id: 0,
      name: "pair.mp4",
      duration: 10,
      size: 10,
      thumbnailUrl: "thumb",
      videoUrl: "blob:pair",
      scenes: [
        {
          id: 0,
          sourceClipId: 0,
          label: "Shot A",
          start: 0,
          end: 1.5,
          duration: 1.5,
          detector: "pyscenedetect-adaptive",
          caption: "Dancer spinning in neon light.",
          captionSource: "lfm-webgpu",
        },
        {
          id: 1,
          sourceClipId: 0,
          label: "Shot B",
          start: 4,
          end: 5.5,
          duration: 1.5,
          detector: "pyscenedetect-adaptive",
          caption: "Crowd moving in a dark club.",
          captionSource: "lfm-webgpu",
        },
      ],
    }];

    const project = createMusicVideoProject({
      analysis: mockAnalysis({
        beats: [],
        onsets: [],
        sections: [{ label: "Chorus", start: 0, end: 4, energy: 0.5 }],
        duration: 4,
      }),
      duration: 4,
      storyDrafts: [{ id: "chorus", label: "Chorus", prompt: "dance energy" }],
      videoSources,
      createdAt: "2026-06-18T00:00:00.000Z",
    });

    const segments = buildEditPlanPreviewSegments({ project, videoSources });
    const playedStarts = segments.map((segment) => segment.startTime);

    expect(segments.length).toBeGreaterThan(1);
    for (let index = 1; index < playedStarts.length; index += 1) {
      expect(playedStarts[index]).not.toBe(playedStarts[index - 1]);
    }
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
      "missing-song-analysis",
      "missing-analysis-sections",
      "missing-source-moments",
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
      { videoUrl: "blob:video", startTime: 3, endTime: 5, sectionId: "intro", musicStart: 0, musicEnd: 2, label: "Intro · Scene A · beat" },
      { videoUrl: "blob:video", startTime: 3, endTime: 5, sectionId: "chorus", musicStart: 2, musicEnd: 4, label: "Chorus · Scene A · beat" },
      { videoUrl: "blob:video", startTime: 3, endTime: 5, sectionId: "chorus", musicStart: 4, musicEnd: 6, label: "Chorus · Scene A · beat · loop 2" },
    ]);
  });

  test("uses detected beat cues to cut the story preview inside long source moments", () => {
    const project = createMusicVideoProject({
      analysis: mockAnalysis({
        duration: 6,
        beats: [0, 1, 2, 3, 4, 5],
        onsets: [1.2, 2.4, 3.6, 4.8],
        sections: [{ label: "Chorus", start: 0, end: 6, energy: 1 }],
      }),
      duration: 6,
      storyDrafts: [{ id: "chorus", label: "Chorus", prompt: "fast dance cuts" }],
      videoSources: [{ id: 0, name: "long.mp4", duration: 10, size: 10, thumbnailUrl: "thumb", videoUrl: "blob:long" }],
      segmentPreviews: [{
        clipId: 1,
        label: "Long performance shot",
        duration: 10,
        thumbnailUrl: "thumb",
        sourceClipIds: [0],
        sourceStart: 0,
        sourceEnd: 10,
      }],
      createdAt: "2026-06-18T00:00:00.000Z",
    });

    const segments = buildEditPlanPreviewSegments({
      project,
      videoSources: [{ id: 0, name: "long.mp4", duration: 10, size: 10, thumbnailUrl: "thumb", videoUrl: "blob:long" }],
      editSettings: { cutDensity: 1, preferOnsets: false },
    });

    expect(segments.map((segment) => [segment.musicStart, segment.musicEnd])).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 6],
    ]);
    expect(segments.every((segment) => segment.label.includes("beat"))).toBe(true);
  });

  test("edit density changes the number of cue-aligned story preview cuts", () => {
    const project = createMusicVideoProject({
      analysis: mockAnalysis({
        duration: 8,
        beats: [0, 1, 2, 3, 4, 5, 6, 7],
        onsets: [0.8, 1.6, 2.4, 3.2, 4, 4.8, 5.6, 6.4, 7.2],
        sections: [{ label: "Chorus", start: 0, end: 8, energy: 0.95 }],
      }),
      duration: 8,
      storyDrafts: [{ id: "chorus", label: "Chorus", prompt: "rapid hook montage" }],
      videoSources: [{ id: 0, name: "long.mp4", duration: 10, size: 10, thumbnailUrl: "thumb", videoUrl: "blob:long" }],
      segmentPreviews: [{
        clipId: 1,
        label: "Long performance shot",
        duration: 10,
        thumbnailUrl: "thumb",
        sourceClipIds: [0],
        sourceStart: 0,
        sourceEnd: 10,
      }],
      createdAt: "2026-06-18T00:00:00.000Z",
    });
    const videoSources = [{ id: 0, name: "long.mp4", duration: 10, size: 10, thumbnailUrl: "thumb", videoUrl: "blob:long" }];

    const sparse = buildEditPlanPreviewSegments({
      project,
      videoSources,
      editSettings: { cutDensity: 0.2, preferOnsets: true },
    });
    const dense = buildEditPlanPreviewSegments({
      project,
      videoSources,
      editSettings: { cutDensity: 1, preferOnsets: true },
    });

    expect(dense.length).toBeGreaterThan(sparse.length);
    expect(sparse.reduce((total, segment) => total + segment.musicEnd - segment.musicStart, 0)).toBeCloseTo(8, 5);
    expect(dense.reduce((total, segment) => total + segment.musicEnd - segment.musicStart, 0)).toBeCloseTo(8, 5);
  });

  test("reuses explicit short semantic moments so preview/export cover the full song timeline", () => {
    const project = createMusicVideoProject({
      analysis: mockAnalysis({
        sections: [
          { label: "Intro", start: 0, end: 3, energy: 0.3 },
          { label: "Chorus", start: 3, end: 8, energy: 0.8 },
        ],
        duration: 8,
      }),
      duration: 8,
      storyDrafts: drafts,
      videoSources: [
        {
          id: 0,
          name: "short-scenes.mp4",
          duration: 2,
          size: 10,
          thumbnailUrl: "thumb",
          videoUrl: "blob:short",
          scenes: [
            {
              id: 0,
              sourceClipId: 0,
              label: "Short scene",
              start: 0,
              end: 1,
              duration: 1,
              detector: "pyscenedetect-adaptive",
              caption: "A singer performs under stage lights.",
              captionSource: "lfm-webgpu",
            },
          ],
        },
      ],
      createdAt: "2026-06-18T00:00:00.000Z",
    });

    const segments = buildEditPlanPreviewSegments({
      project,
      videoSources: [{ id: 0, name: "short-scenes.mp4", duration: 2, size: 10, thumbnailUrl: "thumb", videoUrl: "blob:short" }],
    });

    expect(segments).toHaveLength(8);
    expect(segments[0]).toMatchObject({ sectionId: "intro", musicStart: 0, musicEnd: 1 });
    expect(segments.at(-1)).toMatchObject({ sectionId: "chorus", musicStart: 7, musicEnd: 8 });
    const coveredDuration = segments.reduce((total, segment) => total + segment.musicEnd - segment.musicStart, 0);
    expect(coveredDuration).toBe(8);
  });
});
