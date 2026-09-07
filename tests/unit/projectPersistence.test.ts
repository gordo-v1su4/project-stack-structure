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
import type { StoryTreatment } from "@/components/studio/storyTreatments";
import { needsSceneDetectionRetry } from "@/components/studio/mediaUpload";

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

const confirmedTreatment = {
  id: "maze-faithful",
  kind: "faithful",
  title: "The One Across the Maze",
  logline: "Two strangers cross and lose one another inside a collapsing underground dance labyrinth.",
  synopsis: "Diego and Valentina move through separate rooms before a missed encounter turns into a search. They reunite in a central arena as the floor collapses.",
  visualThesis: "Dance carries the story through distinct rooms and escalating structural danger.",
  endingHook: "The final chamber reveals that only one dancer may leave.",
  expectedReusePercent: 75,
  expectedGenerationPercent: 25,
  anchors: Array.from({ length: 4 }, (_, index) => ({
    id: `anchor-${index}`,
    title: `Anchor ${index + 1}`,
    description: `Filmable story action ${index + 1} inside the underground dance maze.`,
    purpose: "Advance the search.",
    generationPrompt: "Cinematic underground dance room.",
    coverage: "missing" as const,
    candidates: [],
    selectedCandidateId: null,
    resolution: "generate" as const,
  })),
} satisfies StoryTreatment;

