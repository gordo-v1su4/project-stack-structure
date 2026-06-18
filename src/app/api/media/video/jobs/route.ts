import { createMediaGatewayVideoJob } from "@/lib/mediaGateway";

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

    const job = await createMediaGatewayVideoJob({
      bucket: payload.bucket,
      objectKey,
      mode: payload.mode,
      profile: payload.profile,
      metadata: payload.metadata,
    });
    return Response.json({ job });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Video job creation failed";
    const status = /Missing RustFS media gateway env/i.test(message) ? 503 : 500;
    return Response.json({ error: message }, { status });
  }
}
