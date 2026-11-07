import { getSessionUser, unauthorizedResponse } from "@/lib/session";
import { readStudioProject } from "@/lib/studioProjectStore";
import { getMediaGatewayConfig } from "@/lib/mediaGateway";
import { H3RequestError, h3GenerationJobId, materializeH3Job, parseH3Request } from "@/lib/h3GenerationServer";
import { H3_LEGACY_PROFILE, H3_V2_PROFILE, H3_V2_CONDITIONING_PREPARATION_VERSION, type H3GenerationProfileOptions } from "@/components/studio/h3Generation";
import { claimH3GenerationIntent, createH3Job, listH3Jobs, pinH3JobReferences, readH3Job, updateH3Job } from "@/lib/h3JobStore";
import { compileH3Prompt } from "@/lib/h3Workflow";
import { retrieveTriggerRun, triggerH3Generation, triggerH3IdentityRecheck } from "@/lib/triggerOrchestration";
import { assertH3IdentityAssessmentScope, buildH3IdentityAssessmentScope, identityAssessmentAsset, isH3IdentityAssessmentId } from "@/components/studio/h3IdentityAssessment";
import { claimH3IdentityAssessment, readH3IdentityAssessment } from "@/lib/h3IdentityAssessmentStore";
import { H3_FIRST_FRAME_PROFILE, H3_FIRST_FRAME_PREPARATION } from "@/components/studio/h3FirstFrame";
import { readH3FirstFrame, assertH3FirstFrameMatchesJob } from "@/lib/h3FirstFrameStore";
import { studioJsonResponse } from "@/lib/studioJsonTransportServer";

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
        : "The worker ended before submitting a video. Resume its worker to keep this shot's saved inputs." };
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
    const firstFrame = input.conditioning ? await readH3FirstFrame(user.id,input.projectId,input.conditioning.artifactId) : undefined;
    if (input.conditioning && (!firstFrame || firstFrame.body.pngSha256 !== input.conditioning.expectedSha256)) throw new H3RequestError("The owned first-frame artifact does not match this request.",409);
    let proposed = await pinH3JobReferences(materializeH3Job(user.id, project, input, config.bucket,
      firstFrame ? {profile:H3_FIRST_FRAME_PROFILE,conditioningPreparationVersion:H3_FIRST_FRAME_PREPARATION,firstFrame} : undefined));
    if (firstFrame) assertH3FirstFrameMatchesJob(firstFrame,proposed);
    // A release may change the default profile between durable creation and
    // dispatch. Only an exact existing request may retain its historical profile.
    const historicalProfiles: H3GenerationProfileOptions[] = [
      { profile: H3_LEGACY_PROFILE },
      { profile: H3_V2_PROFILE, conditioningPreparationVersion: H3_V2_CONDITIONING_PREPARATION_VERSION },
    ];
    for (const options of input.conditioning ? [] : historicalProfiles) {
      const legacyId = h3GenerationJobId(user.id, input, proposed.references, options);
      const legacy = await readH3Job(user.id, input.projectId, legacyId);
      if (!legacy) continue;
      if (legacy.id !== legacyId || legacy.ownerId !== user.id || legacy.projectId !== input.projectId
        || legacy.profile !== options.profile || legacy.conditioningPreparationVersion !== options.conditioningPreparationVersion
        || JSON.stringify(legacy.request) !== JSON.stringify(input)
        || JSON.stringify(legacy.references) !== JSON.stringify(proposed.references)) {
        throw new H3RequestError("The saved generation intent no longer matches this shot.", 409);
      }
      proposed = await pinH3JobReferences(materializeH3Job(user.id, project, input, config.bucket, {
        profile: legacy.profile, conditioningPreparationVersion: legacy.conditioningPreparationVersion,
      }));
      if (proposed.id !== legacy.id) throw new H3RequestError("The saved generation references changed.", 409);
      break;
    }
    // Compile before enqueue so invalid language or reference roles create no GPU work.
    try { compileH3Prompt(proposed); } catch (error) { throw new H3RequestError((error as Error).message, 422); }
    await claimH3GenerationIntent(proposed);
    const job = await createH3Job(proposed);
    if (job.runId || job.state === "ready" || job.workerRecoveries?.some(recovery => !recovery.runId)) {
      return Response.json({ success: true, runId: job.runId, jobId: job.id, job }, { status: 202 });
    }
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
      return studioJsonResponse(request, { success: true, jobs });
    }
    const job = await readH3Job(user.id, projectId, jobId);
    if (!job) throw new H3RequestError("Generation job not found.", 404);
    const assessmentId = query.get("assessmentId");
    if (assessmentId) {
      if (!isH3IdentityAssessmentId(assessmentId)) throw new H3RequestError("A valid range assessment is required.");
      const assessment = await readH3IdentityAssessment(user.id,projectId,jobId,assessmentId);
      if (assessment) {
        assertH3IdentityAssessmentScope(assessment.scope,job);
        if (assessment.status === "ready") identityAssessmentAsset(assessment,job);
      }
      return studioJsonResponse(request, { success: true, jobId, assessment });
    }
    return studioJsonResponse(request, { success: true, job: await reconcileWorker(job) });
  } catch (error) { return failure(error); }
}

