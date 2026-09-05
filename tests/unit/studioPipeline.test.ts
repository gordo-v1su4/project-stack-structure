import { describe, expect, test } from "bun:test";

import { buildPipelineState, type PipelineStageInput } from "@/components/studio/studioPipeline";
import { buildStudioPipelineInput } from "@/components/studio/buildStudioPipelineInput";
import type { GeneratedStudioAsset } from "@/components/studio/generatedAssets";
import type { MusicVideoProject, TimelineItem } from "@/components/studio/musicVideoProject";
import type { ReferenceAsset } from "@/components/studio/referenceAssets";

const readyReferenceAssets: ReferenceAsset[] = [
  {
    id: "char-1",
    role: "character-1",
    kind: "character",
    displayName: "Char 1",
    fileName: "char1.png",
    previewUrl: "https://example.com/char1.png",
    promptHint: "",
    storageStatus: "uploaded",
    createdAt: "2026-09-05T00:00:00.000Z",
  },
  {
    id: "env-1",
    role: "environment",
    kind: "environment",
    displayName: "Environment",
    fileName: "env.png",
    previewUrl: "https://example.com/env.png",
    promptHint: "",
    storageStatus: "uploaded",
    createdAt: "2026-09-05T00:00:00.000Z",
  },
];

function makeInput(overrides: Partial<PipelineStageInput> = {}): PipelineStageInput {
  return {
    activeTab: "review",
    hasAudioAnalysis: false,
    hasLyricTranscript: false,
    hasRequiredReferences: true,
    videoCount: 0,
    sceneCount: 0,
    captionReadyCount: 0,
    captionTotalCount: 0,
    storyTreatmentSelected: false,
    storyAnchorsResolved: false,
    storyPlanConfirmed: false,
    editSlotCount: 0,
    matchedSlotCount: 0,
    gapSlotCount: 0,
    weakMatchSlotCount: 0,
    shortReviewSlotCount: 0,
    storySegmentCount: 0,
    hasCommittedSplit: false,
    shaderPresetLabel: "Beat Pulse",
    finalExportReady: false,
    ...overrides,
  };
}

