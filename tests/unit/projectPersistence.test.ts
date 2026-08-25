import { describe, expect, test } from "bun:test";

import {
  STUDIO_AUTOSAVE_INTERVAL_MS,
  buildVideoMediaKey,
  createPersistableStudioProjectDraft,
  hydrateStudioProjectDraft,
  isEmptyStudioProjectDraft,
} from "@/components/studio/projectPersistence";
import type { MusicVideoProject } from "@/components/studio/musicVideoProject";
import type { ReferenceAsset } from "@/components/studio/referenceAssets";
import type { UploadedVideoSource } from "@/components/studio/types";

const source: UploadedVideoSource = {
  id: 0,
  name: "clip.mp4",
  duration: 4.2,
  size: 1234,
  thumbnailUrl: "data:image/jpeg;base64,thumb",
  videoUrl: "blob:runtime-only",
  storageProvider: "rustfs",
  storageBucket: "stack-structure",
  storagePath: "media-uploads/2026/06_18/clip.mp4",
  storageUrl: "https://s3.v1su4.dev/stack-structure/media-uploads/2026/06_18/clip.mp4",
  storageStatus: "uploaded",
  storageError: null,
};

const storyState = {
  vocalStemName: "vox.wav",
  transcriptSummary: null,
  storyBeats: [{ id: "intro", label: "Intro", prompt: "Open" }],
  activeBeatId: "intro",
  storyGenerated: true,
};

