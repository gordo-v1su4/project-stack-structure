import { describe, expect, test } from "bun:test";

import { buildAutoShaderCues } from "@/components/studio/shaderEffectPlan";
import {
  buildEditPlanPreviewSegments,
  createMusicVideoProject,
  getDefaultStorySectionDrafts,
  validateMusicVideoProject,
} from "@/components/studio/musicVideoProject";
import type { BeatJoinAnalysis, UploadedVideoSource } from "@/components/studio/types";

function makeCleanUploadAnalysis(): BeatJoinAnalysis {
  return {
    sourceLabel: "Love me tonight (Remastered x2).wav",
    audioUrl: "blob:master-song",
    duration: 32,
    waveform: [0.1, 0.2, 0.7, 0.5, 0.9, 0.3, 0.6, 0.2],
    energy: [0.2, 0.35, 0.62, 0.88, 0.74, 0.45, 0.9, 0.3],
    beats: Array.from({ length: 33 }, (_, index) => index),
    onsets: Array.from({ length: 64 }, (_, index) => Number((index * 0.5 + 0.18).toFixed(2))).filter((value) => value < 32),
    sections: [
      { label: "Intro", start: 0, end: 4, energy: 0.22 },
      { label: "Verse 1", start: 4, end: 10, energy: 0.42 },
      { label: "Pre-Chorus", start: 10, end: 14, energy: 0.58 },
      { label: "Chorus", start: 14, end: 22, energy: 0.92 },
      { label: "Bridge", start: 22, end: 27, energy: 0.5 },
      { label: "Final Chorus / Outro", start: 27, end: 32, energy: 0.86 },
    ],
  };
}

function makeDeepgramVocalStemChunks() {
  return [
    { index: 1, start: 0.3, end: 3.4, text: "hold me close in the blue light" },
    { index: 2, start: 5.2, end: 8.9, text: "walking through the city with you tonight" },
    { index: 3, start: 14.2, end: 18.1, text: "love me tonight while the rain comes down" },
    { index: 4, start: 18.2, end: 21.7, text: "dance with me until the morning" },
    { index: 5, start: 27.2, end: 31.4, text: "one last kiss under flashing lights" },
  ];
}

function makeCaptionedUploadedVideos(): UploadedVideoSource[] {
  return [
    {
      id: 0,
      name: "hf-blue-singer.mp4",
      duration: 12,
      size: 10_000,
      thumbnailUrl: "thumb:singer",
      videoUrl: "blob:hf-blue-singer",
      sceneStatus: "ready",
      captionStatus: "ready",
      scenes: [
        {
          id: 0,
          sourceClipId: 0,
          label: "Blue singer close-up",
          start: 0,
          end: 4,
          duration: 4,
          thumbnailUrl: "thumb:singer:0",
          detector: "pyscenedetect-adaptive",
          confidence: 0.91,
          caption: "Close-up of a singer in blue neon light holding the microphone.",
          captionMeta: { subjects: ["singer"], action: "singing", lighting: "blue neon light" },
          captionSource: "lfm-server",
        },
        {
          id: 1,
          sourceClipId: 0,
          label: "Flashing lights",
          start: 4,
          end: 8,
          duration: 4,
          thumbnailUrl: "thumb:singer:1",
          detector: "pyscenedetect-adaptive",
          confidence: 0.88,
          caption: "A performer turns toward flashing stage lights.",
          captionMeta: { subjects: ["performer"], action: "turns", lighting: "flashing lights" },
          captionSource: "lfm-server",
        },
      ],
    },
    {
      id: 1,
      name: "hf-rain-dancers.mp4",
      duration: 10,
      size: 12_000,
      thumbnailUrl: "thumb:rain",
      videoUrl: "blob:hf-rain-dancers",
      sceneStatus: "ready",
      captionStatus: "ready",
      scenes: [
        {
          id: 0,
          sourceClipId: 1,
          label: "Rain dancers",
          start: 0,
          end: 5,
          duration: 5,
          thumbnailUrl: "thumb:rain:0",
          detector: "pyscenedetect-adaptive",
          confidence: 0.93,
          caption: "Dancers move together through rain on a night street.",
          captionMeta: { subjects: ["dancers"], action: "dance", setting: "night street", weather: "rain" },
          captionSource: "lfm-webgpu",
        },
        {
          id: 1,
          sourceClipId: 1,
          label: "Morning street",
          start: 5,
          end: 10,
          duration: 5,
          thumbnailUrl: "thumb:rain:1",
          detector: "pyscenedetect-adaptive",
          confidence: 0.87,
          caption: "A quiet street after rain near morning.",
          captionMeta: { setting: "street", timeOfDay: "morning", weather: "after rain" },
          captionSource: "lfm-webgpu",
        },
      ],
    },
    {
      id: 2,
      name: "hf-city-couple.mp4",
      duration: 9,
      size: 11_000,
      thumbnailUrl: "thumb:city",
      videoUrl: "blob:hf-city-couple",
      sceneStatus: "ready",
      captionStatus: "ready",
      scenes: [
        {
          id: 0,
          sourceClipId: 2,
          label: "City couple",
          start: 0,
          end: 4.5,
          duration: 4.5,
          thumbnailUrl: "thumb:city:0",
          detector: "pyscenedetect-adaptive",
          confidence: 0.9,
          caption: "A couple walks through the city at night holding hands.",
          captionMeta: { subjects: ["couple"], action: "walking", setting: "city at night" },
          captionSource: "lfm-server",
        },
        {
          id: 1,
          sourceClipId: 2,
          label: "Last kiss",
          start: 4.5,
          end: 9,
          duration: 4.5,
          thumbnailUrl: "thumb:city:1",
          detector: "pyscenedetect-adaptive",
          confidence: 0.89,
          caption: "A romantic last kiss under bright city lights.",
          captionMeta: { subjects: ["couple"], action: "kiss", lighting: "bright city lights" },
          captionSource: "lfm-server",
        },
      ],
    },
  ];
}

