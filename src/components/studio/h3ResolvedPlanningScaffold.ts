import { withCurrentReferenceIdentity } from "./currentReferenceIdentity";
import { applyGeneratedAssetOverlays, type GeneratedStudioAsset } from "./generatedAssets";
import { orderedDraftGeneratedAssets, type GeneratedDraftSelection } from "./generatedDraft";
import { h3WindowKey, planH3DraftWindows } from "./h3DraftPlan";
import { buildEditPlanPreviewSegments, isPlacementPlanCurrent, type EditPlanPreviewSegment, type MusicVideoProject } from "./musicVideoProject";
import type { UploadedVideoSource } from "./types";

export type H3PlanningCoverage = {
  windowKey: string; placementId: string; songStart: number; songEnd: number;
  kind: "missing" | "source" | "generated";
  sourceStart?: number; sourceEnd?: number; momentId?: string; sourceClipId?: number;
  generatedAssetId?: string;
  media?: { sha256?: string; frameCount?: number; frameRate?: number; bucket?: string; objectKey?: string };
  target?: GeneratedStudioAsset["target"];
  identity?: { assessmentId?: string; approvedEvidenceSha256?: string; approvedCurrentEvidenceSha256?: string };
};

/** Shared planning geometry and applied coverage only. Prompts are never observed action evidence. */
export function buildH3ResolvedPlanningScaffold({ project, generatedAssets, draft, videoSources = [] }: {
  project: MusicVideoProject; generatedAssets: GeneratedStudioAsset[]; draft: GeneratedDraftSelection | null | undefined;
  videoSources?: UploadedVideoSource[];
}) {
  if (!isPlacementPlanCurrent(project)) throw new Error("Review the current placement plan before shot planning.");
  const base = buildEditPlanPreviewSegments({ project, videoSources, editSettings: project.placementPlan!.settings }).map(segment => {
    const placement = project.placementPlan!.placements.find(candidate => candidate.id === segment.placementId);
    if (placement?.kind !== "source") return segment;
    const moment = project.videoMoments.find(candidate => candidate.id === placement.momentId);
    if (!moment) throw new Error("Canonical source placement moment is unavailable.");
    // Canonical source coverage is independent of a browser's hydrated playback URL.
    return { ...segment, kind: "source" as const, gapReason: undefined, startTime: placement.sourceStart, endTime: placement.sourceEnd,
      momentId: moment?.id, sourceClipId: moment?.sourceClipId };
  });
  if (!base.length || base.length > 512) throw new Error("Shot planning scaffold exceeds its placement bound.");
  const normalized = withCurrentReferenceIdentity(generatedAssets, project.currentIdentity);
  const eligible = orderedDraftGeneratedAssets(base, normalized, draft);
  const resolved = applyGeneratedAssetOverlays(base, eligible);
  if (resolved.length > 512) throw new Error("Shot planning scaffold exceeds its fragment bound.");
  const byId = new Map(eligible.map(asset => [asset.id, asset]));
  const segments: EditPlanPreviewSegment[] = [];
  const coverageLedger: H3PlanningCoverage[] = [];
  for (const fragment of resolved) {
    if (!Number.isFinite(fragment.musicStart) || fragment.musicStart < 0 || !Number.isFinite(fragment.musicEnd)
      || fragment.musicEnd <= fragment.musicStart) throw new Error("Shot planning requires valid bound placement windows.");
    // Calling the splitter separately preserves actual overlay edges and the exact remaining-hole keys.
    const windows = planH3DraftWindows([{ ...fragment, kind: "gap", videoUrl: "" }]);
    if (!windows.length) throw new Error("Shot planning requires valid bound placement windows.");
    for (const window of windows) {
      if (!fragment.placementId || !Number.isFinite(fragment.startTime) || !Number.isFinite(fragment.endTime)
        || fragment.startTime < 0 || fragment.endTime <= fragment.startTime) throw new Error("Shot planning requires finite bound placement trims.");
      const covered = fragment.kind === "source";
      const ratio = (fragment.endTime - fragment.startTime) / (fragment.musicEnd - fragment.musicStart);
      const sourceStart = fragment.startTime + (window.musicStart - fragment.musicStart) * ratio;
      const sourceEnd = fragment.startTime + (window.musicEnd - fragment.musicStart) * ratio;
      const segment = { ...window, kind: fragment.kind, videoUrl: fragment.videoUrl,
        startTime: covered ? sourceStart : 0, endTime: covered ? sourceEnd : window.musicEnd - window.musicStart };
      segments.push(segment);
      const asset = fragment.generatedAssetId ? byId.get(fragment.generatedAssetId) : undefined;
      if (fragment.generatedAssetId && !asset) throw new Error("Applied overlay provenance is unavailable.");
      coverageLedger.push({ windowKey: h3WindowKey(window), placementId: fragment.placementId,
        songStart: window.musicStart, songEnd: window.musicEnd,
        kind: !covered ? "missing" : asset ? "generated" : "source",
        ...(covered ? { sourceStart, sourceEnd } : {}),
        ...(asset ? { generatedAssetId: asset.id, target: structuredClone(asset.target),
          media: { sha256: asset.mediaSha256, frameCount: asset.mediaFrameCount, frameRate: asset.mediaFrameRate,
            bucket: asset.fullStorage?.bucket, objectKey: asset.fullStorage?.objectKey ?? asset.fullStorage?.storagePath },
          identity: { assessmentId: asset.identityAssessmentId, approvedEvidenceSha256: asset.approvedIdentityEvidenceSha256,
            approvedCurrentEvidenceSha256: asset.approvedCurrentReferenceEvidenceSha256 } }
          : covered ? { momentId: fragment.momentId, sourceClipId: fragment.sourceClipId,
            media: { sha256: project.videoMoments.find(moment => moment.id === fragment.momentId)?.contentHash } } : {}),
      });
      if (segments.length > 512) throw new Error("Shot planning scaffold exceeds its window bound.");
    }
  }
  if (!segments.length || segments.some(segment => !segment.planSignature)) throw new Error("Shot planning requires current windows.");
  // Excludes runtime URLs, titles, prompts, unrelated bank entries and draft revision counters.
  const stableBindingPayload = { version: 1 as const, planSignature: segments[0].planSignature!, coverage: structuredClone(coverageLedger) };
  if (new TextEncoder().encode(JSON.stringify(stableBindingPayload)).byteLength > 512 * 1024) {
    throw new Error("Shot planning scaffold exceeds its binding byte bound.");
  }
  return { segments, coverageLedger, stableBindingPayload };
}
