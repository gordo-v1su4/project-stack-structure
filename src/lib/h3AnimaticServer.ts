import { animaticContextSha256, animaticShotBinding, normalizeStillAnimaticPlan, stillAnimaticShotRequest,
  type AnimaticContext, type AnimaticShotBinding } from "@/components/studio/stillAnimatic";
import { sceneProofContextSha256 } from "@/components/studio/sceneProofs";
import { generationScopeSha256 } from "@/components/studio/generationScope";
import type { H3GenerationJob, H3GenerationRequest } from "@/components/studio/h3Generation";
import type { SavedStudioProject } from "./studioProjectStore";
import { H3RequestError, h3GenerationJobId, materializeH3Job } from "./h3GenerationServer";
import { buildH3StillDescriptor, parseH3StillRequest, type H3StillRequest } from "./h3StillRequest";
import type { H3StillJob } from "./h3StillJobStore";

const same = (a: unknown, b: unknown) => generationScopeSha256(a) === generationScopeSha256(b);
const conflict = () => new H3RequestError("Save the current exact timed still shot and its intent before generation.", 409);
function current(saved: SavedStudioProject) {
  const story = saved.draft.storyState, project = saved.draft.musicVideoProject;
  const plan = normalizeStillAnimaticPlan(story.stillAnimaticPlan);
  if (!project || !story.confirmedTreatmentSnapshot || !story.sceneProofPlan || !plan || plan.projectId !== saved.project.id) throw conflict();
  const input: AnimaticContext = { projectId: saved.project.id, project, treatment: story.confirmedTreatmentSnapshot,
    storyBeats: story.storyBeats, references: saved.draft.referenceAssets ?? [], sceneProofPlan: story.sceneProofPlan };
  if (story.sceneProofPlan.contextSha256 !== sceneProofContextSha256(input) || plan.contextSha256 !== animaticContextSha256(input)
    || Math.abs(plan.masterDuration - project.duration) > 0.001) throw conflict();
  return { input, plan };
}

/** Read saved authority; request bindings are lookup keys, never timing authority. */
export function savedAnimaticStillRequest(saved: SavedStudioProject, binding: AnimaticShotBinding) {
  const { input, plan } = current(saved), shot = plan.shots.find(s => s.id === binding.shotId);
  if (!shot || shot.sourceFrame || !same(binding, animaticShotBinding(plan, shot)) || !shot.record
    || shot.record.context !== binding.bindingSha256) throw conflict();
  const request = parseH3StillRequest(shot.record.request), expected = stillAnimaticShotRequest(input, plan, shot);
  const creative = ({ requestIntentId: _intent, ...shot }: H3GenerationRequest) => { void _intent; return shot; };
  if (!same(request.animaticShot, binding) || request.creativePrompt !== shot.prompt || !same(creative(request.shot), creative(expected))) throw conflict();
  return { request, shot, input, plan };
}

/** Retain all existing story/source/reference checks, while the new saved shot
 * supplies its own timing. The old overlapping item is provenance only.
 * This still-only adapter does not change video admission or old placements.
 */
export function materializeAnimaticStill(ownerId: string, saved: SavedStudioProject, request: H3StillRequest, bucket: string): H3GenerationJob {
  if (!request.animaticShot) return materializeH3Job(ownerId, saved, request.shot, bucket);
  const { request: canonical, shot, input } = savedAnimaticStillRequest(saved, request.animaticShot);
  if (!same(canonical, request)) throw conflict();
  const item = input.project.editPlan.timelineItems.find(t => t.id === shot.sourceTimelineItemId);
  const placement = input.project.placementPlan?.placements.find(p => p.timelineItemId === item?.id
    && p.songEnd > request.shot.songStart && p.songStart < request.shot.songEnd);
  if (!item || !placement) throw conflict();
  const provenanceRequest: H3GenerationRequest = { ...request.shot, timelineItemId: item.id, sectionId: item.sectionId,
    requirementId: item.requirementId, songStart: Math.max(request.shot.songStart, item.start, placement.songStart),
    songEnd: Math.min(request.shot.songEnd, item.end, placement.songEnd) };
  if (provenanceRequest.songEnd <= provenanceRequest.songStart) throw conflict();
  const base = materializeH3Job(ownerId, saved, provenanceRequest, bucket);
  return { ...base, id: h3GenerationJobId(ownerId, request.shot, base.references, { profile: base.profile, conditioningPreparationVersion: base.conditioningPreparationVersion }), request: request.shot,
    target: { planSignature: request.shot.planSignature, timelineItemId: request.shot.timelineItemId!,
      sectionId: request.shot.sectionId, sectionLabel: shot.title,
      songStart: request.shot.songStart, songEnd: request.shot.songEnd } };
}

export function assertAnimaticStillJob(saved: SavedStudioProject, job: H3StillJob, template: H3GenerationJob) {
  if (!job.animaticShot) return;
  const { request } = savedAnimaticStillRequest(saved, job.animaticShot);
  if (request.requestIntentId !== job.requestIntentId || request.attempt !== job.attempt || !same(request.shot, job.shotRequest)) throw conflict();
  const receipts = job.descriptor.body.references.map(({ assetId, etag, rawSha256 }) => ({ assetId, etag, rawSha256 }));
  if (!same(buildH3StillDescriptor(request, template, receipts), job.descriptor)) throw conflict();
}
