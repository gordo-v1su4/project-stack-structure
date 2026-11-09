import { getSessionUser } from "@/lib/session";
import { readStudioProject } from "@/lib/studioProjectStore";
import { prepareH3StillJob, H3StillAdmissionError } from "@/lib/h3StillServer";
import { finishH3StillPreparation, readH3StillJob, readH3StillJobByIntent, requestH3StillCancellation, H3StillIntentRejectedError } from "@/lib/h3StillJobStore";
import { triggerH3Still, triggerH3StillReconciliation, retrieveTriggerRun } from "@/lib/triggerOrchestration";
import { H3RequestError } from "@/lib/h3GenerationServer";
import { SourceConfirmationError } from "@/lib/generationScopeServer";

type Dependencies = { session: typeof getSessionUser; project: typeof readStudioProject; prepare: typeof prepareH3StillJob;
  read: typeof readH3StillJob; cancel: typeof requestH3StillCancellation; trigger: typeof triggerH3Still;
  run: typeof retrieveTriggerRun; reconcile: typeof triggerH3StillReconciliation; intent: typeof readH3StillJobByIntent; finishPreparation: typeof finishH3StillPreparation };
const defaults: Dependencies = { session: getSessionUser, project: readStudioProject, prepare: prepareH3StillJob,
  read: readH3StillJob, cancel: requestH3StillCancellation, trigger: triggerH3Still,
  run: retrieveTriggerRun, reconcile: triggerH3StillReconciliation, intent: readH3StillJobByIntent, finishPreparation: finishH3StillPreparation };
const reply = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

async function readBody(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json" || !request.body) throw new H3RequestError("Use a JSON still request.");
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new H3RequestError("Still request timed out.", 408)), 10_000); });
  try {
    for (;;) {
      const next = await Promise.race([reader.read(), timeout]); if (next.done) break;
      size += next.value.byteLength;
      if (size > 32 * 1024) throw new H3RequestError("Still request is too large.", 413);
      chunks.push(next.value);
    }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
    catch { throw new H3RequestError("Invalid still request JSON."); }
  } finally { clearTimeout(timer); void reader.cancel().catch(() => {}); }
}

export function createH3StillHandlers(dependencies: Dependencies = defaults) {
  async function handle(request: Request, operation: "create" | "read" | "cancel" | "reconcile") {
    const user = await dependencies.session();
    if (!user) return reply({ error: "Sign in before generating or reviewing stills." }, 401);
    try {
      if (operation === "create") {
        const job = await dependencies.prepare(user.id, await readBody(request));
        // Replays reuse the same durable still and Trigger idempotency key.
        if (job.runId || ["ready", "failed", "cancelled", "cancel_requested"].includes(job.state)) {
          return reply({ success: true, job, runId: job.runId, screenStatus: "pending-worker-preflight" });
        }
        const run = await dependencies.trigger(job);
        return reply({ success: true, job, runId: run.id, screenStatus: "pending-worker-preflight" }, 202);
      }
      if (operation === "reconcile") {
        const body = await readBody(request) as Record<string, unknown> | null;
        if (!body || typeof body !== "object" || Array.isArray(body)
          || Object.keys(body).some(key => !["projectId", "jobId", "requestIntentId"].includes(key))
          || typeof body.projectId !== "string" || !/^[a-zA-Z0-9_-]{1,96}$/.test(body.projectId)
          || typeof body.jobId !== "string" || !/^h3-still-[a-f0-9]{64}$/.test(body.jobId)
          || typeof body.requestIntentId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(body.requestIntentId)) throw new H3RequestError("Choose an owned still and an explicit check intent.");
        if (!await dependencies.project(user.id, body.projectId, { fresh: true })) throw new H3RequestError("Project not found.", 404);
        const job = await dependencies.read(user.id, body.projectId, body.jobId);
        const beforeSubmission = job && ["queued", "preparing", "cancel_requested"].includes(job.state)
          && job.workflowSha256 === undefined && job.providerSchemaSha256 === undefined && job.submissionClaimId === undefined
          && job.promptId === undefined && job.result === undefined && !job.workerRecoveries?.length;
        if (!job?.runId || !beforeSubmission && (!job.workflowSha256 || !["submitting", "submission_unknown", "rendering", "persisting", "cancel_requested"].includes(job.state))) throw new H3RequestError("Choose an existing unresolved still attempt.", 409);
        const previous = await dependencies.run(job.runId);
        if (!previous.tags.includes(`user:${user.id}`) || !previous.tags.includes(`h3-still:${job.id}`)
          || !(previous.isCompleted || previous.isCancelled || previous.isFailed)) throw new H3RequestError("The previous still worker must finish before checking it with another run.", 409);
        if (beforeSubmission) {
          let finished;
          try { finished = await dependencies.finishPreparation(user.id, body.projectId, job.id, job.runId); }
          catch { throw new H3RequestError("The still worker or submission boundary changed. Reload before checking this attempt.", 409); }
          return reply({ success: true, job: finished, runId: finished.runId, screenStatus: "pending-worker-preflight" });
        }
        const run = await dependencies.reconcile(job, job.runId, body.requestIntentId);
        return reply({ success: true, job, runId: run.id }, 202);
      }
      const params = new URL(request.url).searchParams;
      const projectId = params.get("projectId"), jobId = params.get("jobId");
      if (operation === "read" && !jobId && params.has("requestIntentId")) {
        const intent = params.get("requestIntentId"), attempt = params.get("attempt");
        if ([...params.keys()].some(key => !["projectId", "requestIntentId", "attempt"].includes(key))
          || !projectId || !/^[a-zA-Z0-9_-]{1,96}$/.test(projectId)
          || !intent || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(intent)
          || !attempt || !/^[012]$/.test(attempt)) throw new H3RequestError("Choose an owned still intent and attempt.");
        if (!await dependencies.project(user.id, projectId, { fresh: true })) throw new H3RequestError("Project not found.", 404);
        const job = await dependencies.intent(user.id, projectId, intent, Number(attempt));
        if (!job) throw new H3RequestError("This still intent has no stored job yet. No replacement was submitted.", 404);
        return reply({ success: true, job, screenStatus: "pending-worker-preflight" });
      }
      if ([...params.keys()].some(key => !["projectId", "jobId"].includes(key))
        || !projectId || !/^[a-zA-Z0-9_-]{1,96}$/.test(projectId)
        || !jobId || !/^h3-still-[a-f0-9]{64}$/.test(jobId)) throw new H3RequestError("Choose a saved project and still job.");
      if (!await dependencies.project(user.id, projectId, { fresh: true })) throw new H3RequestError("Project not found.", 404);
      const job = operation === "cancel" ? await dependencies.cancel(user.id, projectId, jobId)
        : await dependencies.read(user.id, projectId, jobId);
      if (!job) throw new H3RequestError("Still job not found.", 404);
      return reply({ success: true, job, screenStatus: "pending-worker-preflight" });
    } catch (error) {
      const known = error instanceof H3RequestError || error instanceof SourceConfirmationError;
      const rejected = error instanceof H3StillAdmissionError || error instanceof H3StillIntentRejectedError;
      return reply({ error: known ? error.message : "MiniMax still preparation is unavailable. No replacement generation was submitted.",
        ...((operation === "create" || operation === "read") && rejected ? { admission: "rejected-before-job" } : {}) }, known ? error.status : rejected ? 409 : 503);
    }
  }
  return { POST: (request: Request) => handle(request, "create"), GET: (request: Request) => handle(request, "read"),
    DELETE: (request: Request) => handle(request, "cancel"), PATCH: (request: Request) => handle(request, "reconcile") };
}
