import { retrieveTriggerRun } from "@/lib/triggerOrchestration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ runId: string }> };

export async function GET(_request: Request, context: Params) {
  try {
    const { runId } = await context.params;
    const run = await retrieveTriggerRun(runId);

    return Response.json({
      id: run.id,
      taskIdentifier: run.taskIdentifier,
      status: run.status,
      isQueued: run.isQueued,
      isExecuting: run.isExecuting,
      isWaiting: run.isWaiting,
      isCompleted: run.isCompleted,
      isSuccess: run.isSuccess,
      isFailed: run.isFailed,
      isCancelled: run.isCancelled,
      output: run.output,
      error: run.error?.message,
      createdAt: run.createdAt,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Trigger run lookup failed";
    const status = /not found|404/i.test(message) ? 404 : /not configured/i.test(message) ? 503 : 500;
    return Response.json({ error: message }, { status });
  }
}
