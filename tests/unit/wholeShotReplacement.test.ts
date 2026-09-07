import { describe, expect, test } from "bun:test";
import { approvedFreshFramesForPlacement, countStoryboardFramesForSegment, getReplacementWorkflowState, isStandalone2kStoryboardFrame } from "@/components/studio/wholeShotReplacement";
import { acceptedFreshFrame } from "../helpers/storyboardFrame";
import type { GeneratedStudioAsset } from "@/components/studio/generatedAssets";
import type { EditPlanPreviewSegment } from "@/components/studio/musicVideoProject";

const segment: EditPlanPreviewSegment = { kind: "gap", videoUrl: "", startTime: 0, endTime: 5, musicStart: 20, musicEnd: 25, sectionId: "verse", planSignature: "plan-current", requirementId: "dance", label: "Dance" };


describe("manual 3x3 to standalone video handoff", () => {
  test("only a full standalone return can be offered visual approval", () => {
    const frame = acceptedFreshFrame();
    expect(isStandalone2kStoryboardFrame({ ...frame, reviewStatus: "pending" })).toBe(true);
    expect(isStandalone2kStoryboardFrame({ ...frame, width: 917, height: 512 })).toBe(false);
    expect(isStandalone2kStoryboardFrame({ ...frame, storyboard: { ...frame.storyboard!, kind: "grid" } })).toBe(false);
  });
  test("recognizes the actual return shape without a video target and unlocks after one approved fresh frame", () => {
    const count = countStoryboardFramesForSegment([acceptedFreshFrame()], segment, "project-1");
    expect(count).toBe(1);
    const state = getReplacementWorkflowState({ selectedSegment: segment, storyboardFrameCount: count, audioReferenceReady: false, packetErrorCount: 0, importedAssetCount: 0, approvedForJoin: false });
    expect(state.currentStep).toBe("prepare-video1");
    expect(state.canPrepareVideo1).toBe(true);
    expect(state.steps[1]?.label).toBe("Approved fresh 2K frame");
  });
  test("does not count raw grids, panel crops, pending or stale results as accepted conditioning", () => {
    const frame = acceptedFreshFrame();
    const invalid: GeneratedStudioAsset[] = [
      { ...frame, storyboard: { ...frame.storyboard!, kind: "grid" } },
      { ...frame, width: 917, height: 512 },
      { ...frame, reviewStatus: "pending" },
      { ...frame, reviewStatus: "rejected" },
      { ...frame, status: "queued" },
      { ...frame, storyboard: { ...frame.storyboard!, projectId: "other-project" } },
      { ...frame, storyboard: { ...frame.storyboard!, sectionId: "outro" } },
      { ...frame, storyboard: { ...frame.storyboard!, songStart: 26 } },
      { ...frame, storyboard: { ...frame.storyboard!, songEnd: 24 } },
      { ...frame, storyboard: { ...frame.storyboard!, sourceGridId: undefined } },
      { ...frame, storyboard: { ...frame.storyboard!, planSignature: "plan-before-story-edit" } },
      { ...frame, storyboard: { ...frame.storyboard!, planSignature: undefined } },
      { ...frame, storyboard: { ...frame.storyboard!, requirementId: "solo-arrival" } },
    ];
    expect(approvedFreshFramesForPlacement(invalid, { projectId: "project-1", sectionId: "verse", planSignature: "plan-current", requirementId: "dance", songStart: 20, songEnd: 25 })).toEqual([]);
    expect(countStoryboardFramesForSegment(invalid, segment, "project-1")).toBe(0);
    const state = getReplacementWorkflowState({ selectedSegment: segment, storyboardFrameCount: 0, audioReferenceReady: false, packetErrorCount: 0, importedAssetCount: 0, approvedForJoin: false });
    expect(state.canPrepareVideo1).toBe(false);
    expect(state.blockers.join(" ")).toContain("3×3 grid is composition exploration only");
  });
});
