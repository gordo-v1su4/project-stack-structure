import type { H3GenerationJob } from "./h3Generation";
import type { GeneratedStudioAsset } from "./generatedAssets";

/** Reassess the existing durable video; never resume or submit GPU inference. */
export async function recheckH3Similarity(job: H3GenerationJob, options: {
  requestIntentId: string;
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
  const requested = await fetchImpl("/api/generate/h3", { method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId: job.projectId, jobId: job.id, action: "recheck_identity", requestIntentId: options.requestIntentId }),
    signal: AbortSignal.timeout(15_000) });
  const result = await requested.json() as { error?: string; verificationRunId?: string };
  if (!requested.ok || !result.verificationRunId) throw new Error(result.error || "Could not confirm the similarity check. The video was not regenerated.");
  while (now() < deadline) {
    const response = await fetchImpl(`/api/generate/h3?${new URLSearchParams({ projectId: job.projectId, jobId: job.id })}`,
      { cache: "no-store", signal: AbortSignal.timeout(Math.max(1, Math.min(15_000, deadline - now()))) });
    const body = await response.json() as { job?: H3GenerationJob; error?: string };
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