describe("clean music-video ingest contract", () => {
  test("turns master upload, vocal-stem SRT, and captioned hf videos into an export-ready shader timeline", () => {
    const analysis = makeCleanUploadAnalysis();
    const videoSources = makeCaptionedUploadedVideos();
    const project = createMusicVideoProject({
      analysis,
      duration: analysis.duration,
      lyricChunks: makeDeepgramVocalStemChunks(),
      storyDrafts: getDefaultStorySectionDrafts().slice(0, 6),
      videoSources,
      createdAt: "2026-06-18T00:00:00.000Z",
    });

    expect(validateMusicVideoProject(project).filter((finding) => finding.severity === "error")).toEqual([]);
    expect(project.song?.sourceLabel).toContain("Love me tonight");
    expect(project.lyricChunks).toHaveLength(5);
    expect(project.videoMoments).toHaveLength(6);
    expect(project.storySections).toHaveLength(6);
    expect(project.editPlan.timelineItems).toHaveLength(6);
    expect(project.storySections.every((section) => section.semanticMatch)).toBe(true);

    const chorus = project.storySections.find((section) => section.id === "chorus-1");
    expect(chorus?.semanticMatch?.momentId).toBe("scene-moment-1-0");
    expect(chorus?.semanticMatch?.score).toBeGreaterThan(0.4);
    expect(chorus?.semanticMatch?.reasons.length).toBeGreaterThan(0);

    const outro = project.storySections.find((section) => section.label === "Outro");
    expect(outro?.semanticMatch?.momentId).toBe("scene-moment-2-1");

    const previewSegments = buildEditPlanPreviewSegments({
      project,
      videoSources,
      editSettings: { cutDensity: 1, preferOnsets: true },
    });
    const coveredDuration = previewSegments.reduce((total, segment) => total + segment.musicEnd - segment.musicStart, 0);

    expect(previewSegments.length).toBeGreaterThan(project.editPlan.timelineItems.length);
    expect(coveredDuration).toBeCloseTo(analysis.duration, 5);
    expect(new Set(previewSegments.map((segment) => segment.videoUrl))).toEqual(new Set(videoSources.map((source) => source.videoUrl)));
    expect(previewSegments.some((segment) => segment.label.includes("Dancers move together through rain"))).toBe(true);
    expect(previewSegments.some((segment) => segment.label.includes("romantic last kiss"))).toBe(true);

    const effectCues = buildAutoShaderCues({
      segments: previewSegments,
      beats: analysis.beats,
      lyricChunks: project.lyricChunks,
      presetId: "high-energy-glitch",
    });

    expect(effectCues.length).toBeGreaterThan(previewSegments.length);
    expect(effectCues.some((cue) => cue.sync === "beat" && cue.shaderId)).toBe(true);
    expect(effectCues.some((cue) => cue.sync === "lyric" && cue.label?.toLowerCase().includes("love me tonight"))).toBe(true);
    expect(effectCues.every((cue) => cue.end > cue.start)).toBe(true);
  });
});
