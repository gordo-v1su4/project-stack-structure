import { triggerMediaSceneDetection } from "@/lib/triggerOrchestration";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = await request.json() as {
      bucket?: string;
      objectKey?: string;
      storagePath?: string;
      mode?: string;
      profile?: string;
      metadata?: Record<string, unknown>;
    };
    const objectKey = payload.objectKey ?? payload.storagePath;
    if (!payload.bucket || !objectKey) {
      return Response.json({ error: "bucket and objectKey are required" }, { status: 400 });
    }

    const handle = await triggerMediaSceneDetection({
      bucket: payload.bucket,
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
        bucket: payload.bucket,
        objectKey,
      },
    }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Video job creation failed";
    const status = /not configured/i.test(message) ? 503 : 500;
    return Response.json({ error: message }, { status });
  }
}
