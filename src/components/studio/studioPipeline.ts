import type { Tab } from "./types";
import { isIngestReady } from "./ingestLanes";

export interface PipelineStageInput {
  activeTab: Tab;
  hasAudioAnalysis: boolean;
  hasLyricTranscript: boolean;
  hasRequiredReferences: boolean;
  videoCount: number;
  sceneCount: number;
  captionReadyCount: number;
  captionTotalCount: number;
  storyTreatmentSelected: boolean;
  storyAnchorsResolved: boolean;
  storyPlanConfirmed: boolean;
  editSlotCount: number;
  matchedSlotCount: number;
  gapSlotCount: number;
  weakMatchSlotCount: number;
  shortReviewSlotCount: number;
  storySegmentCount: number;
  hasCommittedSplit: boolean;
  shaderPresetLabel: string;
  finalExportReady: boolean;
}

export type { IngestLane, IngestLaneInput } from "./ingestLanes";
export { deriveIngestLanes, hasRequiredIngestReferences, isCaptionContextReady, isIngestReady } from "./ingestLanes";

export interface PipelineStage {
  key: Tab;
  label: string;
  step: number;
  status: string;
  ready: boolean;
  complete: boolean;
  available: boolean;
  blockedReason: string | null;
  prerequisiteKey: Tab | null;
  active: boolean;
  isNext: boolean;
}

export interface PipelineState {
  stages: PipelineStage[];
  nextStage: PipelineStage | null;
  nextHint: string | null;
}

/**
 * Single source of truth for the studio workflow: which stage each tab
 * represents, whether it is ready, what the user should do there next.
 * Drives the sidebar readiness dots, the stage strip, and the header hint.
 */
export function buildPipelineState(input: PipelineStageInput): PipelineState {
  const ingestReady = isIngestReady({
    hasAudioAnalysis: input.hasAudioAnalysis,
    hasLyricTranscript: input.hasLyricTranscript,
    referenceAssets: [],
    referencesReady: input.hasRequiredReferences,
    videoCount: input.videoCount,
    sceneCount: input.sceneCount,
    captionReadyCount: input.captionReadyCount,
    captionTotalCount: input.captionTotalCount,
  });
  const storyReady = ingestReady
    && input.storyTreatmentSelected
    && input.storyAnchorsResolved
    && input.storyPlanConfirmed
    && input.editSlotCount > 0;
  const splitReady = storyReady && input.hasCommittedSplit;
  const matchReady = splitReady && input.captionReadyCount > 0;
  const generateReady = matchReady && input.gapSlotCount === 0;
  // Rough-cut review includes empty song windows; coverage gates final export only.
  const joinReady = splitReady && input.storySegmentCount > 0;
  const effectsReady = joinReady;
  const exportReady = effectsReady && generateReady;
  const exportComplete = exportReady && input.finalExportReady;
  const gapLabel = `${input.gapSlotCount} gap${input.gapSlotCount === 1 ? "" : "s"}`;

  const stages: Omit<PipelineStage, "step" | "active" | "isNext">[] = [
    {
      key: "review",
      label: "Ingest",
      ready: ingestReady,
      complete: ingestReady,
      available: true,
      blockedReason: null,
      prerequisiteKey: null,
      status: describeIngest(input),
    },
    {
      key: "story",
      label: "Story",
      ready: storyReady,
      complete: storyReady,
      available: ingestReady,
      blockedReason: ingestReady
        ? null
        : "Finish Ingest: master song, vocal stem, Char 1 + environment refs, clips, scenes, and smart captions.",
      prerequisiteKey: ingestReady ? null : "review",
      status: storyReady
        ? `${input.editSlotCount} edit slots`
        : ingestReady
          ? !input.storyTreatmentSelected
            ? "Choose a treatment"
            : !input.storyAnchorsResolved
              ? "Resolve story anchors"
              : "Confirm story plan"
          : "Finish Ingest",
    },
    {
      key: "split",
      label: "Split",
      ready: splitReady,
      complete: splitReady,
      available: storyReady,
      blockedReason: storyReady ? null : "Choose a treatment and confirm the Story plan before reviewing the detected scenes.",
      prerequisiteKey: storyReady ? null : "story",
      status: splitReady
        ? "Split committed"
        : storyReady
          ? `${input.sceneCount} scenes ready`
          : "Needs confirmed story",
    },
    {
      key: "shuffle",
      label: "Match",
      ready: matchReady,
      complete: matchReady && input.matchedSlotCount === input.editSlotCount,
      available: splitReady,
      blockedReason: splitReady ? null : "Open Split once so cut windows are built before reviewing matches.",
      prerequisiteKey: splitReady ? null : "split",
      status: matchReady
        ? `${input.matchedSlotCount}/${input.editSlotCount} model-supported slots`
        : splitReady
          ? "Review match candidates"
          : "Needs Split cut windows",
    },
    {
      key: "generate",
      label: "Generate",
      ready: generateReady,
      complete: generateReady,
      available: matchReady,
      blockedReason: matchReady ? null : "Confirm Story and commit Split before planning missing or replacement shots.",
      prerequisiteKey: matchReady ? null : "split",
      status: !matchReady
        ? "Waiting for Split"
        : input.gapSlotCount > 0
          ? `${input.gapSlotCount} unfilled window${input.gapSlotCount === 1 ? "" : "s"}`
          : input.shortReviewSlotCount > 0
            ? `${input.shortReviewSlotCount} short source${input.shortReviewSlotCount === 1 ? "" : "s"} · optional`
            : input.weakMatchSlotCount > 0
              ? `${input.weakMatchSlotCount} weak section${input.weakMatchSlotCount === 1 ? "" : "s"} · optional`
              : "No gaps · optional",
    },
    {
      key: "join",
      label: "Join",
      ready: joinReady,
      complete: exportComplete,
      available: joinReady,
      blockedReason: joinReady ? null : !splitReady
        ? "Confirm Story and commit Split before reviewing the whole-song rough cut."
        : "Build the Story timeline before reviewing the whole-song rough cut.",
      prerequisiteKey: joinReady ? null : !splitReady ? "split" : "story",
      status: joinReady
        ? input.gapSlotCount > 0
          ? `Whole-song rough cut · ${gapLabel} to fill`
          : `${input.storySegmentCount} segments · rough cut`
        : "Waiting for story timeline",
    },
    {
      key: "ramp",
      label: "Effects",
      ready: effectsReady,
      complete: exportComplete,
      available: joinReady,
      blockedReason: joinReady ? null : "Build the Join timeline before applying transitions or effects.",
      prerequisiteKey: joinReady ? null : "join",
      status: exportComplete ? `${input.shaderPresetLabel} · applied` : `${input.shaderPresetLabel} · review`,
    },
    {
      key: "compose",
      label: "Export",
      ready: exportReady,
      complete: exportComplete,
      available: exportReady,
      blockedReason: exportReady ? null : input.gapSlotCount > 0
        ? `Fill ${gapLabel} before final export.${joinReady ? " The whole-song rough cut is available in Join." : ""}`
        : "Finish Join and review Effects before opening export controls.",
      prerequisiteKey: exportReady ? null : input.gapSlotCount > 0 ? "generate" : "ramp",
      status: exportComplete ? "MP4 ready" : input.gapSlotCount > 0
        ? `${gapLabel} · final export blocked`
        : exportReady ? "Preview ready · export pending" : "Waiting",
    },
  ];

  const firstNotReadyIndex = stages.findIndex((stage) => !stage.ready);
  const fullStages = stages.map((stage, index) => ({
    ...stage,
    step: index + 1,
    active: stage.key === input.activeTab,
    isNext: index === firstNotReadyIndex,
  }));

  const nextStage = firstNotReadyIndex >= 0 ? fullStages[firstNotReadyIndex]! : null;
  return {
    stages: fullStages,
    nextStage,
    nextHint: nextStage ? buildNextHint(nextStage) : "All stages ready · export from Export.",
  };
}

