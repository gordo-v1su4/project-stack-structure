import type { EditPlanPreviewSegment } from "./musicVideoProject";
import type { GeneratedStudioAsset } from "./generatedAssets";
import type { CoverageSlot } from "./editPlanCoverage";

export type ReplacementWorkflowStep =
  | "select-cut"
  | "storyboard-frames"
  | "prepare-video1"
  | "copy-packet"
  | "import-result"
  | "approve-for-join";

export type ReplacementWorkflowStepState = {
  id: ReplacementWorkflowStep;
  label: string;
  complete: boolean;
  active: boolean;
  blocked: boolean;
  detail: string;
};

export function getReplacementWorkflowState(params: {
  selectedSegment?: EditPlanPreviewSegment;
  slot?: CoverageSlot;
  storyboardFrameCount: number;
  audioReferenceReady: boolean;
  packetErrorCount: number;
  importedAssetCount: number;
  approvedForJoin: boolean;
}): {
  steps: ReplacementWorkflowStepState[];
  currentStep: ReplacementWorkflowStep;
  blockers: string[];
  canPrepareVideo1: boolean;
  canCopyPacket: boolean;
  canImport: boolean;
} {
  const hasCut = Boolean(params.selectedSegment);
  const hasStoryboard = params.storyboardFrameCount >= 4;
  const hasPacket = params.packetErrorCount === 0 && params.audioReferenceReady;
  const hasImport = params.importedAssetCount > 0;

  const blockers: string[] = [];
  if (!hasCut) blockers.push("Select exactly one resolved cut in the preview queue.");
  if (hasCut && !hasStoryboard) blockers.push("Generate or approve a 2×2 storyboard frame grid for this section.");
  if (hasCut && hasStoryboard && !params.audioReferenceReady) blockers.push("Prepare Video_1 timing reference for this cut.");
  if (hasCut && params.packetErrorCount > 0) blockers.push("Resolve Seedance packet validation errors before copying.");

  const stepComplete: Record<ReplacementWorkflowStep, boolean> = {
    "select-cut": hasCut,
    "storyboard-frames": hasStoryboard,
    "prepare-video1": params.audioReferenceReady,
    "copy-packet": hasPacket,
    "import-result": hasImport,
    "approve-for-join": params.approvedForJoin,
  };

  const stepOrder: ReplacementWorkflowStep[] = [
    "select-cut",
    "storyboard-frames",
    "prepare-video1",
    "copy-packet",
    "import-result",
    "approve-for-join",
  ];

  const currentStep = stepOrder.find((step) => !stepComplete[step]) ?? "approve-for-join";

  const steps: ReplacementWorkflowStepState[] = [
    {
      id: "select-cut",
      label: "Select resolved cut",
      complete: stepComplete["select-cut"],
      active: currentStep === "select-cut",
      blocked: false,
      detail: params.selectedSegment
        ? `${params.slot?.item.label ?? params.selectedSegment.sectionId} · ${params.selectedSegment.musicStart.toFixed(1)}s`
        : "Pick one preview cut",
    },
    {
      id: "storyboard-frames",
      label: "2×2 storyboard frames",
      complete: stepComplete["storyboard-frames"],
      active: currentStep === "storyboard-frames",
      blocked: !hasCut,
      detail: hasStoryboard ? `${params.storyboardFrameCount} frames ready` : "Plan Nano Banana boards in Storyboard planner",
    },
    {
      id: "prepare-video1",
      label: "Prepare Video_1",
      complete: stepComplete["prepare-video1"],
      active: currentStep === "prepare-video1",
      blocked: !hasCut || !hasStoryboard,
      detail: params.audioReferenceReady ? "Timing reference ready" : "Render black audio timing clip",
    },
    {
      id: "copy-packet",
      label: "Copy Seedance packet",
      complete: stepComplete["copy-packet"],
      active: currentStep === "copy-packet",
      blocked: !params.audioReferenceReady || params.packetErrorCount > 0,
      detail: params.packetErrorCount > 0 ? `${params.packetErrorCount} validation error(s)` : "Copy prompt + reference order",
    },
    {
      id: "import-result",
      label: "Import completed video",
      complete: stepComplete["import-result"],
      active: currentStep === "import-result",
      blocked: !hasPacket,
      detail: hasImport ? `${params.importedAssetCount} candidate(s)` : "Import external Seedance output",
    },
    {
      id: "approve-for-join",
      label: "Approve for Join",
      complete: stepComplete["approve-for-join"],
      active: currentStep === "approve-for-join",
      blocked: !hasImport,
      detail: params.approvedForJoin ? "Approved for timeline" : "Approve exactly one generated clip",
    },
  ];

  return {
    steps,
    currentStep,
    blockers,
    canPrepareVideo1: hasCut && hasStoryboard && !params.audioReferenceReady,
    canCopyPacket: hasPacket,
    canImport: hasCut && hasPacket,
  };
}

export function countStoryboardFramesForSegment(
  assets: GeneratedStudioAsset[],
  segment?: EditPlanPreviewSegment,
) {
  if (!segment) return 0;
  let count = 0;
  for (const asset of assets) {
    if (asset.reviewStatus === "rejected") continue;
    if (asset.target?.sectionId !== segment.sectionId) continue;
    if (asset.split?.panels?.length) {
      count += asset.split.panels.length;
    } else if (asset.mediaKind === "image" && asset.resultUrl) {
      count += 1;
    }
  }
  return count;
}
