import type { getSessionUser } from "@/lib/session";
import type { retrieveTriggerRun } from "@/lib/triggerOrchestration";
import { TriggerRunOwnershipError } from "@/lib/triggerRunAccess";

type Params = { params: Promise<{ runId: string }> };
type Dependencies = {
  session: typeof getSessionUser;
  retrieve: typeof retrieveTriggerRun;
};

export function createRunLookupHandler(dependencies: Dependencies) {
  return async function GET(_request: Request, context: Params) {
    try {
      if (!await dependencies.session()) {
        return Response.json({ error: "Sign in with GitHub to view Trigger runs." }, { status: 401 });
      }
      const { runId } = await context.params;
      const run = await dependencies.retrieve(runId);
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
      if (error instanceof TriggerRunOwnershipError) {
        return Response.json({ error: error.message }, { status: 403 });
      }
      const message = error instanceof Error ? error.message : "Trigger run lookup failed";
      const status = /not found|404/i.test(message) ? 404 : /not configured/i.test(message) ? 503 : 500;
      return Response.json({ error: message }, { status });
    }
  };
}
