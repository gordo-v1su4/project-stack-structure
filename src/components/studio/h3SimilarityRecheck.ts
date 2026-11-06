import type { H3GenerationJob } from "./h3Generation";
import type { GeneratedStudioAsset } from "./generatedAssets";
import { buildH3IdentityAssessmentScope, identityAssessmentAsset, type H3IdentityAssessment } from "./h3IdentityAssessment";

/** Reassess the existing durable video; never resume or submit GPU inference. */
export async function recheckH3Similarity(job: H3GenerationJob, options: {
  requestIntentId: string;
  asset?: GeneratedStudioAsset;
  fetchImpl?: typeof fetch;
  wait?: (milliseconds: number) => Promise<void>;
  now?: () => number;
}): Promise<GeneratedStudioAsset> {
  const original = job.result?.asset;
  if (job.state !== "ready" || !original || original.reviewStatus === "rejected" || original.identityVerification?.status === "rejected") {
    throw new Error("Only an existing unrejected ready take can be checked.");
  }
  const fetchImpl = options.fetchImpl ?? fetch, now = options.now ?? Date.now;
  const wait = options.wait ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  const deadline = now() + 90_000;
  const previous = JSON.stringify(original.identityVerification);
  const scope = options.asset ? buildH3IdentityAssessmentScope(job,options.asset.trimStart ?? 0,options.requestIntentId) : undefined;
  const requested = await fetchImpl("/api/generate/h3", { method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId: job.projectId, jobId: job.id, action: "recheck_identity", requestIntentId: options.requestIntentId,
      ...(scope ? { trimStart: scope.trimStart } : {}) }),
    signal: AbortSignal.timeout(15_000) });
  const result = await requested.json() as { error?: string; verificationRunId?: string; assessmentId?: string };
  if (!requested.ok || !result.verificationRunId) throw new Error(result.error || "Could not confirm the similarity check. The video was not regenerated.");
  if (scope && result.assessmentId !== scope.id) throw new Error("The confirmed range assessment does not match this selected trim.");
  while (now() < deadline) {
    const response = await fetchImpl(`/api/generate/h3?${new URLSearchParams({ projectId: job.projectId, jobId: job.id, ...(scope ? { assessmentId: scope.id } : {}) })}`,
      { cache: "no-store", signal: AbortSignal.timeout(Math.max(1, Math.min(15_000, deadline - now()))) });
    const body = await response.json() as { job?: H3GenerationJob; jobId?: string; assessment?: H3IdentityAssessment; error?: string };
    if (scope) {
      if (!response.ok || body.jobId !== job.id) throw new Error(body.error || "Could not read the exact range assessment.");
      if (body.assessment) {
        if (body.assessment.scope.id !== scope.id) throw new Error("The returned range assessment changed.");
        if (body.assessment.status === "failed") throw new Error("The exact range assessment failed. Original evidence is unchanged.");
        return identityAssessmentAsset(body.assessment,job,scope.trimStart);
      }
      await wait(Math.min(1500,Math.max(0,deadline - now())));
      continue;
    }
    if (!response.ok || !body.job || body.job.id !== job.id || body.job.projectId !== job.projectId) {
      throw new Error(body.error || "Could not read the existing similarity check. No replacement render was submitted.");
    }
    const asset = body.job.result?.asset;
    if (asset && asset.id === original.id && asset.jobId === original.jobId && asset.identityVerification
      && JSON.stringify(asset.identityVerification) !== previous) return asset;
    await wait(Math.min(1500, Math.max(0, deadline - now())));
  }
  throw new Error("Similarity check is still pending. Check again later; the existing video remains saved and was not regenerated.");
}
