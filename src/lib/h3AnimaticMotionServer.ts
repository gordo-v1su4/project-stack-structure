import { animaticReviewBinding } from "@/components/studio/animaticReview";
import { animaticShotBinding } from "@/components/studio/stillAnimatic";
import { generationScopeSha256 } from "@/components/studio/generationScope";
import { H3_PROFILE, type H3GenerationJob, type H3GenerationProfileOptions, type H3GenerationRequest, type H3ReferenceSnapshot } from "@/components/studio/h3Generation";
import { H3_FIRST_FRAME_PROFILE } from "@/components/studio/h3FirstFrame";
import type { SavedStudioProject } from "./studioProjectStore";
import { H3RequestError, h3GenerationJobId, materializeH3Job } from "./h3GenerationServer";
import { savedAnimaticStillRequest } from "./h3AnimaticServer";

const same = (a: unknown, b: unknown) => generationScopeSha256(a) === generationScopeSha256(b);
const conflict = () => new H3RequestError("Review the current complete animatic and its exact shot before generating motion.", 409);

export function reviewedAnimaticMotionShot(saved: SavedStudioProject, request: H3GenerationRequest) {
  const binding = request.animaticMotion;
  if (!binding || request.sceneProofScopeSha256 !== undefined || request.projectId !== saved.project.id) throw conflict();
  const current = savedAnimaticStillRequest(saved, { shotId: binding.shotId, bindingSha256: binding.bindingSha256 });
  const { plan, shot, input } = current, review = plan.review, image = shot.proof?.result.master;
  const audio = saved.draft.analysis ?? input.project.song;
  if (!audio?.storageBucket || !audio.storagePath || !Number.isFinite(audio.duration)
    || Math.abs(audio.duration - plan.masterDuration) > 0.001) throw conflict();
  const audioUrl = `/api/storage/media?${new URLSearchParams({ bucket: audio.storageBucket, objectKey: audio.storagePath })}`;
  if (!review || review.status !== "approved" || review.bindingSha256 !== binding.reviewBindingSha256
    || animaticReviewBinding(plan, plan.contextSha256, audioUrl) !== review.bindingSha256
    || !image || image.sha256 !== binding.imageSha256 || !same(animaticShotBinding(plan, shot), { shotId: binding.shotId, bindingSha256: binding.bindingSha256 })
    || request.timelineItemId !== `animatic:${shot.id}` || request.requirementId !== undefined
    || request.sectionId !== current.request.shot.sectionId || request.songStart !== current.request.shot.songStart
    || request.songEnd !== current.request.shot.songEnd || !same(request.referenceAssetIds, shot.referenceAssetIds)) throw conflict();
  const prefix = `media-uploads/projects/${saved.project.ownerId}/still-results/${saved.project.id}/${shot.proof!.jobId}/`;
  if (image.objectKey !== `${prefix}master.png` || shot.proof!.result.native.objectKey !== `${prefix}native.png`) throw conflict();
  return { ...current, image };
}

/** Keep source/story/RAW validation, without replacing the old edit plan. */
export function materializeAnimaticMotion(ownerId: string, saved: SavedStudioProject, request: H3GenerationRequest,
  bucket: string, options: H3GenerationProfileOptions): H3GenerationJob {
  if (options.profile !== H3_PROFILE && options.profile !== H3_FIRST_FRAME_PROFILE) throw conflict();
  const { input, shot, image } = reviewedAnimaticMotionShot(saved, request);
  const item = input.project.editPlan.timelineItems.find(t => t.id === shot.sourceTimelineItemId);
  const placement = input.project.placementPlan?.placements.find(p => p.timelineItemId === item?.id
    && p.songEnd > request.songStart && p.songStart < request.songEnd);
  if (!item || !placement || image.bucket !== bucket) throw conflict();
  const { animaticMotion: _binding, ...original } = request; void _binding;
  const provenance = { ...original, timelineItemId: item.id, sectionId: item.sectionId, requirementId: item.requirementId,
    songStart: Math.max(request.songStart, item.start, placement.songStart), songEnd: Math.min(request.songEnd, item.end, placement.songEnd) };
  if (provenance.songEnd <= provenance.songStart) throw conflict();
  const base = materializeH3Job(ownerId, saved, provenance, bucket, options);
  let references = base.references;
  if (options.profile === H3_FIRST_FRAME_PROFILE) {
    // I2VA binds the actual native still PNG; it never silently becomes Ref2VA.
    if (!options.firstFrame || options.firstFrame.id !== shot.proof!.result.artifactId || options.firstFrame.sha256 !== shot.proof!.result.artifactSha256
      || options.firstFrame.body.pngSha256 !== shot.proof!.result.native.sha256) throw conflict();
  } else {
    if (request.conditioning || references.length >= 9) throw conflict();
    const composition: H3ReferenceSnapshot = { assetId: `animatic-image:${shot.id}`, canonicalName: `${shot.id} reviewed frame`, role: "composition",
      bucket: image.bucket, objectKey: image.objectKey, version: generationScopeSha256(image),
      aesthetic: { purpose: "shot", guidance: "Composition and scene state only. Named character references retain identity authority.", originalSha256: image.sha256 } };
    references = [...references, composition];
  }
  return { ...base, request, references, id: h3GenerationJobId(ownerId, request, references, options),
    target: { planSignature: request.planSignature, timelineItemId: request.timelineItemId!, sectionId: request.sectionId,
      sectionLabel: shot.title, songStart: request.songStart, songEnd: request.songEnd } };
}

