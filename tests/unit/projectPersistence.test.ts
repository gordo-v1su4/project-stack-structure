import { describe, expect, test } from "bun:test";

import {
  buildVideoMediaKey,
  createPersistableStudioProjectDraft,
  hydrateStudioProjectDraft,
} from "@/components/studio/projectPersistence";
import type { MusicVideoProject } from "@/components/studio/musicVideoProject";
import type { UploadedVideoSource } from "@/components/studio/types";

const source: UploadedVideoSource = {
  id: 0,
  name: "clip.mp4",
  duration: 4.2,
  size: 1234,
  thumbnailUrl: "data:image/jpeg;base64,thumb",
  videoUrl: "blob:runtime-only",
};

const storyState = {
  vocalStemName: "vox.wav",
  transcriptSummary: null,
  storyBeats: [{ id: "intro", label: "Intro", prompt: "Open" }],
  activeBeatId: "intro",
  storyGenerated: true,
};

const musicVideoProject: MusicVideoProject = {
  id: "project",
  song: {
    sourceLabel: "song.wav",
    audioUrl: "blob:project-audio",
    waveform: [],
    energy: [],
    beats: [],
    onsets: [],
    sections: [],
    duration: 2,
  },
  duration: 2,
  lyricChunks: [],
  storySections: [],
  videoMoments: [{
    id: "moment",
    sourceClipId: 0,
    label: "Moment",
    start: 0,
    end: 1,
    duration: 1,
    thumbnailUrl: "data:image/jpeg;base64,moment",
  }],
  editPlan: { id: "plan", timelineItems: [], createdAt: "2026-06-18T00:00:00.000Z" },
  reviewFindings: [],
};

describe("projectPersistence", () => {
  test("creates a persistable draft without runtime object URLs", () => {
    const draft = createPersistableStudioProjectDraft({
      analysis: {
        sourceLabel: "song.wav",
        audioUrl: "blob:audio",
        waveform: [0, 1],
        energy: [0.5],
        beats: [0, 1],
        onsets: [0.5],
        sections: [{ label: "Intro", start: 0, end: 2 }],
        duration: 2,
      },
      videoSources: [source],
      storyState,
      musicVideoProject,
      savedAt: "2026-06-18T00:00:00.000Z",
    });

    expect(JSON.stringify(draft)).not.toContain("blob:runtime-only");
    expect(JSON.stringify(draft)).not.toContain("blob:audio");
    expect(JSON.stringify(draft)).not.toContain("blob:project-audio");
    expect(JSON.stringify(draft)).not.toContain("data:image/jpeg");
    expect(draft.videoSources[0].thumbnailUrl).toBe("");
    expect(draft.musicVideoProject?.song?.audioUrl).toBe("");
    expect(draft.musicVideoProject?.videoMoments[0].thumbnailUrl).toBe("");
    expect(draft.videoSources[0].mediaKey).toBe(buildVideoMediaKey(source));
    expect(draft.analysis?.mediaKey).toBe("audio:song.wav");
  });

  test("hydrates a persisted draft with restored media URLs", () => {
    const draft = createPersistableStudioProjectDraft({
      analysis: null,
      videoSources: [source],
      storyState,
      musicVideoProject: null,
      savedAt: "2026-06-18T00:00:00.000Z",
    });

    const hydrated = hydrateStudioProjectDraft({
      draft,
      videoUrlsByMediaKey: { [draft.videoSources[0].mediaKey]: "blob:restored-video" },
    });

    expect(hydrated.videoSources).toHaveLength(1);
    expect(hydrated.videoSources[0].videoUrl).toBe("blob:restored-video");
    expect(hydrated.storyState.storyGenerated).toBe(true);
  });
});
