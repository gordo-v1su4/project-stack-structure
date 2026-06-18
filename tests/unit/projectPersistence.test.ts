import { describe, expect, test } from "bun:test";

import {
  buildVideoMediaKey,
  createPersistableStudioProjectDraft,
  hydrateStudioProjectDraft,
} from "@/components/studio/projectPersistence";
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
      musicVideoProject: null,
      savedAt: "2026-06-18T00:00:00.000Z",
    });

    expect(JSON.stringify(draft)).not.toContain("blob:runtime-only");
    expect(JSON.stringify(draft)).not.toContain("blob:audio");
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