const referenceAsset: ReferenceAsset = {
  id: "character-1-ref",
  role: "character-1",
  kind: "character",
  displayName: "Milo",
  fileName: "milo.png",
  previewUrl: "blob:reference-preview",
  promptHint: "Preserve exact likeness.",
  storageProvider: "rustfs",
  storageBucket: "stack-structure",
  storagePath: "reference-assets/character-1/2026/06_20/milo.png",
  storageUrl: "https://s3.v1su4.dev/stack-structure/reference-assets/character-1/2026/06_20/milo.png",
  storageStatus: "uploaded",
  storageError: null,
  createdAt: "2026-06-20T00:00:00.000Z",
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
  test("uses a five-minute autosave cadence", () => {
    expect(STUDIO_AUTOSAVE_INTERVAL_MS).toBe(5 * 60 * 1_000);
  });

  test("does not treat the initial empty Studio state as a saved project", () => {
    const draft = createPersistableStudioProjectDraft({
      analysis: null,
      videoSources: [],
      storyState: {
        vocalStemName: "",
        transcriptSummary: null,
        storyBeats: [
          { id: "intro", label: "Intro", prompt: "Opening visual / establishing image" },
          { id: "verse-1", label: "Verse 1", prompt: "Main character, setting, or first visual idea" },
          { id: "pre-chorus-1", label: "Pre-Chorus", prompt: "Build tension before the first chorus; remove if the song has no pre-chorus" },
          { id: "chorus-1", label: "Chorus", prompt: "Main repeatable image, hook, or performance motif" },
          { id: "verse-2", label: "Verse 2", prompt: "Second verse development or new visual variation" },
          { id: "pre-chorus-2", label: "Pre-Chorus 2", prompt: "Second build before the chorus; remove if unused" },
          { id: "chorus-2", label: "Chorus 2", prompt: "Return to the main hook with a bigger or altered visual" },
          { id: "bridge", label: "Bridge", prompt: "Contrast section, breakdown, twist, or emotional turn" },
          { id: "outro", label: "Final Chorus / Outro", prompt: "Final chorus, outro, last image, or emotional landing" },
        ],
        activeBeatId: "intro",
        storyGenerated: false,
      },
      musicVideoProject: null,
      referenceAssets: [],
      generatedAssets: [],
      savedAt: "2026-07-12T00:00:00.000Z",
    });

    expect(isEmptyStudioProjectDraft(draft)).toBe(true);
    expect(isEmptyStudioProjectDraft({
      ...draft,
      storyState: { ...draft.storyState, vocalStemName: "vox.wav" },
    })).toBe(false);
  });

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
      referenceAssets: [referenceAsset],
      captionSettings: {
        mode: "smart",
        context: {
          lyricExcerpt: "love me tonight",
          projectIntent: "music video semantic matching",
        },
      },
      savedAt: "2026-06-18T00:00:00.000Z",
    });

    expect(JSON.stringify(draft)).not.toContain("blob:runtime-only");
    expect(JSON.stringify(draft)).not.toContain("blob:audio");
    expect(JSON.stringify(draft)).not.toContain("blob:project-audio");
    expect(JSON.stringify(draft)).not.toContain("data:image/jpeg");
    expect(draft.videoSources[0].thumbnailUrl).toBe("");
    expect(draft.videoSources[0].storageProvider).toBe("rustfs");
    expect(draft.videoSources[0].storageBucket).toBe("stack-structure");
    expect(draft.videoSources[0].storageUrl).toBe(source.storageUrl);
    expect(draft.musicVideoProject?.song?.audioUrl).toBe("");
    expect(draft.musicVideoProject?.videoMoments[0].thumbnailUrl).toBe("");
    expect(draft.videoSources[0].mediaKey).toBe(buildVideoMediaKey(source));
    expect(draft.referenceAssets?.[0].previewUrl).toBe(referenceAsset.storageUrl);
    expect(draft.referenceAssets?.[0].displayName).toBe("Milo");
    expect(draft.analysis?.mediaKey).toBe("audio:song.wav");
    expect(draft.captionSettings?.mode).toBe("smart");
    expect(draft.captionSettings?.context?.lyricExcerpt).toBe("love me tonight");
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
    expect(hydrated.captionSettings?.mode).toBe("smart");
  });

  test("preserves an explicitly saved fast caption mode", () => {
    const draft = createPersistableStudioProjectDraft({
      analysis: null,
      videoSources: [],
      storyState,
      musicVideoProject: null,
      captionSettings: { mode: "fast" },
      savedAt: "2026-06-18T00:00:00.000Z",
    });

    expect(hydrateStudioProjectDraft({ draft }).captionSettings?.mode).toBe("fast");
  });

  test("hydrates a persisted draft from durable RustFS URL when local media cache is absent", () => {
    const draft = createPersistableStudioProjectDraft({
      analysis: null,
      videoSources: [source],
      storyState,
      musicVideoProject: null,
      savedAt: "2026-06-18T00:00:00.000Z",
    });

    const hydrated = hydrateStudioProjectDraft({ draft });

    expect(hydrated.videoSources).toHaveLength(1);
    expect(hydrated.videoSources[0].videoUrl).toBe(source.storageUrl);
    expect(hydrated.videoSources[0].storageProvider).toBe("rustfs");
  });

  test("hydrates persisted reference assets from durable RustFS URLs", () => {
    const draft = createPersistableStudioProjectDraft({
      analysis: null,
      videoSources: [],
      storyState,
      musicVideoProject: null,
      referenceAssets: [{ ...referenceAsset, previewUrl: "" }],
      savedAt: "2026-06-20T00:00:00.000Z",
    });

    const hydrated = hydrateStudioProjectDraft({ draft });

    expect(hydrated.referenceAssets).toHaveLength(1);
    expect(hydrated.referenceAssets[0].previewUrl).toBe(referenceAsset.storageUrl);
    expect(hydrated.referenceAssets[0].storageStatus).toBe("uploaded");
  });


  test("persists workflow UI settings needed to resume the same screen", () => {
    const draft = createPersistableStudioProjectDraft({
      analysis: null,
      videoSources: [],
      storyState,
      musicVideoProject: null,
      workflowUiSettings: {
        activeTab: "generate",
        splitMode: "scene-onset",
        matchMode: "energy",
        matchOnsetDensity: 65,
        matchLyricCueBlend: 60,
        matchLyricMergeWindow: 3,
        colorGradient: "Ocean",
        shaderPresetId: "balanced-music-video",
        shaderAccentKinds: {
          beat: "glitch-cut",
          section: "film-halation",
          lyric: "duotone-pulse",
        },
        isPreviewExpanded: true,
      },
      savedAt: "2026-06-21T00:00:00.000Z",
    });

    const hydrated = hydrateStudioProjectDraft({ draft });

    expect(hydrated.workflowUiSettings).toEqual({
      activeTab: "generate",
      splitMode: "scene-onset",
      matchMode: "energy",
      matchOnsetDensity: 65,
      matchLyricCueBlend: 60,
      matchLyricMergeWindow: 3,
      colorGradient: "Ocean",
      shaderPresetId: "balanced-music-video",
      shaderAccentKinds: {
        beat: "glitch-cut",
        section: "film-halation",
        lyric: "duotone-pulse",
      },
      isPreviewExpanded: true,
    });
  });

  test("drops invalid persisted shader accent kinds", () => {
    const draft = createPersistableStudioProjectDraft({
      analysis: null,
      videoSources: [],
      storyState,
      musicVideoProject: null,
      workflowUiSettings: {
        shaderAccentKinds: {
          beat: "glitch-cut",
          section: "not-a-cue-kind",
        } as never,
      },
      savedAt: "2026-06-21T00:00:00.000Z",
    });

    expect(hydrateStudioProjectDraft({ draft }).workflowUiSettings?.shaderAccentKinds).toEqual({
      beat: "glitch-cut",
    });
  });

});
