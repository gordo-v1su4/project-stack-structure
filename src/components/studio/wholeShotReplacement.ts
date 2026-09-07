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
  const hasStoryboard = params.storyboardFrameCount >= 1;
  const hasPacket = hasCut && hasStoryboard && params.packetErrorCount === 0 && params.audioReferenceReady;
  const hasImport = params.importedAssetCount > 0;

  const blockers: string[] = [];
  if (!hasCut) blockers.push("Select exactly one resolved cut in the preview queue.");
  if (hasCut && !hasStoryboard) blockers.push("Approve a fresh standalone 2K frame for this placement; a 3×3 grid is composition exploration only.");
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
      label: "Approved fresh 2K frame",
      complete: stepComplete["storyboard-frames"],
      active: currentStep === "storyboard-frames",
      blocked: !hasCut,
      detail: hasStoryboard ? `${params.storyboardFrameCount} frames ready` : "Review a 3×3 composition, then return and approve a fresh standalone frame",
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
      blocked: !hasCut || !hasStoryboard || !params.audioReferenceReady || params.packetErrorCount > 0,
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

export function isStandalone2kStoryboardFrame(asset: GeneratedStudioAsset) {
  const job = asset.storyboard;
  const url = asset.fullStorage?.mediaUrl ?? asset.fullStorage?.publicUrl ?? asset.resultUrl;
  return asset.status === "completed" && asset.mediaKind === "image" && job?.kind === "fresh-frame"
    && job.resolution === "2k" && Boolean(job.sourceGridId)
    && Number.isInteger(job.panelIndex) && job.panelIndex! >= 0 && job.panelIndex! < 9
    && typeof asset.width === "number" && asset.width >= 2000
    && typeof asset.height === "number" && asset.height >= 1000
    && Math.abs(asset.width / asset.height - 16 / 9) <= 0.08
    && !asset.split?.panels?.length
    && typeof url === "string" && url.startsWith("https://");
}

/** Only accepted standalone results can condition video; grid crops never qualify. */
export function approvedFreshFramesForPlacement(
  assets: GeneratedStudioAsset[],
  placement: { sectionId: string; songStart: number; songEnd: number; projectId?: string; planSignature?: string; requirementId?: string },
) {
  return assets.filter((asset) => {
    const job = asset.storyboard;
    return isStandalone2kStoryboardFrame(asset) && asset.reviewStatus === "approved" && job
      && (!placement.projectId || job.projectId === placement.projectId)
      && Boolean(placement.planSignature) && job.planSignature === placement.planSignature
      && job.requirementId === placement.requirementId
      && job.sectionId === placement.sectionId
      && job.songStart <= placement.songStart && job.songEnd >= placement.songEnd
      && placement.songEnd > placement.songStart;
  });
}

export function countStoryboardFramesForSegment(
  assets: GeneratedStudioAsset[],
  segment?: EditPlanPreviewSegment,
  projectId?: string,
) {
  if (!segment) return 0;
  return approvedFreshFramesForPlacement(assets, {
    sectionId: segment.sectionId, songStart: segment.musicStart, songEnd: segment.musicEnd, projectId,
    planSignature: segment.planSignature, requirementId: segment.requirementId,
  }).length;
}
