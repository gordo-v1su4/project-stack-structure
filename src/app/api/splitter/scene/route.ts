export const runtime = "nodejs";

const SPLITTER_API_BASE_URL = "https://splitter.serving.cloud";
const POLL_INTERVAL_MS = 2500;
const TIMEOUT_MS = 120_000;

type SplitterJobStatus = "queued" | "processing" | "completed" | "failed";

interface SplitterJobState {
  job_id: string;
  status: SplitterJobStatus;
  stage: string;
  error?: string | null;
}

interface SplitterJobCreatedResponse {
  job?: SplitterJobState;
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return Response.json({ error: "Video file is required." }, { status: 400 });
    }

    const upstreamForm = new FormData();
    upstreamForm.set("file", file, file.name);

    const created = await readJsonResponse(await fetch(`${SPLITTER_API_BASE_URL}/api/jobs`, {
      method: "POST",
      body: upstreamForm,
    })) as SplitterJobCreatedResponse;

    const jobId = created.job?.job_id;
    if (!jobId || !created.job) {
      return Response.json({ error: "Splitter did not return a job id." }, { status: 502 });
    }

    const startedAt = Date.now();
    let state: SplitterJobState = created.job;

    while (state.status !== "completed") {
      if (state.status === "failed") {
        return Response.json({ error: state.error ?? `Splitter failed during ${state.stage}.`, job: state }, { status: 502 });
      }

      if (Date.now() - startedAt > TIMEOUT_MS) {
        return Response.json({ error: "Splitter scene detection timed out.", job: state }, { status: 504 });
      }

      await sleep(POLL_INTERVAL_MS);
      state = await readJsonResponse(await fetch(`${SPLITTER_API_BASE_URL}/api/jobs/${encodeURIComponent(jobId)}`)) as SplitterJobState;
    }

    const result = await readJsonResponse(await fetch(`${SPLITTER_API_BASE_URL}/api/jobs/${encodeURIComponent(jobId)}/result`));
    return Response.json({ ...(isRecord(result) ? result : { result }), job: state, splitterBaseUrl: SPLITTER_API_BASE_URL });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Splitter proxy error";
    return Response.json({ error: message }, { status: 500 });
  }
}

async function readJsonResponse(response: Response) {
  const text = await response.text();
  if (!response.ok) throw new Error(text.trim() || `${response.status} ${response.statusText}`);
  return text.trim() ? JSON.parse(text) as unknown : null;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
