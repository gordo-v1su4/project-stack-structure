import { describe, expect, test } from "bun:test";

import { buildStageHeaderModel } from "@/components/studio/stageActions";
import { buildPipelineState, type PipelineStageInput } from "@/components/studio/studioPipeline";

function makeInput(overrides: Partial<PipelineStageInput> = {}): PipelineStageInput {
  return {
    activeTab: "review",
    hasAudioAnalysis: false,
    hasLyricTranscript: false,
    hasRequiredReferences: false,
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
    shaderPresetLabel: "Balanced",
    finalExportReady: false,
    ...overrides,
  };
}

const ingestDone = {
  hasAudioAnalysis: true,
  hasLyricTranscript: true,
  hasRequiredReferences: true,
  videoCount: 2,
  sceneCount: 10,
  captionReadyCount: 10,
  captionTotalCount: 10,
};

describe("buildStageHeaderModel", () => {
  test("empty project: Ingest has a disabled Continue that names what is missing", () => {
    const pipeline = buildPipelineState(makeInput());
    const model = buildStageHeaderModel({ stages: pipeline.stages, activeTab: "review", canPreview: false, previewDisabledReason: null, isBusy: false });
    expect(model).not.toBeNull();
    expect(model!.step).toBe(1);
    expect(model!.total).toBe(8);
    expect(model!.blocked).toBeNull();
    expect(model!.primary).toMatchObject({ kind: "continue", label: "Continue to Story", targetTab: "story" });
    expect(model!.primary!.disabledReason).toContain("Upload");
    expect(model!.secondary).toBeNull();
  });

  test("locked stage exposes the blocked reason and an Open <prerequisite> action", () => {
    const pipeline = buildPipelineState(makeInput({ activeTab: "shuffle" }));
    const model = buildStageHeaderModel({ stages: pipeline.stages, activeTab: "shuffle", canPreview: false, previewDisabledReason: null, isBusy: false });
    expect(model!.title).toBe("Match");
    expect(model!.blocked).toMatchObject({ prerequisiteKey: "split", prerequisiteLabel: "Split" });
    expect(model!.primary).toMatchObject({ kind: "open-prerequisite", label: "Open Split", targetTab: "split", disabledReason: null });
    expect(model!.secondary).toBeNull();
  });

  test("ready stage enables Continue and offers a preview when segments exist", () => {
    const pipeline = buildPipelineState(makeInput({
      ...ingestDone,
      activeTab: "join",
      storyTreatmentSelected: true,
      storyAnchorsResolved: true,
      storyPlanConfirmed: true,
      editSlotCount: 6,
      matchedSlotCount: 6,
      hasCommittedSplit: true,
      storySegmentCount: 6,
    }));
    const model = buildStageHeaderModel({ stages: pipeline.stages, activeTab: "join", canPreview: true, previewDisabledReason: null, isBusy: false });
    expect(model!.primary).toMatchObject({ kind: "continue", label: "Continue to Effects", targetTab: "ramp", disabledReason: null });
    expect(model!.secondary).toMatchObject({ kind: "preview", label: "Play whole-song rough cut", disabledReason: null });
  });

  for (const gapSlotCount of [2, 6]) {
    test(`Generate can continue to Join with ${gapSlotCount} gaps while reporting incomplete coverage`, () => {
      const pipeline = buildPipelineState(makeInput({
        ...ingestDone,
        activeTab: "generate",
        storyTreatmentSelected: true,
        storyAnchorsResolved: true,
        storyPlanConfirmed: true,
        editSlotCount: 6,
        matchedSlotCount: 6 - gapSlotCount,
        gapSlotCount,
        storySegmentCount: 6,
        hasCommittedSplit: true,
      }));
      const model = buildStageHeaderModel({ stages: pipeline.stages, activeTab: "generate", canPreview: true, previewDisabledReason: null, isBusy: true });
      expect(model!.primary).toMatchObject({ kind: "continue", label: "Continue to Join" });
      expect(model!.primary!.disabledReason).toBeNull();
      expect(model!.status).toBe(`${gapSlotCount} unfilled windows`);
      expect(model!.secondary!.disabledReason).toBe("Preview already running");
    });
  }

  test("all-gap Match can continue to Generate without claiming matched coverage", () => {
    const pipeline = buildPipelineState(makeInput({
      ...ingestDone,
      storyTreatmentSelected: true,
      storyAnchorsResolved: true,
      storyPlanConfirmed: true,
      editSlotCount: 6,
      gapSlotCount: 6,
      hasCommittedSplit: true,
      storySegmentCount: 6,
    }));
    const model = buildStageHeaderModel({ stages: pipeline.stages, activeTab: "shuffle", canPreview: true, previewDisabledReason: null, isBusy: false });
    expect(model!.primary).toMatchObject({ kind: "continue", targetTab: "generate", disabledReason: null });
    expect(model!.status).toBe("0/6 model-supported slots");
  });

  test("Generate cannot continue to Join before the story timeline exists", () => {
    const pipeline = buildPipelineState(makeInput({
      ...ingestDone,
      storyTreatmentSelected: true,
      storyAnchorsResolved: true,
      storyPlanConfirmed: true,
      editSlotCount: 6,
      matchedSlotCount: 6,
      hasCommittedSplit: true,
    }));
    const model = buildStageHeaderModel({ stages: pipeline.stages, activeTab: "generate", canPreview: false, previewDisabledReason: null, isBusy: false });
    expect(model!.primary!.disabledReason).toContain("Build the Story timeline");
  });

  test("Effects review can play the rough cut but cannot continue to final Export with holes", () => {
    const pipeline = buildPipelineState(makeInput({
      ...ingestDone,
      storyTreatmentSelected: true,
      storyAnchorsResolved: true,
      storyPlanConfirmed: true,
      editSlotCount: 6,
      matchedSlotCount: 4,
      gapSlotCount: 2,
      hasCommittedSplit: true,
      storySegmentCount: 6,
    }));
    const model = buildStageHeaderModel({ stages: pipeline.stages, activeTab: "ramp", canPreview: true, previewDisabledReason: null, isBusy: false });
    expect(model!.blocked).toBeNull();
    expect(model!.primary!.disabledReason).toContain("Fill 2 gaps before final export");
    expect(model!.secondary!.disabledReason).toBeNull();
  });

  test("last stage has no Continue action", () => {
    const pipeline = buildPipelineState(makeInput({
      ...ingestDone,
      activeTab: "compose",
      storyTreatmentSelected: true,
      storyAnchorsResolved: true,
      storyPlanConfirmed: true,
      editSlotCount: 6,
      matchedSlotCount: 6,
      hasCommittedSplit: true,
      storySegmentCount: 6,
    }));
    const model = buildStageHeaderModel({ stages: pipeline.stages, activeTab: "compose", canPreview: true, previewDisabledReason: null, isBusy: false });
    expect(model!.primary).toBeNull();
    expect(model!.secondary).toMatchObject({ kind: "preview", label: "Preview final edit" });
  });
});
