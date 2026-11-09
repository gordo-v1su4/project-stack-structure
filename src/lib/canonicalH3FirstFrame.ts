import type { GeneratedStudioAsset } from "@/components/studio/generatedAssets";
import type { H3GenerationJob } from "@/components/studio/h3Generation";
import { H3_FIRST_FRAME_PROFILE, h3FirstFrameDigest, normalizeH3FirstFrameReceipt } from "@/components/studio/h3FirstFrame";
import { assertH3FirstFrameMatchesJob, downloadH3FirstFrame, readH3FirstFrame, readH3FirstFrameAssessment } from "./h3FirstFrameStore";

/** Shared by canonical planning/reuse and final export; the old still screen remains mandatory. */
export async function assertCanonicalH3FirstFrame(ownerId: string, projectId: string, job: H3GenerationJob, asset: GeneratedStudioAsset) {
  if (job.profile !== H3_FIRST_FRAME_PROFILE) return;
  const receipt = normalizeH3FirstFrameReceipt(job.result?.asset.firstFrame);
  if (!receipt || !job.firstFrame || !job.firstFrameAssessment || !job.identityPolicy
    || h3FirstFrameDigest(receipt) !== h3FirstFrameDigest({ artifact: job.firstFrame, assessment: job.firstFrameAssessment })
    || h3FirstFrameDigest(job.conditioningReferenceHashes ?? null) !== h3FirstFrameDigest([job.firstFrame.body.pngSha256])
    || h3FirstFrameDigest(asset.firstFrame ?? null) !== h3FirstFrameDigest(receipt)) throw new Error("First-frame receipt differs.");
  const artifact = await readH3FirstFrame(ownerId, projectId, job.firstFrame.id);
  if (!artifact || h3FirstFrameDigest(artifact) !== h3FirstFrameDigest(job.firstFrame)) throw new Error("First-frame artifact differs.");
  assertH3FirstFrameMatchesJob(artifact, job);
  const still = await readH3FirstFrameAssessment(artifact, job.identityPolicy.sha256);
  if (!still || still.status !== "eligible" || h3FirstFrameDigest(still) !== h3FirstFrameDigest(job.firstFrameAssessment)) throw new Error("First-frame still screen differs.");
  await downloadH3FirstFrame(artifact);
}
