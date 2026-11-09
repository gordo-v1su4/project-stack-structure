import { normalizeSceneProofPlan, sceneMomentBinding, sceneProofContextSha256, sceneProofPrompt, sceneProofReviewStatus, sceneProofShot,
  type SceneProofBinding, type SceneProofContext } from "@/components/studio/sceneProofs";
import { generationScopeSha256 } from "@/components/studio/generationScope";
import type { H3GenerationRequest } from "@/components/studio/h3Generation";
import type { SavedStudioProject } from "./studioProjectStore";
import { normalizeStudioOwnerSegment } from "./studioStoragePaths";
import { H3RequestError, materializeH3Job } from "./h3GenerationServer";
import { buildH3StillDescriptor, parseH3StillRequest, type H3StillRequest } from "./h3StillRequest";
import { assertH3StillJob, readH3StillJob, type H3StillJob } from "./h3StillJobStore";
import { pinH3JobReferences } from "./h3JobStore";

const same = (a: unknown, b: unknown) => generationScopeSha256(a) === generationScopeSha256(b);
const conflict = () => new H3RequestError("Save and approve all current whole-song scene previews before generating video.", 409);

function currentPlan(saved: SavedStudioProject) {
  const story = saved.draft.storyState, project = saved.draft.musicVideoProject;
  const plan = normalizeSceneProofPlan(story.sceneProofPlan);
  if (!plan || !project || !story.confirmedTreatmentSnapshot || plan.projectId !== saved.project.id) throw conflict();
  const context: SceneProofContext = { projectId: saved.project.id, project, treatment: story.confirmedTreatmentSnapshot,
    storyBeats: story.storyBeats, references: saved.draft.referenceAssets ?? [] };
  // Narrative scenes can subdivide or cross musical sections. The ordered
  // windows must still cover the actual whole master, with no duplicated time.
  if (plan.contextSha256 !== sceneProofContextSha256(context) || !Number.isFinite(project.duration) || project.duration <= 0
    || Math.abs(plan.scenes[0].songStart) > 0.001 || Math.abs(plan.scenes.at(-1)!.songEnd - project.duration) > 0.001
    || plan.scenes.some((scene, index) => typeof scene.id !== "string" || !scene.id.trim() || scene.id.length > 200
      || /[\x00-\x1f\x7f]/.test(scene.id) || scene.songEnd > project.duration + 0.001
      || index > 0 && Math.abs(scene.songStart - plan.scenes[index - 1].songEnd) > 0.001)) throw conflict();
  return { plan, context };
}

/** A browser binding is only a lookup key into the fresh saved editorial state. */
export function savedH3SceneProofRequest(saved: SavedStudioProject, binding: SceneProofBinding): H3StillRequest {
  const { plan, context } = currentPlan(saved);
  const scene = plan.scenes.find(scene => scene.id === binding.sceneId);
  const moment = scene?.moments.find(moment => moment.role === binding.momentId);
  if (!scene || !moment || !same(binding, sceneMomentBinding(plan, scene, moment))
    || !moment.record || moment.record.projectId !== saved.project.id || moment.record.context !== binding.bindingSha256) throw conflict();
  const request = parseH3StillRequest(moment.record.request);
  // Scene previews select their real musical window; browser-supplied cut changes
  // cannot acquire the saved scene's review authority. UUIDs are independent intent.
  const creativeShot = ({ requestIntentId: _intent, ...shot }: H3GenerationRequest) => { void _intent; return shot; };
  if (!same(request.sceneProof, binding) || request.creativePrompt !== sceneProofPrompt(scene, moment)
    || !same(creativeShot(request.shot), creativeShot(sceneProofShot(context, plan, scene, moment)))) throw conflict();
  return request;
}

export function assertH3SceneProofRequest(saved: SavedStudioProject, request: H3StillRequest) {
  if (request.sceneProof && !same(savedH3SceneProofRequest(saved, request.sceneProof), request)) throw conflict();
}

/** Both admission and workers bind the issued job to the current saved moment.
 * Rebuilding the descriptor also verifies creative prose, seed and raw receipts.
 */
export function assertH3SceneProofJob(saved: SavedStudioProject, job: H3StillJob,
  template: H3StillJob["template"]) {
  if (!job.sceneProof) return;
  const request = savedH3SceneProofRequest(saved, job.sceneProof);
  if (request.requestIntentId !== job.requestIntentId || request.attempt !== job.attempt || !same(request.shot, job.shotRequest)) throw conflict();
  const receipts = job.descriptor.body.references.map(({ assetId, etag, rawSha256 }) => ({ assetId, etag, rawSha256 }));
  if (!same(buildH3StillDescriptor(request, template, receipts), job.descriptor)) throw conflict();
}

type ReviewDependencies = { read: typeof readH3StillJob; pin: typeof pinH3JobReferences };
const defaults: ReviewDependencies = { read: readH3StillJob, pin: pinH3JobReferences };

/** Video-purpose gate only. Stills and already-submitted recovery remain able to
 * run without scene approval; a copied client proof is never evidence of a job.
 */
export async function assertH3SceneProofsApproved(ownerId: string, saved: SavedStudioProject, bucket: string,
  dependencies: ReviewDependencies = defaults) {
  if (saved.draft.storyState.sceneProofPlan === undefined) return; // Historical projects retain their workflow.
  if (saved.project.ownerId !== normalizeStudioOwnerSegment(ownerId)) throw conflict();
  const { plan } = currentPlan(saved);
  for (const scene of plan.scenes) {
    if (sceneProofReviewStatus(plan, scene, plan.contextSha256) !== "approved") throw conflict();
    for (const moment of scene.moments) {
      const proof = moment.proof!, record = moment.record!;
      if (record.jobId !== proof.jobId) throw conflict();
      const job = await dependencies.read(ownerId, saved.project.id, proof.jobId);
      if (!job || job.ownerId !== saved.project.ownerId || job.projectId !== saved.project.id) throw conflict();
      assertH3StillJob(job);
      if (job.state !== "ready" || !job.result || !same(job.sceneProof, sceneMomentBinding(plan, scene, moment))
        || proof.descriptorSha256 !== job.descriptor.sha256 || !same(proof.result, job.result)) throw conflict();
      const template = await dependencies.pin(materializeH3Job(ownerId, saved, job.shotRequest, bucket));
      assertH3SceneProofJob(saved, job, template);
    }
  }
}
