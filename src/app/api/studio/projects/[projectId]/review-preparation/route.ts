import { getSessionUser, unauthorizedResponse } from "@/lib/session";
import { readStudioProject } from "@/lib/studioProjectStore";
import { studioMediaStorage, StudioProjectConflictError } from "@/lib/studioProjectObjectStore";
import { mediaUploadBelongsToOwner } from "@/lib/essentiaUpload";
import { reviewPreparationSources } from "@/components/studio/reviewPreparationSources";
import { createReviewBackfill, normalizeReviewBackfillInputs, readReviewBackfill, reviewBackfillSnapshot, updateReviewBackfill } from "@/lib/reviewBackfillStore";
import { retrieveTriggerRun, triggerReviewBackfill } from "@/lib/triggerOrchestration";
import { reviewBackfillActive } from "@/components/studio/reviewBackfill";

export const runtime = "nodejs";
type Context = { params: Promise<{ projectId: string }> };
const headers = { "cache-control": "private, no-store" };
async function body(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new Error("JSON is required.");
  const reader = request.body?.getReader(); if (!reader) throw new Error("Missing body.");
  const chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength;
    if (size > 1024 * 1024) { await reader.cancel(); throw new Error("Body too large."); } chunks.push(part.value); } }
  finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export async function GET(request: Request, context: Context) {
  const user = await getSessionUser(); if (!user) return unauthorizedResponse();
  const { projectId } = await context.params;
  try {
    let record = await readReviewBackfill(user.id, projectId, new URL(request.url).searchParams.get("jobId") ?? undefined);
    if (!record) return Response.json({ projectId, preparation: null }, { headers });
    if (record.job.parentRunId && reviewBackfillActive(record.job.status)) {
      const run = await retrieveTriggerRun(record.job.parentRunId);
      if (run.taskIdentifier !== "prepare-project-review-videos") throw new Error("Unexpected preparation task.");
      if (run.isFailed || run.isCancelled || run.isCompleted) record = await updateReviewBackfill(user.id, projectId, record.job.id, job => !reviewBackfillActive(job.status) ? job : ({ ...job,
        status: job.rows.every(row => row.state === "ready") ? "ready" : run.isCancelled ? "cancelled" : "failed",
        rows: job.rows.map(row => row.state === "preparing" ? { ...row, state: "failed" as const } : row) }));
    }
    if (request.headers.get("if-none-match") === record.revision) return new Response(null, { status: 304, headers: { ...headers, etag: record.revision } });
    return Response.json({ projectId, preparation: reviewBackfillSnapshot(record) }, { headers: { ...headers, etag: record.revision } });
  } catch { return Response.json({ error: "Review-preparation updates are unavailable. Your cut is unchanged." }, { status: 503, headers }); }
}
export async function POST(request: Request, context: Context) {
  const user = await getSessionUser(); if (!user) return unauthorizedResponse();
  const { projectId } = await context.params;
  let input: { intentId: string; sources: unknown };
  try {
    input = await body(request);
    if (!input || typeof input.intentId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.intentId)
      || !/^[\w-]{1,96}$/.test(projectId)) throw new Error("Invalid input.");
    normalizeReviewBackfillInputs(user.id, input.sources);
  } catch { return Response.json({ error: "Choose a bounded list of stored videos and a preparation intent." }, { status: 400, headers }); }
  try {
    const saved = await readStudioProject(user.id, projectId, { fresh: true });
    if (!saved) return Response.json({ error: "Project not found." }, { status: 404, headers });
    const rows = normalizeReviewBackfillInputs(user.id, input.sources), bucket = studioMediaStorage().bucket;
    if (rows.some(row => row.source.bucket !== bucket)) return Response.json({ error: "Invalid media bucket." }, { status: 400, headers });
    const legacy = new Set(reviewPreparationSources(saved.draft.videoSources ?? [], saved.draft.generatedAssets ?? [])
      .filter(source => source.bucket === bucket).map(source => source.objectKey));
    if (rows.some(row => !mediaUploadBelongsToOwner(row.source.objectKey, user.id) && !legacy.has(row.source.objectKey))) {
      return Response.json({ error: "A video does not belong to the current user." }, { status: 403, headers });
    }
    let record = await createReviewBackfill(user.id, projectId, input.intentId, rows.map(row => row.source));
    if (!reviewBackfillActive(record.job.status)) return Response.json({ projectId, preparation: reviewBackfillSnapshot(record) }, { headers });
    const run = await triggerReviewBackfill(user.id, projectId, record.job.id);
    record = await updateReviewBackfill(user.id, projectId, record.job.id, job => !reviewBackfillActive(job.status) ? job : ({ ...job, parentRunId: run.id, status: job.status === "running" ? "running" : "queued" }));
    return Response.json({ projectId, preparation: reviewBackfillSnapshot(record) }, { status: 202, headers });
  } catch (error) {
    return Response.json({ error: error instanceof StudioProjectConflictError ? error.message : "Preparation dispatch is not confirmed. Reconnect the same request; your cut is unchanged." },
      { status: error instanceof StudioProjectConflictError ? 409 : 503, headers });
  }
}
