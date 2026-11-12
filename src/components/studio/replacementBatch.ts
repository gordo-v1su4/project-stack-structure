import { replacementTargets, type ReplacementReviewSnapshot } from "./replacementReview";
import { shotTakeTargetKey } from "./shotTakeReview";
import { createH3PickupWindow, selectH3ReferenceAssetIds, appendH3AestheticReferenceIds } from "./h3DraftPlan";
import { identityPolicyChoiceForReferences } from "./issuedIdentityPolicy";
import type { EditPlanPreviewSegment } from "./musicVideoProject";
import type { ReferenceAsset } from "./referenceAssets";
import type { AestheticReferenceLibrary } from "./aestheticReferences";
import type { H3GenerationRequest } from "./h3Generation";

/** Reconcile every mark; never drop stale rows or widen a destination. No model calls. */
export function replacementBatchRequests(projectId: string, snapshot: ReplacementReviewSnapshot,
  segments: EditPlanPreviewSegment[], references: ReferenceAsset[], aesthetics?: AestheticReferenceLibrary): H3GenerationRequest[] {
  if (snapshot.projectId !== projectId || !snapshot.revision || !snapshot.marks.length) throw new Error("Refresh current replacement marks first.");
  const saved = new Set(snapshot.targets.map(target => target.key));
  const current = new Set(replacementTargets(projectId, segments).map(target => target.key));
  return snapshot.marks.map(mark => {
    if (!saved.has(mark.key) || !current.has(mark.key)) throw new Error("Marked shots changed. Refresh marks and clear stale marks before preparing replacements.");
    const matches = segments.filter(segment => shotTakeTargetKey(projectId, segment) === mark.key);
    if (matches.length !== 1) throw new Error("A marked shot has no unique current destination.");
    const segment = createH3PickupWindow(matches[0], mark.end - mark.start);
    if (segment.animaticRetainedSource) throw new Error("Review retained source footage in Draft before requesting a replacement.");
    if (segment.animaticShotId && !segment.animaticMotion) throw new Error("Review the current still direction before preparing motion replacements.");
    const prompt = segment.storyDirection?.trim();
    if (!prompt) throw new Error("Confirm visible shot direction in Story before preparing replacements.");
    const referenceAssetIds = segment.animaticReferenceAssetIds ?? appendH3AestheticReferenceIds(selectH3ReferenceAssetIds(references, prompt), aesthetics, segment);
    // Missing draftRevision intentionally banks the result without selecting or approving it.
    return { projectId, planSignature: segment.planSignature!, requirementId: segment.requirementId,
      timelineItemId: segment.timelineItemId, sectionId: segment.sectionId, songStart: segment.musicStart, songEnd: segment.musicEnd,
      prompt, referenceAssetIds, requestIntentId: crypto.randomUUID(), attempt: 0,
      ...identityPolicyChoiceForReferences(references, referenceAssetIds),
      ...(segment.animaticMotion ? { animaticMotion: segment.animaticMotion } : {}),
      ...(segment.animaticFirstFrame ? { conditioning: segment.animaticFirstFrame } : {}) };
  });
}

export async function readReplacementMarks(projectId: string): Promise<ReplacementReviewSnapshot> {
  const response = await fetch(`/api/studio/projects/${encodeURIComponent(projectId)}/replacement-review`, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || "Could not refresh replacement marks.");
  if (value.projectId !== projectId || !Array.isArray(value.targets) || !Array.isArray(value.marks)) throw new Error("Replacement marks belong to another project.");
  return value;
}