describe("studio pipeline state", () => {
  test("empty project points the user at uploads, not fake loading states", () => {
    const state = buildPipelineState(makeInput());

    expect(state.stages).toHaveLength(8);
    expect(state.stages[0]).toMatchObject({ key: "review", step: 1, ready: false, status: "Upload song + stem + clips", isNext: true });
    expect(state.nextStage?.key).toBe("review");
    expect(state.nextHint).toContain("Upload song + stem + clips");
  });

  test("ingest remains active while uploaded clips are still waiting for scenes", () => {
    const state = buildPipelineState(makeInput({ hasAudioAnalysis: true, videoCount: 3 }));

    expect(state.stages[0]?.status).toBe("Upload stem");
    expect(state.stages[0]?.ready).toBe(false);
  });

  test("story is selectable but downstream work stays gated once ingest is complete", () => {
    const state = buildPipelineState(
      makeInput({
        hasAudioAnalysis: true,
        hasLyricTranscript: true,
        videoCount: 2,
        sceneCount: 12,
        captionReadyCount: 12,
        captionTotalCount: 12,
      }),
    );

    expect(state.stages[0]?.ready).toBe(true);
    expect(state.stages[0]?.status).toBe("2 clips · 12/12 captions");
    expect(state.nextStage?.key).toBe("story");
    expect(state.stages.find((stage) => stage.key === "story")).toMatchObject({ available: true, ready: false });
    expect(state.stages.find((stage) => stage.key === "split")).toMatchObject({ available: false, prerequisiteKey: "story" });
    expect(state.stages.filter((stage) => stage.isNext)).toHaveLength(1);
  });

  test("story stays locked until vocal stem lyrics are transcribed", () => {
    const state = buildPipelineState(
      makeInput({
        hasAudioAnalysis: true,
        hasLyricTranscript: false,
        videoCount: 2,
        sceneCount: 12,
        captionReadyCount: 12,
        captionTotalCount: 12,
      }),
    );

    expect(state.stages[0]?.ready).toBe(false);
    expect(state.stages[0]?.status).toBe("Upload stem");
    expect(state.stages.find((stage) => stage.key === "story")).toMatchObject({
      available: false,
      prerequisiteKey: "review",
    });
  });

  test("treatment selection alone does not unlock Split", () => {
    const state = buildPipelineState(makeInput({
      hasAudioAnalysis: true,
      hasLyricTranscript: true,
      videoCount: 2,
      sceneCount: 12,
      captionReadyCount: 12,
      captionTotalCount: 12,
      storyTreatmentSelected: true,
      storyAnchorsResolved: false,
      storyPlanConfirmed: false,
      editSlotCount: 9,
    }));

    expect(state.stages.find((stage) => stage.key === "story")?.status).toBe("Resolve story anchors");
    expect(state.stages.find((stage) => stage.key === "split")).toMatchObject({ available: false, prerequisiteKey: "story" });
  });

  test("match reports slot coverage and generate reports gaps", () => {
    const state = buildPipelineState(
      makeInput({
        hasAudioAnalysis: true,
        hasLyricTranscript: true,
        videoCount: 2,
        sceneCount: 10,
        captionReadyCount: 10,
        captionTotalCount: 10,
        storyTreatmentSelected: true,
        storyAnchorsResolved: true,
        storyPlanConfirmed: true,
        editSlotCount: 9,
        matchedSlotCount: 7,
        gapSlotCount: 2,
        hasCommittedSplit: true,
      }),
    );

    const match = state.stages.find((stage) => stage.key === "shuffle");
    const generate = state.stages.find((stage) => stage.key === "generate");
    expect(match).toMatchObject({ ready: true, status: "7/9 slots matched" });
    expect(generate).toMatchObject({ ready: false, status: "2 true gaps to fill" });
    expect(state.stages.find((stage) => stage.key === "join")).toMatchObject({ available: false, prerequisiteKey: "generate" });
    expect(state.nextStage?.key).toBe("generate");
  });

  test("weak assigned footage stays optional and does not masquerade as a true gap", () => {
    const state = buildPipelineState(
      makeInput({
        hasAudioAnalysis: true,
        hasLyricTranscript: true,
        videoCount: 2,
        sceneCount: 10,
        captionReadyCount: 10,
        captionTotalCount: 10,
        storyTreatmentSelected: true,
        storyAnchorsResolved: true,
        storyPlanConfirmed: true,
        editSlotCount: 9,
        matchedSlotCount: 9,
        gapSlotCount: 0,
        weakMatchSlotCount: 4,
        storySegmentCount: 40,
        hasCommittedSplit: true,
      }),
    );

    expect(state.stages.find((stage) => stage.key === "generate")).toMatchObject({
      ready: true,
      complete: true,
      status: "4 weak sections · optional",
    });
    expect(state.stages.find((stage) => stage.key === "join")).toMatchObject({
      available: true,
      ready: true,
      complete: false,
      status: "40 cuts · review",
    });
    expect(state.stages.find((stage) => stage.key === "ramp")).toMatchObject({ ready: true, complete: false, status: "Beat Pulse · review" });
    expect(state.stages.find((stage) => stage.key === "compose")).toMatchObject({ ready: true, complete: false, status: "Preview ready · export pending" });
  });

  test("fully ready project has no next stage and an export hint", () => {
    const state = buildPipelineState(
      makeInput({
        hasAudioAnalysis: true,
        hasLyricTranscript: true,
        videoCount: 2,
        sceneCount: 10,
        captionReadyCount: 10,
        captionTotalCount: 10,
        storyTreatmentSelected: true,
        storyAnchorsResolved: true,
        storyPlanConfirmed: true,
        editSlotCount: 9,
        matchedSlotCount: 9,
        gapSlotCount: 0,
        storySegmentCount: 40,
        hasCommittedSplit: true,
        finalExportReady: true,
      }),
    );

    expect(state.stages.every((stage) => stage.ready)).toBe(true);
    expect(state.stages.every((stage) => stage.complete)).toBe(true);
    expect(state.nextStage).toBeNull();
    expect(state.nextHint).toContain("export");
  });

  test("ingest stays locked until required reference sheets are uploaded", () => {
    const state = buildPipelineState(
      makeInput({
        hasAudioAnalysis: true,
        hasLyricTranscript: true,
        hasRequiredReferences: false,
        videoCount: 2,
        sceneCount: 12,
        captionReadyCount: 12,
        captionTotalCount: 12,
      }),
    );

    expect(state.stages[0]?.ready).toBe(false);
    expect(state.stages[0]?.status).toContain("refs");
    expect(state.stages.find((stage) => stage.key === "story")).toMatchObject({
      available: false,
      prerequisiteKey: "review",
    });
  });

  test("short source slots do not block Join when no true gaps remain", () => {
    const state = buildPipelineState(
      makeInput({
        hasAudioAnalysis: true,
        hasLyricTranscript: true,
        videoCount: 2,
        sceneCount: 10,
        captionReadyCount: 10,
        captionTotalCount: 10,
        storyTreatmentSelected: true,
        storyAnchorsResolved: true,
        storyPlanConfirmed: true,
        editSlotCount: 9,
        matchedSlotCount: 9,
        gapSlotCount: 0,
        shortReviewSlotCount: 3,
        weakMatchSlotCount: 0,
        storySegmentCount: 40,
        hasCommittedSplit: true,
      }),
    );

    expect(state.stages.find((stage) => stage.key === "generate")).toMatchObject({
      ready: true,
      status: "3 short sources · optional",
    });
    expect(state.stages.find((stage) => stage.key === "join")).toMatchObject({
      available: true,
      ready: true,
    });
  });

  test("approved generated replacements unblock Join when edit plan still has missing primaries", () => {
    const missingItem: TimelineItem = {
      id: "item-gap",
      sectionId: "intro",
      lyricChunkIds: [],
      videoMomentId: null,
      start: 0,
      end: 8,
      label: "Intro",
      prompt: "Opening",
    };
    const musicVideoProject: MusicVideoProject = {
      id: "project-1",
      song: null,
      duration: 8,
      lyricChunks: [],
      storySections: [],
      videoMoments: [],
      editPlan: { id: "edit-1", timelineItems: [missingItem], createdAt: "2026-09-05T00:00:00.000Z" },
      reviewFindings: [],
    };
    const approvedAsset: GeneratedStudioAsset = {
      id: "gen-approved",
      provider: "higgsfield",
      model: "Seedance 2.0",
      prompt: "Approved replacement",
      createdAt: "2026-09-05T00:00:00.000Z",
      status: "completed",
      mediaKind: "video",
      reviewStatus: "approved",
      target: {
        timelineItemId: missingItem.id,
        sectionId: missingItem.sectionId,
        sectionLabel: missingItem.label,
        songStart: missingItem.start,
        songEnd: missingItem.end,
      },
    };

    const blocked = buildPipelineState(buildStudioPipelineInput({
      activeTab: "generate",
      hasAudioAnalysis: true,
      hasLyricTranscript: true,
      referenceAssets: readyReferenceAssets,
      videoCount: 2,
      sceneCount: 10,
      captionReadyCount: 10,
      captionTotalCount: 10,
      storyTreatmentSelected: true,
      storyAnchorsResolved: true,
      storyPlanConfirmed: true,
      musicVideoProject,
      generatedAssets: [],
      storySegmentCount: 12,
      hasCommittedSplit: true,
      shaderPresetLabel: "Beat Pulse",
      finalExportReady: false,
    }));
    const unblocked = buildPipelineState(buildStudioPipelineInput({
      activeTab: "generate",
      hasAudioAnalysis: true,
      hasLyricTranscript: true,
      referenceAssets: readyReferenceAssets,
      videoCount: 2,
      sceneCount: 10,
      captionReadyCount: 10,
      captionTotalCount: 10,
      storyTreatmentSelected: true,
      storyAnchorsResolved: true,
      storyPlanConfirmed: true,
      musicVideoProject,
      generatedAssets: [approvedAsset],
      storySegmentCount: 12,
      hasCommittedSplit: true,
      shaderPresetLabel: "Beat Pulse",
      finalExportReady: false,
    }));

    expect(blocked.stages.find((stage) => stage.key === "generate")).toMatchObject({ ready: false });
    expect(unblocked.stages.find((stage) => stage.key === "generate")).toMatchObject({ ready: true });
    expect(unblocked.stages.find((stage) => stage.key === "join")).toMatchObject({ available: true, ready: true });
  });

  test("marks the active tab", () => {
    const state = buildPipelineState(makeInput({ activeTab: "shuffle" }));
    expect(state.stages.find((stage) => stage.key === "shuffle")?.active).toBe(true);
    expect(state.stages.filter((stage) => stage.active)).toHaveLength(1);
  });
});
