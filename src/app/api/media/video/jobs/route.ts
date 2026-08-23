import { getMediaGatewayConfig, normalizeMediaPath } from "@/lib/mediaGateway";
import { getSessionUser, unauthorizedResponse } from "@/lib/session";
import { triggerMediaSceneDetection } from "@/lib/triggerOrchestration";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return unauthorizedResponse("Sign in with GitHub to enqueue video jobs.");
  try {
    const payload = await request.json() as {
      bucket?: string;
      objectKey?: string;
      storagePath?: string;
      mode?: string;
      profile?: string;
      metadata?: Record<string, unknown>;
    };
    const objectKey = normalizeMediaPath(payload.objectKey ?? payload.storagePath ?? "");
    const bucket = payload.bucket?.trim() ?? "";
    if (!bucket || !objectKey) {
      return Response.json({ error: "bucket and objectKey are required" }, { status: 400 });
    }
    const config = getMediaGatewayConfig();
    if (config && bucket !== config.bucket) {
      return Response.json({ error: `bucket must be ${config.bucket}` }, { status: 400 });
    }

    const handle = await triggerMediaSceneDetection({
      bucket,
      objectKey,
      mode: payload.mode,
      profile: payload.profile,
      metadata: payload.metadata,
    });
    return Response.json({
      orchestration: "trigger.dev",
      job: {
        job_id: handle.id,
        status: "queued",
        stage: "trigger-queued",
        bucket,
        objectKey,
      },
    }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Video job creation failed";
    const status = /not configured/i.test(message) ? 503 : /sign in with github/i.test(message) ? 401 : 500;
    return Response.json({ error: message }, { status });
  }
}
