import { analyzeEditPlanCoverage } from "./editPlanCoverage";
import { hasRequiredIngestReferences } from "./ingestLanes";
import type { MusicVideoProject } from "./musicVideoProject";
import type { ReferenceAsset } from "./referenceAssets";
import type { PipelineStageInput } from "./studioPipeline";
import type { Tab } from "./types";

export function buildStudioPipelineInput(params: {
  activeTab: Tab;
  hasAudioAnalysis: boolean;
  hasLyricTranscript: boolean;
  referenceAssets: ReferenceAsset[];
  videoCount: number;
  sceneCount: number;
  captionReadyCount: number;
  captionTotalCount: number;
  storyTreatmentSelected: boolean;
  storyAnchorsResolved: boolean;
  storyPlanConfirmed: boolean;
  musicVideoProject: MusicVideoProject | null;
  storySegmentCount: number;
  hasCommittedSplit: boolean;
  shaderPresetLabel: string;
  finalExportReady: boolean;
}): PipelineStageInput {
  const coverage = analyzeEditPlanCoverage(params.musicVideoProject, []);

  return {
    activeTab: params.activeTab,
    hasAudioAnalysis: params.hasAudioAnalysis,
    hasLyricTranscript: params.hasLyricTranscript,
    hasRequiredReferences: hasRequiredIngestReferences(params.referenceAssets),
    videoCount: params.videoCount,
    sceneCount: params.sceneCount,
    captionReadyCount: params.captionReadyCount,
    captionTotalCount: params.captionTotalCount,
    storyTreatmentSelected: params.storyTreatmentSelected,
    storyAnchorsResolved: params.storyAnchorsResolved,
    storyPlanConfirmed: params.storyPlanConfirmed,
    editSlotCount: coverage.editSlotCount,
    matchedSlotCount: coverage.matchedSlotCount,
    gapSlotCount: coverage.trueGapCount,
    weakMatchSlotCount: coverage.weakReviewCount,
    shortReviewSlotCount: coverage.shortReviewCount,
    storySegmentCount: params.storySegmentCount,
    hasCommittedSplit: params.hasCommittedSplit,
    shaderPresetLabel: params.shaderPresetLabel,
    finalExportReady: params.finalExportReady,
  };
}
