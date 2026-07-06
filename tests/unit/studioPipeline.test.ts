import { describe, expect, test } from "bun:test";

import { buildPipelineState, type PipelineStageInput } from "@/components/studio/studioPipeline";

function makeInput(overrides: Partial<PipelineStageInput> = {}): PipelineStageInput {
  return {
    activeTab: "review",
    hasAudioAnalysis: false,
    hasTranscript: false,
    videoCount: 0,
    sceneCount: 0,
    captionReadyCount: 0,
    captionTotalCount: 0,
    storyGenerated: false,
    editSlotCount: 0,
    matchedSlotCount: 0,
    gapSlotCount: 0,
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
    expect(state.stages[0]).toMatchObject({ key: "review", step: 1, ready: false, status: "Upload song + clips", isNext: true });
    expect(state.nextStage?.key).toBe("review");
    expect(state.nextHint).toContain("Upload song + clips");
  });

  test("ingest asks for lyrics when media is present but transcript is missing", () => {
    const state = buildPipelineState(makeInput({ hasAudioAnalysis: true, videoCount: 3 }));

    expect(state.stages[0]?.status).toBe("Add lyrics / transcript");
    expect(state.stages[0]?.ready).toBe(false);
  });

  test("story is the next stage once ingest is complete", () => {
    const state = buildPipelineState(
      makeInput({ hasAudioAnalysis: true, hasTranscript: true, videoCount: 2, sceneCount: 12, captionReadyCount: 12, captionTotalCount: 12 }),
    );

    expect(state.stages[0]?.ready).toBe(true);
    expect(state.stages[0]?.status).toBe("2 clips · 12/12 captions");
    expect(state.nextStage?.key).toBe("story");
    expect(state.stages.filter((stage) => stage.isNext)).toHaveLength(1);
  });

  test("match reports slot coverage and generate reports gaps", () => {
    const state = buildPipelineState(
      makeInput({
        hasAudioAnalysis: true,
        hasTranscript: true,
        videoCount: 2,
        sceneCount: 10,
        captionReadyCount: 10,
        captionTotalCount: 10,
        storyGenerated: true,
        editSlotCount: 9,
        matchedSlotCount: 7,
        gapSlotCount: 2,
      }),
    );

    const match = state.stages.find((stage) => stage.key === "shuffle");
    const generate = state.stages.find((stage) => stage.key === "generate");
    expect(match).toMatchObject({ ready: true, status: "7/9 slots matched" });
    expect(generate).toMatchObject({ ready: true, status: "2 gaps to fill" });
    expect(state.nextStage?.key).toBe("join");
  });

  test("fully ready project has no next stage and an export hint", () => {
    const state = buildPipelineState(
      makeInput({
        hasAudioAnalysis: true,
        hasTranscript: true,
        videoCount: 2,
        sceneCount: 10,
        captionReadyCount: 10,
        captionTotalCount: 10,
        storyGenerated: true,
        editSlotCount: 9,
        matchedSlotCount: 9,
        gapSlotCount: 0,
        storySegmentCount: 40,
        finalExportReady: true,
      }),
    );

    expect(state.stages.every((stage) => stage.ready)).toBe(true);
    expect(state.nextStage).toBeNull();
    expect(state.nextHint).toContain("export");
  });

  test("marks the active tab", () => {
    const state = buildPipelineState(makeInput({ activeTab: "shuffle" }));
    expect(state.stages.find((stage) => stage.key === "shuffle")?.active).toBe(true);
    expect(state.stages.filter((stage) => stage.active)).toHaveLength(1);
  });
});
