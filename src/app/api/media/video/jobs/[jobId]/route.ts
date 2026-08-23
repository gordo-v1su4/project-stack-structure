import { getSessionUser, unauthorizedResponse } from "@/lib/session";
import { retrieveTriggerRun } from "@/lib/triggerOrchestration";

export const runtime = "nodejs";

type Params = { params: Promise<{ jobId: string }> };

export async function GET(_request: Request, context: Params) {
  const user = await getSessionUser();
  if (!user) return unauthorizedResponse("Sign in with GitHub to check video job status.");
  try {
    const { jobId } = await context.params;
    const run = await retrieveTriggerRun(jobId);
    if (run.taskIdentifier !== "media-video-pipeline") {
      return Response.json({ error: `Run ${jobId} is not a media video pipeline job.` }, { status: 409 });
    }
    if (run.isSuccess) {
      const output = run.output as { job?: Record<string, unknown> } | undefined;
      return Response.json(output?.job ?? {
        job_id: run.id,
        status: "completed",
        stage: "trigger-completed",
      });
    }

    return Response.json({
      job_id: run.id,
      status: run.isFailed || run.isCancelled ? "failed" : run.isExecuting ? "processing" : "queued",
      stage: `trigger-${run.status.toLowerCase()}`,
      error: run.error?.message ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Video job status failed";
    const status = /not configured/i.test(message) ? 503 : /404|not found/i.test(message) ? 404 : 500;
    return Response.json({ error: message }, { status });
  }
}
