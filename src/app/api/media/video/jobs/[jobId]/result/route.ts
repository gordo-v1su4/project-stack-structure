import { downloadJsonFromMediaGateway } from "@/lib/mediaGateway";
import { getSessionUser, unauthorizedResponse } from "@/lib/session";
import { retrieveTriggerRun } from "@/lib/triggerOrchestration";

export const runtime = "nodejs";

type Params = { params: Promise<{ jobId: string }> };

export async function GET(_request: Request, context: Params) {
  const user = await getSessionUser();
  if (!user) return unauthorizedResponse("Sign in with GitHub to fetch video job results.");
  try {
    const { jobId } = await context.params;
    const run = await retrieveTriggerRun(jobId);
    if (run.taskIdentifier !== "media-video-pipeline") {
      return Response.json({ error: `Run ${jobId} is not a media video pipeline job.` }, { status: 409 });
    }
    if (!run.isCompleted) {
      return Response.json({ error: `Run ${jobId} is still ${run.status.toLowerCase()}.` }, { status: 409 });
    }
    if (!run.isSuccess) {
      return Response.json({ error: run.error?.message || `Run ${jobId} failed.` }, { status: 500 });
    }

    const output = run.output as {
      manifestStorage?: { bucket?: string; objectKey?: string };
      sourceStorage?: { bucket?: string; objectKey?: string };
    } | undefined;
    const bucket = output?.manifestStorage?.bucket;
    const objectKey = output?.manifestStorage?.objectKey;
    if (!bucket || !objectKey) {
      return Response.json({ error: `Run ${jobId} completed without a final manifest pointer.` }, { status: 500 });
    }
    const manifest = await downloadJsonFromMediaGateway({ bucket, objectKey });
    // Chunked uploads are reassembled by the worker; surface the assembled single-file ref so the
    // client can stop pointing at chunk part 0 and preview/export can use durable gateway refs.
    const sourceBucket = output?.sourceStorage?.bucket;
    const sourceObjectKey = output?.sourceStorage?.objectKey;
    return Response.json(
      sourceBucket && sourceObjectKey
        ? { ...manifest, sourceStorage: { bucket: sourceBucket, objectKey: sourceObjectKey } }
        : manifest,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Video job result failed";
    const status = /not configured/i.test(message) ? 503 : /409/.test(message) ? 409 : /404|not found/i.test(message) ? 404 : 500;
    return Response.json({ error: message }, { status });
  }
}
