import { validateOrderedChunkManifest } from "@/lib/chunkedMediaUpload";
import { getMediaGatewayConfig, normalizeMediaPath } from "@/lib/mediaGateway";
import { getSessionUser, unauthorizedResponse } from "@/lib/session";
import { triggerMediaSceneDetection } from "@/lib/triggerOrchestration";

export const runtime = "nodejs";

const VIDEO_CHUNK_FOLDER_BASE = "media-uploads/video-source";

function chunkManifestPrefix(uploadPrefix: string) {
  return normalizeMediaPath(`${normalizeMediaPath(uploadPrefix)}/video-source`);
}

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
      uploadChunks?: { size?: unknown; chunks?: unknown };
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

    let uploadChunks: { size: number; chunks: Array<{ bucket: string; objectKey: string }> } | undefined;
    if (payload.uploadChunks) {
      const size = typeof payload.uploadChunks.size === "number"
        && Number.isSafeInteger(payload.uploadChunks.size)
        && payload.uploadChunks.size > 0
        ? payload.uploadChunks.size
        : 0;
      const chunks = size && config
        ? validateOrderedChunkManifest({
          value: payload.uploadChunks.chunks,
          size,
          bucket: config.bucket,
          expectedPrefix: chunkManifestPrefix(config.uploadPrefix),
        })
        : null;
      if (!chunks) {
        return Response.json({ error: "Invalid chunked-upload manifest." }, { status: 400 });
      }
      uploadChunks = { size, chunks };
    }

    const handle = await triggerMediaSceneDetection({
      bucket,
      objectKey,
      mode: payload.mode,
      profile: payload.profile,
      metadata: payload.metadata,
      uploadChunks,
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
