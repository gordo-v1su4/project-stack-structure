import { describe, expect, test } from "bun:test";

import { createMusicVideoProject } from "@/components/studio/musicVideoProject";
import { selectStorySectionCandidate } from "@/components/studio/musicVideoProjectSelection";
import type { BeatJoinAnalysis, UploadedVideoSource } from "@/components/studio/types";

function analysis(): BeatJoinAnalysis {
  return {
    sourceLabel: "song.wav",
    audioUrl: "blob:song",
    waveform: [0.1, 0.4, 0.8],
    energy: [0.2, 0.7],
    beats: [0, 1, 2, 3, 4, 5, 6],
    onsets: [0.5, 2.5, 4.5],
    sections: [{ label: "Chorus", start: 0, end: 6, energy: 0.9 }],
    duration: 6,
  };
}

function videoSources(): UploadedVideoSource[] {
  return [{
    id: 0,
    name: "source.mp4",
    duration: 9,
    size: 10,
    videoUrl: "blob:source",
    thumbnailUrl: "thumb",
    scenes: [
      {
        id: 0,
        sourceClipId: 0,
        label: "Blue singer",
        start: 0,
        end: 3,
        duration: 3,
        detector: "pyscenedetect-adaptive",
        caption: "Close-up of a singer in blue light.",
        captionMeta: { subjects: ["singer"], lighting: "blue light" },
        captionSource: "lfm-webgpu",
      },
      {
        id: 1,
        sourceClipId: 0,
        label: "Rain dancers",
        start: 3,
        end: 6,
        duration: 3,
        detector: "pyscenedetect-adaptive",
        caption: "Dancers move through night rain in a city.",
        captionMeta: { subjects: ["dancers"], action: "dance", setting: "night city", weather: "rain" },
        captionSource: "lfm-webgpu",
      },
      {
        id: 2,
        sourceClipId: 0,
        label: "Street lights",
        start: 6,
        end: 9,
        duration: 3,
        detector: "pyscenedetect-adaptive",
        caption: "Street lights glow in an empty alley.",
        captionMeta: { setting: "empty alley", lighting: "street lights" },
        captionSource: "lfm-webgpu",
      },
    ],
  }];
}

describe("selectStorySectionCandidate", () => {
  test("updates the story section and timeline item when a ranked backup is selected", () => {
    const project = createMusicVideoProject({
      analysis: analysis(),
      duration: 6,
      storyDrafts: [{ id: "chorus", label: "Chorus", prompt: "rain dancers night city" }],
      lyricChunks: [{ index: 1, start: 0, end: 4, text: "dance in the night rain" }],
      videoSources: videoSources(),
      createdAt: "2026-07-04T00:00:00.000Z",
    });
    const section = project.storySections[0];
    const backupMatch = section.candidateMatches?.find((match) => match.momentId !== section.semanticMatch?.momentId);

    if (!backupMatch) throw new Error("Expected fixture to produce a selectable backup match.");
    const selected = selectStorySectionCandidate(project, { sectionId: section.id, momentId: backupMatch.momentId });

    expect(selected).not.toBe(project);
    expect(selected.storySections[0].semanticMatch).toEqual(backupMatch);
    expect(selected.storySections[0].videoMomentIds[0]).toBe(backupMatch.momentId);
    expect(selected.editPlan.timelineItems[0].videoMomentId).toBe(backupMatch.momentId);
    expect(selected.editPlan.timelineItems[0].semanticMatch).toEqual(backupMatch);
    expect(selected.storySections[0].candidateMatches?.[0]).toEqual(section.candidateMatches?.[0]);
  });

  test("returns the same project when the requested candidate is not ranked for that section", () => {
    const project = createMusicVideoProject({
      analysis: analysis(),
      duration: 6,
      storyDrafts: [{ id: "chorus", label: "Chorus", prompt: "rain dancers night city" }],
      lyricChunks: [{ index: 1, start: 0, end: 4, text: "dance in the night rain" }],
      videoSources: videoSources(),
      createdAt: "2026-07-04T00:00:00.000Z",
    });

    expect(selectStorySectionCandidate(project, { sectionId: "chorus", momentId: "missing" })).toBe(project);
  });
});
