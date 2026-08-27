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
  weakMatchSlotCount: number;
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
  const captionsReady = input.captionTotalCount > 0 && input.captionReadyCount === input.captionTotalCount;
  const ingestReady = input.hasAudioAnalysis && input.videoCount > 0 && input.sceneCount > 0 && captionsReady;
  const storyReady = ingestReady && input.hasTranscript && input.storyGenerated && input.editSlotCount > 0;
  const splitReady = storyReady && input.hasCommittedSplit;
  const matchReady = splitReady && input.captionReadyCount > 0 && input.matchedSlotCount > 0;
  const generateReady = matchReady && input.gapSlotCount === 0;
  const joinReady = generateReady && input.storySegmentCount > 0;
  const effectsReady = joinReady;
  const exportReady = input.finalExportReady || effectsReady;

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
      blockedReason: ingestReady ? null : "Finish audio analysis, scene detection, and scene captions in Ingest first.",
      prerequisiteKey: ingestReady ? null : "review",
      status: storyReady
        ? `${input.editSlotCount} edit slots`
        : ingestReady
          ? input.hasTranscript
            ? "Confirm story map"
            : "Add lyrics / transcript"
          : "Finish Ingest",
    },
    {
      key: "split",
      label: "Split",
      ready: splitReady,
      complete: splitReady,
      available: storyReady,
      blockedReason: storyReady ? null : "Confirm the Story map before building source cut windows.",
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
      blockedReason: splitReady ? null : "Build and commit Split before reviewing matches.",
      prerequisiteKey: splitReady ? null : "split",
      status: matchReady
        ? `${input.matchedSlotCount}/${input.editSlotCount} slots matched`
        : splitReady
          ? "Review match candidates"
          : "Needs committed split",
    },
    {
      key: "generate",
      label: "Generate",
      ready: generateReady,
      complete: generateReady,
      available: matchReady,
      blockedReason: matchReady ? null : "Finish Match before planning missing or replacement shots.",
      prerequisiteKey: matchReady ? null : "shuffle",
      status: !storyReady
        ? "Waiting for match"
        : input.gapSlotCount > 0
          ? `${input.gapSlotCount} true gap${input.gapSlotCount === 1 ? "" : "s"} to fill`
          : input.weakMatchSlotCount > 0
            ? `${input.weakMatchSlotCount} weak section${input.weakMatchSlotCount === 1 ? "" : "s"} · optional`
            : "No gaps · optional",
    },
    {
      key: "join",
      label: "Join",
      ready: joinReady,
      complete: input.finalExportReady,
      available: generateReady,
      blockedReason: generateReady ? null : "Resolve required Generate gaps before assembling the approved Join timeline.",
      prerequisiteKey: generateReady ? null : "generate",
      status: joinReady ? `${input.storySegmentCount} cuts · review` : "Waiting for story preview",
    },
    {
      key: "ramp",
      label: "Effects",
      ready: effectsReady,
      complete: input.finalExportReady,
      available: joinReady,
      blockedReason: joinReady ? null : "Build the Join timeline before applying transitions or effects.",
      prerequisiteKey: joinReady ? null : "join",
      status: input.finalExportReady ? `${input.shaderPresetLabel} · applied` : `${input.shaderPresetLabel} · review`,
    },
    {
      key: "compose",
      label: "Export",
      ready: exportReady,
      complete: input.finalExportReady,
      available: effectsReady,
      blockedReason: effectsReady ? null : "Finish Join and review Effects before opening export controls.",
      prerequisiteKey: effectsReady ? null : "ramp",
      status: input.finalExportReady ? "MP4 ready" : input.storySegmentCount > 0 ? "Preview ready · export pending" : "Waiting",
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
  if (input.sceneCount === 0) return "Detecting scenes";
  if (input.captionTotalCount === 0 || input.captionReadyCount < input.captionTotalCount) {
    return `Captioning ${input.captionReadyCount}/${input.captionTotalCount || input.sceneCount}`;
  }
  const captionLabel = input.captionTotalCount > 0 ? ` · ${input.captionReadyCount}/${input.captionTotalCount} captions` : "";
  return `${input.videoCount} clip${input.videoCount === 1 ? "" : "s"}${captionLabel}`;
}

function buildNextHint(stage: PipelineStage, input: PipelineStageInput) {
  switch (stage.key) {
    case "review":
      return `Next: ${stage.status} in Ingest.`;
    case "story":
      return input.hasTranscript
        ? "Next: confirm the Story map to unlock Split."
        : "Next: add the vocal stem or timed lyrics, then confirm the Story map.";
    case "split":
      return "Next: choose a source-window strategy and commit Split.";
    case "shuffle":
      return "Next: review semantic matches for each section in Match.";
    case "generate":
      return "Next: fill the remaining true coverage gaps in Generate before Join.";
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
