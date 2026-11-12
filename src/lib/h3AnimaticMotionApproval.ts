import type { H3GenerationRequest } from "@/components/studio/h3Generation";
import { generationScopeSha256 } from "@/components/studio/generationScope";
import type { SavedStudioProject } from "./studioProjectStore";
import { normalizeStudioOwnerSegment } from "./studioStoragePaths";
import { H3RequestError } from "./h3GenerationServer";
import { reviewedAnimaticMotionShot } from "./h3AnimaticMotionServer";
import { assertAnimaticStillJob, materializeAnimaticStill } from "./h3AnimaticServer";
import { assertH3StillJob, readH3StillJob } from "./h3StillJobStore";
import { pinH3JobReferences } from "./h3JobStore";

const same = (a: unknown, b: unknown) => generationScopeSha256(a) === generationScopeSha256(b);
const conflict = () => new H3RequestError("Review the current complete animatic and its canonical still before generating motion.", 409);

/** Public admission and worker preflight share the canonical stored-job gate. */
export async function assertAnimaticMotionApproved(ownerId: string, saved: SavedStudioProject, bucket: string,
  request: H3GenerationRequest, dependencies = { read: readH3StillJob, pin: pinH3JobReferences }) {
  if (saved.project.ownerId !== normalizeStudioOwnerSegment(ownerId)) throw conflict();
  const { shot, request: stillRequest } = reviewedAnimaticMotionShot(saved, request);
  const job = await dependencies.read(ownerId, saved.project.id, shot.proof!.jobId);
  if (!job || job.ownerId !== saved.project.ownerId || job.projectId !== saved.project.id) throw conflict();
  assertH3StillJob(job);
  if (job.state !== "ready" || !job.result || !job.animaticShot || !same(job.animaticShot, stillRequest.animaticShot)
    || !same(job.result, shot.proof!.result) || job.descriptor.sha256 !== shot.proof!.descriptorSha256) throw conflict();
  const template = await dependencies.pin(materializeAnimaticStill(ownerId, saved, stillRequest, bucket));
  assertAnimaticStillJob(saved, job, template);
}
