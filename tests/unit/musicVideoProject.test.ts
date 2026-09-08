import { reviewedEvidence, focalSubject } from "../helpers/storyEvidence";
import { describe, expect, test } from "bun:test";

import {
  buildStorySections,
  createMusicVideoProject,
  getDefaultStorySectionDrafts,
  normalizeLyricChunks,
  validateMusicVideoProject,
  buildEditPlanPreviewSegments,
  prepareApprovedPlacements,
  type StoryEditSettings,
  type MusicVideoProject,
} from "@/components/studio/musicVideoProject";
import type { BeatJoinAnalysis, SegmentPreview, UploadedVideoSource } from "@/components/studio/types";

function prepareAndReadPreview(params: { project: MusicVideoProject; videoSources: UploadedVideoSource[]; editSettings?: Partial<StoryEditSettings>; policy?: "faithful" | "best-effort" }) {
  const prepared = prepareApprovedPlacements(params);
  return buildEditPlanPreviewSegments({ ...params, project: prepared });
}

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
    expect(project.storySections.some((section) => section.videoMomentIds.includes("segment-moment-12"))).toBe(true);
    expect(project.editPlan.timelineItems.some((item) => item.semanticMatch?.assessment?.usableInEdit)).toBe(true);
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
            caption: "Wide shot of dancers moving through heavy rain.", mediaEvidence: reviewedEvidence({ actions: ["dancing"], location: "rain" }, 3, 8),
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
            caption: "Dancers move through night rain in a city.", mediaEvidence: reviewedEvidence({ actions: ["dancing"], location: "night city rain" }, 2, 4),
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
            caption: "Dancers move through wet night city streets.", mediaEvidence: reviewedEvidence({ actions: ["dancing"], location: "night city streets rain" }, 4, 6),
            captionMeta: { action: "dancing", setting: "night city", weather: "rain" },
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

    const segments = prepareAndReadPreview({
      project,
      videoSources: [{ id: 0, name: "varied-scenes.mp4", duration: 6, size: 10, thumbnailUrl: "thumb", videoUrl: "blob:varied" }],
    }).filter((segment) => segment.sectionId === "chorus");

    expect(segments.reduce((total, segment) => total + segment.musicEnd - segment.musicStart, 0)).toBe(8);
    expect(new Set(segments.map((segment) => segment.startTime)).size).toBeGreaterThan(1);
    expect(new Set(segments.map((segment) => segment.momentId)).size).toBeGreaterThan(1);
    expect(segments.filter((segment) => segment.kind === "source").every((segment) => segment.sourceClipId === 0 && segment.thumbnailUrl === "thumb")).toBe(true);
    expect(segments.some((segment) => segment.kind === "gap")).toBe(true);
    expect(segments.some((segment) => segment.momentId === "scene-moment-0-0")).toBe(false);
  });

  test("reserves fresh visual vocabulary for later song sections", () => {
    const sections = [
      { id: "verse-1", label: "Verse 1", prompt: "performance develops", start: 0, end: 12 },
      { id: "verse-2", label: "Verse 2", prompt: "performance develops", start: 12, end: 24 },
      { id: "chorus-1", label: "Chorus", prompt: "performance develops", start: 24, end: 36 },
    ];
    const videoSources: UploadedVideoSource[] = Array.from({ length: 24 }, (_, index) => ({
      id: index,
      name: `source-${index}.mp4`,
      duration: 4,
      size: 10,
      thumbnailUrl: `thumb:${index}`,
      videoUrl: `blob:${index}`,
      scenes: [{
        id: 0,
        sourceClipId: index,
        label: `Distinct scene ${index}`,
        start: 0,
        end: 4,
        duration: 4,
        detector: "pyscenedetect-adaptive",
        caption: `Distinct performance scene ${index}`,
        captionMeta: { action: index % 2 ? "performing" : "dancing", setting: `set ${index}` },
        captionSource: "lfm-webgpu",
      }],
    }));
    const project = createMusicVideoProject({
      analysis: mockAnalysis({
        duration: 36,
        sections: sections.map(({ label, start, end }) => ({ label, start, end, energy: 0.65 })),
        beats: Array.from({ length: 37 }, (_, index) => index),
        onsets: [],
      }),
      duration: 36,
      storyDrafts: sections,
      videoSources,
      createdAt: "2026-08-27T00:00:00.000Z",
    });
    const pools = project.storySections.map((section) => new Set(section.videoMomentIds));

    expect(pools.every((pool) => pool.size === 6)).toBe(true);
    expect([...pools[0]!].filter((momentId) => pools[1]!.has(momentId))).toHaveLength(0);
    expect([...pools[0]!].filter((momentId) => pools[2]!.has(momentId))).toHaveLength(0);
    expect([...pools[1]!].filter((momentId) => pools[2]!.has(momentId))).toHaveLength(0);
  });

  test("allows a readable landscape cut with lower story fit alongside a short singer close-up", () => {
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

    // Readable duration can outweigh literal caption similarity in a music video.
    expect(project.storySections[0]?.videoMomentIds[0]).toBe("scene-moment-0-1");

    const segments = prepareAndReadPreview({ project, videoSources });

    expect(segments.some((segment) => segment.kind === "source" && segment.momentId === "scene-moment-0-1")).toBe(true);
    expect(segments.some((segment) => segment.kind === "gap")).toBe(false);
    expect(segments.reduce((sum, segment) => sum + segment.musicEnd - segment.musicStart, 0)).toBe(4);
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
          caption: "Dancer spinning in neon light.", mediaEvidence: reviewedEvidence({ actions: ["dancing"], location: "neon club" }, 0, 1.5),
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
          caption: "Another dancer spinning in a dark club.", mediaEvidence: reviewedEvidence({ actions: ["dancing"], location: "dark club" }, 4, 5.5),
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

    const segments = prepareAndReadPreview({ project, videoSources });
    const playedStarts = segments.filter((segment) => segment.kind === "source").map((segment) => segment.startTime);

    expect(segments.length).toBeGreaterThan(1);
    for (let index = 1; index < playedStarts.length; index += 1) {
      expect(playedStarts[index]).not.toBe(playedStarts[index - 1]);
    }
  });

  test("keeps shot-use continuity across Story section boundaries", () => {
    const videoSources: UploadedVideoSource[] = [
      { id: 0, name: "a.mp4", duration: 4, size: 10, thumbnailUrl: "thumb:a", videoUrl: "blob:a" },
      { id: 1, name: "b.mp4", duration: 4, size: 10, thumbnailUrl: "thumb:b", videoUrl: "blob:b" },
    ];
    const project: MusicVideoProject = {
      id: "cross-section-continuity",
      song: mockAnalysis({
        duration: 4,
        beats: [],
        onsets: [],
        sections: [
          { label: "Verse 1", start: 0, end: 2 },
          { label: "Verse 2", start: 2, end: 4 },
        ],
      }),
      duration: 4,
      lyricChunks: [],
      storySections: [
        { id: "verse-1", label: "Verse 1", prompt: "dance", start: 0, end: 2, source: "analysis", lyricChunkIds: [], videoMomentIds: ["shot-a", "shot-b"] },
        { id: "verse-2", label: "Verse 2", prompt: "dance", start: 2, end: 4, source: "analysis", lyricChunkIds: [], videoMomentIds: ["shot-a", "shot-b"] },
      ],
      videoMoments: [
        { id: "shot-a", sourceClipId: 0, label: "Shot A", start: 0, end: 2, duration: 2, thumbnailUrl: "thumb:a", caption: "Dancing", mediaEvidence: reviewedEvidence({ actions: ["dancing"] }, 0, 2) },
        { id: "shot-b", sourceClipId: 1, label: "Shot B", start: 0, end: 2, duration: 2, thumbnailUrl: "thumb:b", caption: "Dancing", mediaEvidence: reviewedEvidence({ actions: ["dancing"] }, 0, 2) },
      ],
      editPlan: {
        id: "plan",
        createdAt: "2026-08-27T00:00:00.000Z",
        timelineItems: [
          { id: "timeline-verse-1", sectionId: "verse-1", lyricChunkIds: [], videoMomentId: "shot-a", start: 0, end: 2, label: "Verse 1", prompt: "dance" },
          { id: "timeline-verse-2", sectionId: "verse-2", lyricChunkIds: [], videoMomentId: "shot-a", start: 2, end: 4, label: "Verse 2", prompt: "dance" },
        ],
      },
      reviewFindings: [],
    };

    const segments = prepareAndReadPreview({ project, videoSources });

    expect(segments.map((segment) => segment.momentId)).toEqual(["shot-a", "shot-b"]);
    expect(segments.map((segment) => segment.sourceClipId)).toEqual([0, 1]);
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

function previewFixture(duration = 8): { project: MusicVideoProject; videoSources: UploadedVideoSource[] } {
  const project: MusicVideoProject = {
    id: "preview", song: mockAnalysis({ duration, beats: Array.from({ length: duration * 2 }, (_, i) => i * 0.5), onsets: [1.6, 3.9, 5.2, 7.8, 9.1, 12.4, 14, 16.2], sections: [{ label: "Chorus", start: 0, end: duration, energy: 0.9 }] }),
    duration, lyricChunks: [], reviewFindings: [],
    storySections: [{ id: "chorus", label: "Chorus", prompt: "Diego dancing alone", start: 0, end: duration, source: "manual", lyricChunkIds: [], videoMomentIds: ["dance"] }],
    videoMoments: [{ id: "dance", sourceClipId: 0, label: "Dancing", start: 3, end: 27, duration: 24, caption: "Diego dancing alone", mediaEvidence: reviewedEvidence({ subjects: [focalSubject("Diego")], focalSubjectCount: 1, actions: ["dancing"] }, 3, 27), thumbnailUrl: "thumb" }],
    editPlan: { id: "edit", createdAt: "2026-09-06", timelineItems: [{ id: "item", sectionId: "chorus", lyricChunkIds: [], videoMomentId: "dance", eligibleMomentIds: ["dance"], start: 0, end: duration, label: "Chorus", prompt: "Diego dancing alone" }] },
  };
  return { project, videoSources: [{ id: 0, name: "dance.mp4", duration: 30, size: 1, thumbnailUrl: "thumb", videoUrl: "blob:dance" }] };
}

describe("musicVideoProject saved preview contract", () => {
  test("a legacy project needs preparation; reading never invents a placement", () => {
    const input = previewFixture();
    const before = JSON.stringify(input.project);
    const segments = buildEditPlanPreviewSegments(input);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ kind: "gap", musicStart: 0, musicEnd: 8, videoUrl: "" });
    expect(JSON.stringify(input.project)).toBe(before);
  });

  test("preview reads exact source and song intervals from prepared placements", () => {
    const input = previewFixture();
    const project = prepareApprovedPlacements(input);
    const snapshot = JSON.stringify(project);
    const segments = buildEditPlanPreviewSegments({ ...input, project });
    expect(segments.map((segment) => [segment.startTime, segment.endTime, segment.musicStart, segment.musicEnd])).toEqual(
      project.placementPlan!.placements.map((placement) => [placement.sourceStart, placement.sourceEnd, placement.songStart, placement.songEnd]));
    expect(segments.every((segment) => segment.kind === "source" && segment.videoUrl === "blob:dance")).toBe(true);
    expect(JSON.stringify(project)).toBe(snapshot);
  });

  test("editing the story invalidates saved placements without reranking at playback", () => {
    const input = previewFixture();
    const project = prepareApprovedPlacements(input);
    project.editPlan.timelineItems[0]!.prompt = "Diego walking alone";
    expect(buildEditPlanPreviewSegments({ ...input, project }).every((segment) => segment.kind === "gap")).toBe(true);
  });

  test("new eligible-looking media does not silently refresh a saved candidate list", () => {
    const input = previewFixture();
    const project = prepareApprovedPlacements(input);
    project.videoMoments.push({ ...project.videoMoments[0]!, id: "new" });
    const segments = buildEditPlanPreviewSegments({ ...input, project });
    expect(segments.every((segment) => segment.kind === "gap")).toBe(true);
    expect(segments.some((segment) => segment.momentId === "new")).toBe(false);
  });

  test("preparation uses beat-aligned cuts inside a longer supported source", () => {
    const input = previewFixture(6);
    input.project.song!.beats = [0, 1, 2, 3, 4, 5];
    const segments = prepareAndReadPreview({ ...input, editSettings: { cutDensity: 1, preferOnsets: false } });
    expect(segments.map((segment) => [segment.musicStart, segment.musicEnd])).toEqual([[0, 2], [2, 4], [4, 6]]);
    expect(segments.every((segment) => segment.kind === "source")).toBe(true);
  });

  test("density is an explicit new placement decision and preserves song duration", () => {
    const input = previewFixture(18);
    const sparse = prepareAndReadPreview({ ...input, editSettings: { cutDensity: 0.2, preferOnsets: true } });
    const dense = prepareAndReadPreview({ ...input, editSettings: { cutDensity: 1, preferOnsets: true } });
    expect(dense.length).toBeGreaterThan(sparse.length);
    expect(new Set(dense.map((segment) => (segment.musicEnd - segment.musicStart).toFixed(2))).size).toBeGreaterThan(2);
    for (const segments of [sparse, dense]) expect(segments.reduce((total, segment) => total + segment.musicEnd - segment.musicStart, 0)).toBeCloseTo(18, 5);
  });

  test("faithful gaps preserve time and only explicit best-effort reuses eligible footage", () => {
    const input = previewFixture();
    input.project.videoMoments[0]!.end = 5;
    input.project.videoMoments[0]!.duration = 2;
    const faithful = prepareAndReadPreview(input);
    const bestEffort = prepareAndReadPreview({ ...input, policy: "best-effort" });
    expect(faithful.some((segment) => segment.kind === "gap")).toBe(true);
    expect(faithful.filter((segment) => segment.kind === "source").reduce((total, segment) => total + segment.endTime - segment.startTime, 0)).toBeLessThanOrEqual(2);
    expect(bestEffort.every((segment) => segment.kind === "source")).toBe(true);
    for (const segments of [faithful, bestEffort]) expect(segments.reduce((total, segment) => total + segment.musicEnd - segment.musicStart, 0)).toBe(8);
  });
  test("overlapping scene IDs cannot spend the same physical source seconds twice", () => {
    const input = previewFixture();
    input.project.videoMoments[0] = { ...input.project.videoMoments[0]!, start: 0, end: 3, duration: 3 };
    input.project.videoMoments.push({ ...input.project.videoMoments[0]!, id: "overlapping-dance", start: 1, end: 4 });
    input.project.editPlan.timelineItems[0]!.eligibleMomentIds = ["dance", "overlapping-dance"];
    const segments = prepareAndReadPreview(input).filter((segment) => segment.kind === "source");
    expect(segments.reduce((sum, segment) => sum + segment.endTime - segment.startTime, 0)).toBeLessThanOrEqual(4);
    for (let i = 0; i < segments.length; i++) for (let j = i + 1; j < segments.length; j++) {
      expect(Math.max(0, Math.min(segments[i]!.endTime, segments[j]!.endTime) - Math.max(segments[i]!.startTime, segments[j]!.startTime))).toBe(0);
    }
  });

  test("best-effort preserves the exact faithful plan for restoration", () => {
    const input = previewFixture();
    input.project.videoMoments[0]!.end = 5;
    input.project.videoMoments[0]!.duration = 2;
    const faithful = prepareApprovedPlacements(input);
    const bestEffort = prepareApprovedPlacements({ ...input, project: faithful, policy: "best-effort" });
    expect(bestEffort.faithfulPlacementPlan).toBe(faithful.placementPlan);
    const restored = prepareApprovedPlacements({ ...input, project: bestEffort, policy: "faithful" });
    expect(restored.placementPlan).toBe(faithful.placementPlan);
    expect(buildEditPlanPreviewSegments({ ...input, project: restored })).toEqual(buildEditPlanPreviewSegments({ ...input, project: faithful }));
  });

});
