import type { Tab } from "./types";

export interface PipelineStageInput {
  activeTab: Tab;
  hasAudioAnalysis: boolean;
  hasTranscript: boolean;
  videoCount: number;
  sceneCount: number;
  captionReadyCount: number;
  captionTotalCount: number;
  storyGenerated: boolean;
  editSlotCount: number;
  matchedSlotCount: number;
  gapSlotCount: number;
  storySegmentCount: number;
  hasCommittedSplit: boolean;
  shaderPresetLabel: string;
  finalExportReady: boolean;
}

export interface PipelineStage {
  key: Tab;
  label: string;
  step: number;
  status: string;
  ready: boolean;
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
  const ingestReady = input.hasAudioAnalysis && input.videoCount > 0 && input.hasTranscript;
  const storyReady = input.storyGenerated && input.editSlotCount > 0;
  const splitReady = input.sceneCount > 0;
  const matchReady = storyReady && input.captionReadyCount > 0;
  const generateReady = storyReady;
  const joinReady = input.storySegmentCount > 0;
  const effectsReady = input.storySegmentCount > 0 || input.hasCommittedSplit;
  const exportReady = input.finalExportReady || input.storySegmentCount > 0;

  const stages: Omit<PipelineStage, "step" | "active" | "isNext">[] = [
    {
      key: "review",
      label: "Ingest",
      ready: ingestReady,
      status: describeIngest(input),
    },
    {
      key: "story",
      label: "Story",
      ready: storyReady,
      status: storyReady
        ? `${input.editSlotCount} edit slots`
        : input.hasAudioAnalysis
          ? "Generate sections"
          : "Needs master song",
    },
    {
      key: "split",
      label: "Split",
      ready: splitReady,
      status: splitReady
        ? `${input.sceneCount} cuts`
        : input.videoCount > 0
          ? "Detecting scenes"
          : "Needs clips",
    },
    {
      key: "shuffle",
      label: "Match",
      ready: matchReady,
      status: matchReady
        ? `${input.matchedSlotCount}/${input.editSlotCount} slots matched`
        : storyReady
          ? "Waiting on captions"
          : "Needs story",
    },
    {
      key: "generate",
      label: "Generate",
      ready: generateReady,
      status: !storyReady
        ? "Waiting for match"
        : input.gapSlotCount > 0
          ? `${input.gapSlotCount} gap${input.gapSlotCount === 1 ? "" : "s"} to fill`
          : "No gaps · optional",
    },
    {
      key: "join",
      label: "Join",
      ready: joinReady,
      status: joinReady ? `${input.storySegmentCount} cuts` : "Waiting for story preview",
    },
    {
      key: "ramp",
      label: "Effects",
      ready: effectsReady,
      status: input.shaderPresetLabel,
    },
    {
      key: "compose",
      label: "Export",
      ready: exportReady,
      status: input.finalExportReady ? "MP4 ready" : input.storySegmentCount > 0 ? "Preview ready" : "Waiting",
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
    nextHint: nextStage ? buildNextHint(nextStage, input) : "All stages ready · export from Preview / Export.",
  };
}

function describeIngest(input: PipelineStageInput) {
  const missing: string[] = [];
  if (!input.hasAudioAnalysis) missing.push("song");
  if (input.videoCount === 0) missing.push("clips");
  if (missing.length) return `Upload ${missing.join(" + ")}`;
  if (!input.hasTranscript) return "Add lyrics / transcript";
  const captionLabel = input.captionTotalCount > 0 ? ` · ${input.captionReadyCount}/${input.captionTotalCount} captions` : "";
  return `${input.videoCount} clip${input.videoCount === 1 ? "" : "s"}${captionLabel}`;
}

function buildNextHint(stage: PipelineStage, input: PipelineStageInput) {
  switch (stage.key) {
    case "review":
      return `Next: ${stage.status} in Ingest.`;
    case "story":
      return input.hasAudioAnalysis
        ? "Next: generate the Story layout to map sections to your footage."
        : "Next: upload and analyze the master song, then generate the Story layout.";
    case "split":
      return input.videoCount > 0
        ? "Next: waiting on scene detection · check Split for cut points."
        : "Next: upload clips so scene detection can find cut points.";
    case "shuffle":
      return "Next: review semantic matches for each section in Match.";
    case "generate":
      return "Next: fill remaining coverage gaps in Generate, or skip to Join.";
    case "join":
      return "Next: run the Story preview so Join has cuts to assemble.";
    case "ramp":
      return "Next: pick a shader preset in Effects.";
    case "compose":
      return "Next: export the final MP4 from Preview / Export.";
    default:
      return `Next: open ${stage.label}.`;
  }
}