function describeIngest(input: PipelineStageInput) {
  const missing: string[] = [];
  if (!input.hasAudioAnalysis) missing.push("song");
  if (!input.hasLyricTranscript) missing.push("stem");
  if (!input.hasRequiredReferences) missing.push("refs");
  if (input.videoCount === 0) missing.push("clips");
  if (missing.length) return `Upload ${missing.join(" + ")}`;
  if (input.sceneCount === 0) return "Detecting scenes";
  if (input.captionTotalCount === 0 || input.captionReadyCount < input.captionTotalCount) {
    return `Captioning ${input.captionReadyCount}/${input.captionTotalCount || input.sceneCount}`;
  }
  const captionLabel = input.captionTotalCount > 0 ? ` · ${input.captionReadyCount}/${input.captionTotalCount} captions` : "";
  return `${input.videoCount} clip${input.videoCount === 1 ? "" : "s"}${captionLabel}`;
}

function buildNextHint(stage: PipelineStage) {
  switch (stage.key) {
    case "review":
      return `Next: ${stage.status} in Ingest.`;
    case "story":
      return "Next: choose a treatment, resolve its anchors, and confirm the Story plan.";
    case "split":
      return "Next: open Split and pick a cut strategy; it commits automatically.";
    case "shuffle":
      return "Next: review semantic matches for each section in Match.";
    case "generate":
      return "Review the whole-song rough cut in Join, or fill remaining coverage gaps in Generate.";
    case "join":
      return "Next: build the Story timeline for whole-song rough-cut review in Join.";
    case "ramp":
      return "Next: pick a shader preset in Effects.";
    case "compose":
      return "Next: export the final MP4 from Export.";
    default:
      return `Next: open ${stage.label}.`;
  }
}
