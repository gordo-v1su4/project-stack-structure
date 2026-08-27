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
    weakMatchSlotCount: 0,
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

  test("ingest remains active while uploaded clips are still waiting for scenes", () => {
    const state = buildPipelineState(makeInput({ hasAudioAnalysis: true, videoCount: 3 }));

    expect(state.stages[0]?.status).toBe("Detecting scenes");
    expect(state.stages[0]?.ready).toBe(false);
  });

  test("story is selectable but downstream work stays gated once ingest is complete", () => {
    const state = buildPipelineState(
      makeInput({ hasAudioAnalysis: true, videoCount: 2, sceneCount: 12, captionReadyCount: 12, captionTotalCount: 12 }),
    );

    expect(state.stages[0]?.ready).toBe(true);
    expect(state.stages[0]?.status).toBe("2 clips · 12/12 captions");
    expect(state.nextStage?.key).toBe("story");
    expect(state.stages.find((stage) => stage.key === "story")).toMatchObject({ available: true, ready: false });
    expect(state.stages.find((stage) => stage.key === "split")).toMatchObject({ available: false, prerequisiteKey: "story" });
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
        hasTranscript: true,
        videoCount: 2,
        sceneCount: 10,
        captionReadyCount: 10,
        captionTotalCount: 10,
        storyGenerated: true,
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
      status: "4 weak sections · optional",
    });
    expect(state.stages.find((stage) => stage.key === "join")?.available).toBe(true);
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
        hasCommittedSplit: true,
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
