import { resolveSelectedFootageEvidence, type SelectedFootageEvidenceInput } from "@/components/studio/selectedFootageEvidence";
import { identityAssessmentAsset } from "@/components/studio/h3IdentityAssessment";
import { readH3Job } from "./h3JobStore";
import { readH3IdentityAssessment } from "./h3IdentityAssessmentStore";
import { canonicalCurrentIdentityAsset } from "./currentIdentityValidation";
import { assertIssuedH3DraftPolicyMatchesJob, readIssuedH3DraftPolicy } from "./h3DraftPolicyStore";
import { assertCanonicalH3FirstFrame } from "./canonicalH3FirstFrame";

type Input = Omit<SelectedFootageEvidenceInput, "ownerId" | "job" | "rangeAssessment" | "advisoryCachedRange"> & { ownerId: string };
type Dependencies = { readJob: typeof readH3Job; readRange: typeof readH3IdentityAssessment;
  currentIdentity: typeof canonicalCurrentIdentityAsset; readPolicy: typeof readIssuedH3DraftPolicy };

/** Caller supplies a fresh owned saved selection. No provider calls, media downloads, or job reconciliation. */
export async function resolveCanonicalSelectedFootageEvidence(input: Input, dependencies: Partial<Dependencies> = {}) {
  if (!input.ownerId || !input.projectId) throw new Error("Owned selected-footage scope is required.");
  if (input.asset.provider === "editorial" && !input.asset.jobId) return resolveSelectedFootageEvidence(input);
  const id = input.asset.jobId;
  if (!id || !/^h3-[a-f0-9]{64}$/.test(id)) return undefined;
  const job = await (dependencies.readJob ?? readH3Job)(input.ownerId, input.projectId, id);
  if (!job || job.ownerId !== input.ownerId || job.projectId !== input.projectId || !job.result) return undefined;
  const rangeAssessment = input.asset.identityAssessmentId
    ? await (dependencies.readRange ?? readH3IdentityAssessment)(input.ownerId, input.projectId, id, input.asset.identityAssessmentId) : undefined;
  if (input.asset.identityAssessmentId && !rangeAssessment) return undefined;
  const evidence = resolveSelectedFootageEvidence({ ...input, job, rangeAssessment: rangeAssessment ?? undefined, advisoryCachedRange: false });
  if (!evidence) return undefined;
  let canonical = rangeAssessment ? identityAssessmentAsset(rangeAssessment, job, input.asset.trimStart ?? 0) : job.result.asset;
  canonical = { ...canonical, jobId: job.id, model: job.profile, target: job.target, trimStart: input.asset.trimStart ?? 0 };
  if (input.currentIdentity) await (dependencies.currentIdentity ?? canonicalCurrentIdentityAsset)(input.ownerId, input.projectId, job, canonical, input.currentIdentity);
  await assertCanonicalH3FirstFrame(input.ownerId, input.projectId, job, input.asset);
  if (job.request.identityPolicyFamily) {
    if (!job.identityPolicy || !job.referenceHashes) return undefined;
    const policy = await (dependencies.readPolicy ?? readIssuedH3DraftPolicy)(input.ownerId, input.projectId, job.identityPolicy);
    if (!policy) return undefined;
    assertIssuedH3DraftPolicyMatchesJob(policy, job, job.referenceHashes);
  }
  return evidence;
}
