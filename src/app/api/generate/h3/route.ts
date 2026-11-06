import { getSessionUser, unauthorizedResponse } from "@/lib/session";
import { readStudioProject } from "@/lib/studioProjectStore";
import { getMediaGatewayConfig } from "@/lib/mediaGateway";
import { H3RequestError, h3GenerationJobId, materializeH3Job, parseH3Request } from "@/lib/h3GenerationServer";
import { H3_LEGACY_PROFILE } from "@/components/studio/h3Generation";
import { claimH3GenerationIntent, createH3Job, listH3Jobs, pinH3JobReferences, readH3Job, updateH3Job } from "@/lib/h3JobStore";
import { compileH3Prompt } from "@/lib/h3Workflow";
import { retrieveTriggerRun, triggerH3Generation, triggerH3IdentityRecheck } from "@/lib/triggerOrchestration";

export const runtime = "nodejs";

async function reconcileWorker(job: Awaited<ReturnType<typeof createH3Job>>) {
  if (!job.runId || ["ready", "failed", "cancelled", "submission_unknown"].includes(job.state)) return job;
  let run: Awaited<ReturnType<typeof retrieveTriggerRun>>;
  try { run = await retrieveTriggerRun(job.runId); }
  catch { return job; } // A control-plane outage must not turn an active render into a failed job.
  if (!run.isCompleted && !run.isFailed && !run.isCancelled) return job;
  return updateH3Job(job.ownerId, job.projectId, job.id, current => {
    if (current.runId !== job.runId || ["ready", "failed", "cancelled"].includes(current.state)) return current;
    const unknown = Boolean(current.promptId) || current.state === "submitting" || current.state === "cancel_requested";
    return { ...current, state: unknown ? "submission_unknown" : "failed",
      error: current.cancelRequestedAt ? "The cancellation worker ended. Resume cancellation reconciliation; the result remains excluded."
        : unknown ? "The worker ended before saving completion. Resume the existing render; generation has not been repeated."
        : "The worker ended before submitting a video. Create a deliberate retry." };
  });
}

function failure(error: unknown) {
  return Response.json({ success: false, error: error instanceof Error ? error.message : "H3 generation failed." },
    { status: error instanceof H3RequestError ? error.status : 503 });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return unauthorizedResponse();
  try {
    const input = parseH3Request(await request.json());
    const project = await readStudioProject(user.id, input.projectId, { fresh: true });
    if (!project) throw new H3RequestError("Project not found.", 404);
    const config = getMediaGatewayConfig();
    if (!config) throw new H3RequestError("Generation storage is not configured.", 503);
    let proposed = await pinH3JobReferences(materializeH3Job(user.id, project, input, config.bucket));
    // A release may change the default profile between durable creation and
    // dispatch. Only an exact existing legacy request may retain that profile.
    const legacyId = h3GenerationJobId(user.id, input, proposed.references, { profile: H3_LEGACY_PROFILE });
    const legacy = await readH3Job(user.id, input.projectId, legacyId);
    if (legacy) {
      if (legacy.id !== legacyId || legacy.ownerId !== user.id || legacy.projectId !== input.projectId
        || legacy.profile !== H3_LEGACY_PROFILE || legacy.conditioningPreparationVersion !== undefined
        || JSON.stringify(legacy.request) !== JSON.stringify(input)
        || JSON.stringify(legacy.references) !== JSON.stringify(proposed.references)) {
        throw new H3RequestError("The saved generation intent no longer matches this shot.", 409);
      }
      proposed = await pinH3JobReferences(materializeH3Job(user.id, project, input, config.bucket, {
        profile: legacy.profile, conditioningPreparationVersion: legacy.conditioningPreparationVersion,
      }));
      if (proposed.id !== legacy.id) throw new H3RequestError("The saved generation references changed.", 409);
    }
    // Compile before enqueue so invalid language or reference roles create no GPU work.
    try { compileH3Prompt(proposed); } catch (error) { throw new H3RequestError((error as Error).message, 422); }
    await claimH3GenerationIntent(proposed);
    const job = await createH3Job(proposed);
    if (job.runId || job.state === "ready") return Response.json({ success: true, runId: job.runId, jobId: job.id, job }, { status: 202 });
    const handle = await triggerH3Generation(job);
    const dispatched = await updateH3Job(user.id, input.projectId, job.id, current => ({ ...current, runId: current.runId ?? handle.id }));
    return Response.json({ success: true, queued: true, orchestration: "trigger.dev", runId: handle.id, jobId: job.id, job: dispatched }, { status: 202 });
  } catch (error) { return failure(error); }
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return unauthorizedResponse();
  try {
    const query = new URL(request.url).searchParams;
    const projectId = query.get("projectId");
    if (!projectId || !/^[a-zA-Z0-9_-]{1,96}$/.test(projectId)) throw new H3RequestError("A saved project is required.");
    if (!await readStudioProject(user.id, projectId, { fresh: true })) throw new H3RequestError("Project not found.", 404);
    const jobId = query.get("jobId");
    if (!jobId) {
      const stored = await listH3Jobs(user.id, projectId);
      const jobs = [];
      for (let offset = 0; offset < stored.length; offset += 8) {
        jobs.push(...await Promise.all(stored.slice(offset, offset + 8).map(reconcileWorker)));
      }
      return Response.json({ success: true, jobs });
    }
    const job = await readH3Job(user.id, projectId, jobId);
    if (!job) throw new H3RequestError("Generation job not found.", 404);
    return Response.json({ success: true, job: await reconcileWorker(job) });
  } catch (error) { return failure(error); }
}