const storyState = {
  vocalStemName: "vox.wav",
  transcriptSummary: null,
  storyBeats: [{ id: "intro", label: "Intro", prompt: "Open" }],
  activeBeatId: "intro",
  storyGenerated: true,
  brief: { text: "Two strangers search an underground maze." },
  treatments: [confirmedTreatment],
  selectedTreatmentId: confirmedTreatment.id,
  confirmedTreatmentId: confirmedTreatment.id,
  confirmedTreatmentSnapshot: confirmedTreatment,
  generationMeta: { model: "gpt-5.4-mini", generatedAt: "2026-09-02T00:00:00.000Z" },
  storyContentSignature: "story-v2-test",
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
    expect(draft.version).toBe(3);
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
    expect(hydrated.storyState.confirmedTreatmentSnapshot?.title).toBe("The One Across the Maze");
    expect(hydrated.captionSettings?.mode).toBe("smart");
  });

  test("makes interrupted scene analysis retryable after reopening without losing completed sources", () => {
    const draft = createPersistableStudioProjectDraft({
      analysis: null,
      videoSources: [
        { ...source, sceneStatus: "detecting", scenes: [] },
        { ...source, id: 1, sceneStatus: "ready" },
      ],
      storyState,
      musicVideoProject: null,
    });
    const hydrated = hydrateStudioProjectDraft({ draft });

    expect(hydrated.videoSources[0].sceneStatus).toBe("idle");
    expect(needsSceneDetectionRetry(hydrated.videoSources[0])).toBe(true);
    expect(hydrated.videoSources[0].storagePath).toBe(source.storagePath);
    expect(hydrated.videoSources[1].sceneStatus).toBe("ready");
  });

  test("migrates version-1 story maps as unconfirmed while preserving their timing", () => {
    const draft = createPersistableStudioProjectDraft({
      analysis: null,
      videoSources: [],
      storyState,
      musicVideoProject: null,
      savedAt: "2026-09-02T00:00:00.000Z",
    });
    const hydrated = hydrateStudioProjectDraft({
      draft: { ...draft, version: 1 },
    });

    expect(hydrated.storyState.storyGenerated).toBe(false);
    expect(hydrated.storyState.storyBeats).toEqual(storyState.storyBeats);
    expect(hydrated.storyState.confirmedTreatmentId).toBeNull();
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

  test("persists vocal stem lyrics and timed SRT chunks in storyState", () => {
    const transcriptSummary = {
      provider: "deepgram" as const,
      model: "nova-3",
      duration: 246.4,
      confidence: 0.94,
      transcript: "Love me tonight",
      wordCount: 3,
      chunks: [{ index: 1, start: 12.4, end: 15.8, text: "Love me tonight" }],
      srt: "1\n00:00:12,400 --> 00:00:15,800\nLove me tonight\n",
      summary: "A romantic plea.",
      topics: [],
      intents: [],
      sentiments: null,
      averageSentiment: null,
      entities: [],
      warnings: [],
    };

    const draft = createPersistableStudioProjectDraft({
      analysis: null,
      videoSources: [],
      storyState: {
        ...storyState,
        vocalStemName: "Love me tonight - stem-only-Lead Vocal.wav",
        transcriptSummary,
      },
      musicVideoProject: null,
      savedAt: "2026-09-05T00:00:00.000Z",
    });

    const hydrated = hydrateStudioProjectDraft({ draft });

    expect(hydrated.storyState.vocalStemName).toBe("Love me tonight - stem-only-Lead Vocal.wav");
    expect(hydrated.storyState.transcriptSummary?.chunks).toHaveLength(1);
    expect(hydrated.storyState.transcriptSummary?.transcript).toBe("Love me tonight");
  });

  test("hydrates chunked RustFS video uploads when storageUrl was omitted", () => {
    const chunkedSource = {
      ...source,
      storageUrl: "",
      storagePath: "media-uploads/video-source/assembled/clip.mp4",
      uploadChunks: { size: source.size, chunks: [{ bucket: "stack-structure", objectKey: "media-uploads/video-source/chunk-0" }] },
    };
    const draft = createPersistableStudioProjectDraft({
      analysis: null,
      videoSources: [chunkedSource],
      storyState,
      musicVideoProject: null,
      savedAt: "2026-09-05T00:00:00.000Z",
    });

    const hydrated = hydrateStudioProjectDraft({ draft });

    expect(hydrated.videoSources).toHaveLength(1);
    expect(hydrated.videoSources[0].videoUrl).toBe(
      "/api/storage/media?bucket=stack-structure&objectKey=media-uploads%2Fvideo-source%2Fassembled%2Fclip.mp4",
    );
    expect(hydrated.videoSources[0].storagePath).toBe("media-uploads/video-source/assembled/clip.mp4");
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
        committedSplit: {
          kind: "workflow",
          segments: [{
            id: 0,
            start: 0,
            end: 2.5,
            duration: 2.5,
            sourceClipIds: [7],
            mergedTail: false,
            sceneId: 12,
            sceneLabel: "Scene 12",
            thumbnailUrl: "blob:runtime-thumbnail",
            clipUrl: "https://s3.example.test/scene-12.mp4",
            detector: "pyscenedetect-adaptive",
          }],
          signature: "workflow-signature",
          committedAt: "2026-06-21T00:01:00.000Z",
        },
        finalExport: {
          videoUrl: "https://media.example.test/files/final.mp4",
          downloadFileName: "final.mp4",
          cueCount: 42,
          status: "Final MP4 ready · 246.4s · 42 synced shader cues.",
        },
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
      committedSplit: {
        kind: "workflow",
        segments: [{
          id: 0,
          start: 0,
          end: 2.5,
          duration: 2.5,
          sourceClipIds: [7],
          mergedTail: false,
          sceneId: 12,
          sceneLabel: "Scene 12",
          clipUrl: "https://s3.example.test/scene-12.mp4",
          detector: "pyscenedetect-adaptive",
        }],
        signature: "workflow-signature",
        committedAt: "2026-06-21T00:01:00.000Z",
      },
      finalExport: {
        videoUrl: "https://media.example.test/files/final.mp4",
        downloadFileName: "final.mp4",
        cueCount: 42,
        status: "Final MP4 ready · 246.4s · 42 synced shader cues.",
      },
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

  test("normalizes legacy beatsplit and beatjoin tabs on hydrate", () => {
    for (const [legacy, normalized] of [["beatsplit", "split"], ["beatjoin", "join"]] as const) {
      const draft = createPersistableStudioProjectDraft({
        analysis: null,
        videoSources: [],
        storyState,
        musicVideoProject: null,
        workflowUiSettings: { activeTab: legacy as never },
        savedAt: "2026-06-21T00:00:00.000Z",
      });

      expect(hydrateStudioProjectDraft({ draft }).workflowUiSettings?.activeTab).toBe(normalized);
    }
  });

});

describe("story reconstruction persistence v3", () => {
  test("migrates a v2 confirmed edit as readable legacy without changing its decisions or timeline", () => {
    const draft = createPersistableStudioProjectDraft({ analysis: null, videoSources: [source], storyState, musicVideoProject });
    const legacyDraft = { ...draft, version: 2 as const, storyState: { ...draft.storyState, treatments: [] } };
    const before = JSON.stringify(legacyDraft.musicVideoProject);
    const restored = hydrateStudioProjectDraft({ draft: legacyDraft });
    expect(restored.storyState.storyGenerated).toBe(false);
    expect(restored.storyState.confirmedTreatmentSnapshot).toBeNull();
    expect(restored.storyState.storyContentSignature).toBeNull();
    expect(restored.storyState.treatments?.[0].id).toBe(confirmedTreatment.id);
    expect(restored.storyState.treatments?.[0].synopsis).toBe(confirmedTreatment.synopsis);
    expect(restored.storyState.treatments?.[0].anchors).toEqual(confirmedTreatment.anchors);
    expect(restored.storyState.treatments?.[0].reconciliation?.status).toBe("legacy");
    expect(JSON.stringify(restored.musicVideoProject)).toBe(before);
  });

  test("retains seven moments, requirements, precise placements, and faithful gaps after reload", () => {
    const treatment: StoryTreatment = { ...confirmedTreatment, revision: 4, reconciliation: { status: "current" }, anchors: Array.from({ length: 7 }, (_, index) => ({ ...confirmedTreatment.anchors[index % 4], id: `moment-${index}`, requirements: [{ id: `requirement-${index}`, momentId: `moment-${index}`, description: "Establish jungle geography.", constraints: { setting: "jungle" }, resolution: index === 0 ? null : "generate", selectedCandidateId: null }], songWindow: { start: index * 10, end: (index + 1) * 10 } })) };
    const exactProject: MusicVideoProject = { ...musicVideoProject, placementPlan: { version: 1, inputSignature: "exact-approved-input", settings: { cutDensity: 0.65, preferOnsets: true }, revision: 8, policy: "faithful", placements: [
      { id: "opening-hole", sectionId: "intro", timelineItemId: "item-intro", momentId: null, sourceStart: 0, sourceEnd: 0, songStart: 0, songEnd: 10, label: "Missing jungle opening", kind: "gap", reason: "No jungle exterior", origin: "story-match" },
      { id: "selected-source", sectionId: "verse", timelineItemId: "item-verse", momentId: "moment", sourceStart: 0.25, sourceEnd: 0.75, songStart: 10, songEnd: 10.5, label: "User-selected source", kind: "source", origin: "manual-match" },
    ] } };
    const state = { ...storyState, treatments: [treatment], confirmedTreatmentSnapshot: treatment, confirmedSourceContextSignature: "approved-input-revision" };
    const draft = createPersistableStudioProjectDraft({ analysis: null, videoSources: [], storyState: state, musicVideoProject: exactProject });
    const restored = hydrateStudioProjectDraft({ draft: JSON.parse(JSON.stringify(draft)) });
    expect(restored.storyState.storyGenerated).toBe(true);
    expect(restored.storyState.confirmedTreatmentSnapshot?.anchors).toHaveLength(7);
    expect(restored.storyState.confirmedSourceContextSignature).toBe("approved-input-revision");
    expect(restored.storyState.confirmedTreatmentSnapshot?.anchors[6].requirements?.[0].id).toBe("requirement-6");
    expect(restored.storyState.confirmedTreatmentSnapshot?.anchors[0].requirements?.[0].resolution).toBeNull();
    expect(restored.storyState.confirmedTreatmentSnapshot?.anchors[6].requirements?.[0].resolution).toBe("generate");
    expect(restored.musicVideoProject?.placementPlan).toEqual(exactProject.placementPlan);
    expect(restored.musicVideoProject?.placementPlan?.placements[0].kind).toBe("gap");
  });

  test("pending prose reconciliation cannot regain confirmation through save and reload", () => {
    const pending: StoryTreatment = { ...confirmedTreatment, reconciliation: { status: "pending" }, synopsis: "A changed beginning awaiting moment reconciliation." };
    const draft = createPersistableStudioProjectDraft({ analysis: null, videoSources: [], storyState: { ...storyState, treatments: [pending], confirmedTreatmentSnapshot: pending }, musicVideoProject });
    const restored = hydrateStudioProjectDraft({ draft });
    expect(restored.storyState.storyGenerated).toBe(false);
    expect(restored.storyState.confirmedTreatmentId).toBeNull();
    expect(restored.storyState.treatments?.[0].synopsis).toBe(pending.synopsis);
  });
});


test("section analysis provenance survives persistence with manual story timing", () => {
  const analysis = { ...musicVideoProject.song!, sections: [{ start: 0, end: 2, label: "Section 1", provenance: { status: "estimated" as const, method: "service-fallback", reason: "Review these boundaries." } }] };
  const draft = createPersistableStudioProjectDraft({ analysis, videoSources: [], storyState: { ...storyState, storyBeats: [{ id: "opening", label: "Opening", prompt: "Exterior", start: 0, end: 2, timingSource: "manual" }] }, musicVideoProject });
  const restored = hydrateStudioProjectDraft({ draft });
  expect(restored.analysis?.sections).toEqual(analysis.sections);
  expect(restored.storyState.storyBeats[0].timingSource).toBe("manual");
});
