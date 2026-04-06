import type { BeatJoinAnalysis, JoinClip, MotionDescriptor, UploadedVideoSource } from "../../src/components/studio/types";
import type { SourceClipSpan } from "../../src/components/studio/sourceTimeline";

export function makeVideoSources(): UploadedVideoSource[] {
  return [
    { id: 0, name: "clip-a.mp4", duration: 4, size: 1000, thumbnailUrl: "thumb-a", videoUrl: "blob:clip-a" },
    { id: 1, name: "clip-b.mp4", duration: 5, size: 1200, thumbnailUrl: "thumb-b", videoUrl: "blob:clip-b" },
    { id: 2, name: "clip-c.mp4", duration: 3, size: 900, thumbnailUrl: "thumb-c", videoUrl: "blob:clip-c" },
  ];
}

export function makeSourceClips(): SourceClipSpan[] {
  return [
    { id: 0, label: "clip-a", duration: 4, start: 0, end: 4 },
    { id: 1, label: "clip-b", duration: 5, start: 4, end: 9 },
    { id: 2, label: "clip-c", duration: 3, start: 9, end: 12 },
  ];
}

export function makeBeatJoinAnalysis(): BeatJoinAnalysis {
  return {
    sourceLabel: "song.wav",
    audioUrl: "blob:song",
    waveform: [0.1, 0.3, 0.6, 0.2, 0.7],
    energy: [0.2, 0.4, 0.8, 0.3, 0.9],
    beats: [0, 1, 2, 3, 4, 5, 6, 7],
    onsets: [0.3, 1.1, 2.4, 3.8, 5.2, 6.6],
    sections: [
      { label: "Intro", start: 0, end: 2 },
      { label: "Verse", start: 2, end: 6 },
      { label: "Chorus", start: 6, end: 8 },
    ],
    duration: 8,
  };
}

export function makeJoinClips(): JoinClip[] {
  return [
    { id: 0, on: true },
    { id: 1, on: false },
    { id: 2, on: true },
  ];
}


export function makeRankedCandidates() {
  return [
    { id: "music-a", musicalScore: 0.98, continuityScore: 0.62, fitPenalty: 0.02 },
    { id: "motion-a", musicalScore: 0.91, continuityScore: 0.97, fitPenalty: 0.01 },
    { id: "tie-a", musicalScore: 0.98, continuityScore: 0.62, fitPenalty: 0.1 },
  ];
}


export function makeMotionDescriptor(overrides: Partial<MotionDescriptor> = {}): MotionDescriptor {
  return {
    id: "motion:file-a",
    targetKind: "file",
    filePath: "/tmp/file-a.mp4",
    dominantAngleDeg: 45,
    dominantMagnitude: 0.7,
    motionCoherence: 0.8,
    cameraMotionType: "pan",
    cameraMotionStrength: 0.6,
    residualMotionStrength: 0.4,
    motionEntropy: 0.2,
    acceleration: 0.1,
    angleHistogram: [0.1, 0.9],
    magnitudeP50: 0.5,
    magnitudeP90: 0.8,
    confidence: { overall: 0.9, camera: 0.85, residual: 0.8 },
    provenance: { kind: "manual", tool: "test", version: null, generatedAt: new Date(0).toISOString(), notes: null },
    ...overrides,
  };
}
