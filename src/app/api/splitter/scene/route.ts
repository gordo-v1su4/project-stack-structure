import { createMediaGatewayVideoJob, getMediaGatewayVideoJob, getMediaGatewayVideoJobResult, uploadFileToMediaGateway } from "@/lib/mediaGateway";

export const runtime = "nodejs";

const POLL_INTERVAL_MS = 2500;
const TIMEOUT_MS = 120_000;

type VideoJobStatus = "queued" | "processing" | "completed" | "failed";

interface VideoJobState {
  job_id: string;
  status: VideoJobStatus;
  stage?: string;
  error?: string | null;
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return Response.json({ error: "Video file is required." }, { status: 400 });
    }

    const upload = await uploadFileToMediaGateway({ file });
    const created = await createMediaGatewayVideoJob({
      bucket: upload.bucket,
      objectKey: upload.objectKey,
      mode: "scene-detect",
      profile: "pyscenedetect-adaptive",
      metadata: {
        source: "stack-structure-splitter-route",
        originalFilename: file.name,
      },
    }) as VideoJobState;

    const jobId = created.job_id;
    if (!jobId) {
      return Response.json({ error: "Media gateway did not return a video job id." }, { status: 502 });
    }

    const startedAt = Date.now();
    let state: VideoJobState = created;

    while (state.status !== "completed") {
      if (state.status === "failed") {
        return Response.json({ error: state.error ?? `Media video worker failed during ${state.stage ?? "processing"}.`, job: state, upload }, { status: 502 });
      }

      if (Date.now() - startedAt > TIMEOUT_MS) {
        return Response.json({ error: "Media video scene detection timed out.", job: state, upload }, { status: 504 });
      }

      await sleep(POLL_INTERVAL_MS);
      state = await getMediaGatewayVideoJob({ jobId }) as VideoJobState;
    }

    const result = await getMediaGatewayVideoJobResult({ jobId });
    const resultRecord = isRecord(result) ? result : { result };
    const manifest = isRecord(resultRecord.manifest) ? resultRecord.manifest : resultRecord;
    return Response.json({ ...resultRecord, ...manifest, manifest, job: state, upload, mediaGateway: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown media video proxy error";
    const status = /Missing RustFS media gateway env/i.test(message) ? 503 : /Content-Type/i.test(message) ? 400 : 500;
    return Response.json({ error: message }, { status });
  }
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