/** A failed worker may resume polling/persistence; it never blindly submits another video. */
export async function PATCH(request: Request) {
  const user = await getSessionUser();
  if (!user) return unauthorizedResponse();
  try {
    const body = await request.json() as { projectId?: string; jobId?: string; action?: string; requestIntentId?: string; trimStart?: number };
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
      // Legacy queued worker payloads remain supported, but new public checks
      // must append an explicit range assessment instead of replacing a report.
      if (typeof body.trimStart !== "number" || !Number.isFinite(body.trimStart)) {
        throw new H3RequestError("Refresh the app and choose a source handle before checking similarity.",409);
      }
      let assessment;
      try { assessment = buildH3IdentityAssessmentScope(job,body.trimStart,body.requestIntentId); }
      catch { throw new H3RequestError("The selected trim has no unchanged canonical media, policy and frame binding.",409); }
      try { await claimH3IdentityAssessment(assessment); }
      catch { throw new H3RequestError("The assessment intent is unavailable or already bound to a different range. Refresh before retrying.",409); }
      const handle = await triggerH3IdentityRecheck(job, body.requestIntentId, assessment);
      return Response.json({ success: true, verificationRunId: handle.id, jobId: job.id, assessmentId: assessment.id, job }, { status: 202 });
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
    const intent = body.requestIntentId;
    const acknowledged = job.workerRecoveries?.find(recovery => recovery.requestIntentId === intent && recovery.runId);
    // A replay of a historical receipt must never clear or replace a newer worker.
    if (acknowledged) return Response.json({ success: true, runId: acknowledged.runId, jobId: job.id, job }, { status: 202 });
    const pending = job.workerRecoveries?.find(recovery => !recovery.runId);
    if (pending && pending.requestIntentId !== intent) throw new H3RequestError("A worker recovery is awaiting its receipt. Resume that same saved intent.", 409);
    if (job.state === "cancelled") throw new H3RequestError("This shot was cancelled.", 409);
    let resumable = job;
    if (!pending) {
      if (job.state === "ready") return Response.json({ success: true, job });
      if (job.runId) {
        const run = await retrieveTriggerRun(job.runId);
        if (!run.isCompleted && !run.isFailed && !run.isCancelled) throw new H3RequestError("The current worker is still active.", 409);
      }
      const beforeSubmission = job.state === "failed" && Boolean(job.runId) && !job.promptId && !job.compiledPrompt && !job.result && !job.cancelRequestedAt;
      const providerStates = ["submission_unknown", "rendering", "persisting", "cancel_requested"];
      if (!beforeSubmission && !providerStates.includes(job.state)) {
        throw new H3RequestError("Resume an existing render or a terminal worker that ended before submission; revise rejected shots explicitly.", 409);
      }
      // Claim the recovery UUID with the owner transition before attempting dispatch.
      // On an uncertain ACK a reload can replay this exact key, never the initial key.
      resumable = await updateH3Job(user.id, job.projectId, job.id, current => {
        const claimed = current.workerRecoveries?.find(recovery => recovery.requestIntentId === intent);
        if (claimed) return current;
        if (current.workerRecoveries?.some(recovery => !recovery.runId) || current.runId !== job.runId) {
          throw new H3RequestError("Another resume request already owns this job.", 409);
        }
        if (beforeSubmission ? current.state !== "failed" || Boolean(current.promptId || current.compiledPrompt || current.result || current.cancelRequestedAt)
          : !providerStates.includes(current.state)) {
          throw new H3RequestError("The shot's submission state changed. Refresh before resuming.", 409);
        }
        return { ...current, runId: undefined, ...(beforeSubmission ? { state: "queued" as const, error: undefined } : {}),
          workerRecoveries: [...(current.workerRecoveries ?? []), { requestIntentId: intent, previousRunId: job.runId, createdAt: new Date().toISOString() }] };
      });
    }
    const receipt = resumable.workerRecoveries?.find(recovery => recovery.requestIntentId === intent);
    if (!receipt) throw new H3RequestError("The saved worker recovery is unavailable.", 409);
    if (receipt.runId) return Response.json({ success: true, runId: receipt.runId, jobId: job.id, job: resumable }, { status: 202 });
    // Never outlive the existing Trigger idempotency-key TTL and accidentally enqueue anew.
    if (!Number.isFinite(Date.parse(receipt.createdAt)) || Date.now() - Date.parse(receipt.createdAt) >= 30 * 86_400_000) {
      throw new H3RequestError("The uncertain worker receipt expired. No replacement worker was dispatched.", 409);
    }
    const handle = await triggerH3Generation(resumable, intent);
    const dispatched = await updateH3Job(user.id, job.projectId, job.id, current => {
      const claim = current.workerRecoveries?.find(recovery => recovery.requestIntentId === intent);
      if (!claim || (claim.runId && claim.runId !== handle.id) || (current.runId && current.runId !== handle.id)) {
        throw new H3RequestError("Worker ownership changed before its receipt arrived. Refresh before resuming.", 409);
      }
      return { ...current, runId: current.runId ?? handle.id,
        workerRecoveries: current.workerRecoveries!.map(recovery => recovery.requestIntentId === intent ? { ...recovery, runId: handle.id } : recovery) };
    });
    return Response.json({ success: true, runId: handle.id, jobId: job.id, job: dispatched }, { status: 202 });
  } catch (error) { return failure(error); }
}