/** A failed worker may resume polling/persistence; it never blindly submits another video. */
export async function PATCH(request: Request) {
  const user = await getSessionUser();
  if (!user) return unauthorizedResponse();
  try {
    const body = await request.json() as { projectId?: string; jobId?: string; action?: string; requestIntentId?: string };
    if (!body.projectId || !body.jobId || !/^[a-zA-Z0-9_-]{1,96}$/.test(body.projectId)) throw new H3RequestError("A project and job are required.");
    const saved = await readStudioProject(user.id, body.projectId, { fresh: true });
    if (!saved) throw new H3RequestError("Project not found.", 404);
    const job = await readH3Job(user.id, body.projectId, body.jobId);
    if (!job) throw new H3RequestError("Generation job not found.", 404);
    if (body.action === "recheck_identity") {
      if (!body.requestIntentId || !/^[a-f0-9-]{36}$/i.test(body.requestIntentId)) throw new H3RequestError("An identity recheck intent UUID is required.");
      if (job.state !== "ready" || !job.result) throw new H3RequestError("Only a completed shot can be reassessed.", 409);
      if (job.result.asset.reviewStatus === "rejected" || (saved.draft.generatedAssets ?? []).some(asset =>
        (asset.id === job.result!.asset.id || asset.jobId === job.id) && asset.reviewStatus === "rejected")) {
        throw new H3RequestError("This shot was rejected. Create a deliberate new take instead.", 409);
      }
      const handle = await triggerH3IdentityRecheck(job, body.requestIntentId);
      return Response.json({ success: true, verificationRunId: handle.id, jobId: job.id, job }, { status: 202 });
    }
    if (body.action === "cancel") {
      const cancelled = await updateH3Job(user.id, job.projectId, job.id, current => {
        if (["ready", "failed", "cancelled"].includes(current.state)) return current;
        return { ...current, cancelRequestedAt: current.cancelRequestedAt ?? new Date().toISOString(),
          state: current.promptId ? "cancel_requested" : current.state === "submitting" || current.state === "submission_unknown" ? "cancel_requested" : "cancelled" };
      });
      return Response.json({ success: true, job: cancelled });
    }
    if (body.action !== "resume" || !body.requestIntentId || !/^[a-f0-9-]{36}$/i.test(body.requestIntentId)) throw new H3RequestError("A resume intent UUID is required.");
    if (job.state === "ready") return Response.json({ success: true, job });
    if (job.runId) {
      const run = await retrieveTriggerRun(job.runId);
      if (!run.isCompleted && !run.isFailed && !run.isCancelled) throw new H3RequestError("The current worker is still active.", 409);
    }
    if (job.state !== "submission_unknown" && job.state !== "rendering" && job.state !== "persisting" && job.state !== "cancel_requested") {
      throw new H3RequestError("Only an existing provider submission can be resumed; create an explicit revision for a rejected job.", 409);
    }
    // Clear worker ownership conditionally; provider prompt identity remains immutable.
    const resumable = await updateH3Job(user.id, job.projectId, job.id, current => {
      if (current.runId !== job.runId) throw new H3RequestError("Another resume request already owns this job.", 409);
      return { ...current, runId: undefined };
    });
    const handle = await triggerH3Generation(resumable, body.requestIntentId);
    const dispatched = await updateH3Job(user.id, job.projectId, job.id, current => ({ ...current, runId: current.runId ?? handle.id }));
    return Response.json({ success: true, runId: handle.id, jobId: job.id, job: dispatched }, { status: 202 });
  } catch (error) { return failure(error); }
}
