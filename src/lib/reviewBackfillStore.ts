import { createHash } from "node:crypto";
import type { ReviewBackfillInput, ReviewBackfillRow, ReviewBackfillStatus } from "@/components/studio/reviewBackfill";
import { studioProjectObjects, StudioProjectConflictError, type StudioJsonObjectStore } from "./studioProjectObjectStore";
import { assertReviewVideoSource, reviewVideoFolder, type ReviewVideoSource } from "./preparedReviewVideoStore";

export type ReviewBackfillJob = { version: 1; ownerId: string; projectId: string; id: string; requestSha256: string;
  status: ReviewBackfillStatus; parentRunId?: string; createdAt: string; updatedAt: string; rows: Array<ReviewBackfillRow & { pinned?: ReviewVideoSource }> };
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const runId = /^run_[\w-]{1,150}$/;
function scope(ownerId: string, projectId: string, id?: string) {
  if (!/^[\w@.:-]{1,160}$/.test(ownerId) || !/^[\w-]{1,96}$/.test(projectId) || id !== undefined && !uuid.test(id)) throw new Error("Invalid review-preparation scope.");
  return `media-uploads/studio-drafts/review-preparation/${digest(ownerId)}/${projectId}`;
}
export function reviewBackfillObjectKey(ownerId: string, projectId: string, id: string) { return `${scope(ownerId, projectId, id)}/${id}.json`; }
export function normalizeReviewBackfillInputs(ownerId: string, value: unknown): ReviewBackfillRow[] {
  if (!Array.isArray(value) || !value.length || value.length > 256) throw new Error("Choose between one and 256 stored videos.");
  const seen = new Set<string>();
  const rows: ReviewBackfillRow[] = [];
  for (const source of value as ReviewBackfillInput[]) {
    if (!source || typeof source.label !== "string" || !source.label.trim() || source.label.length > 160) throw new Error("Invalid review-preparation source label.");
    assertReviewVideoSource({ ownerId, bucket: source.bucket, objectKey: source.objectKey, etag: '"pending"', bytes: 1 });
    const id = digest([source.bucket, source.objectKey]);
    if (seen.has(id)) continue; seen.add(id);
    rows.push({ id, source: { bucket: source.bucket, objectKey: source.objectKey, label: source.label.replace(/\s+/g, " ").trim() }, state: "waiting" });
  }
  return rows;
}
function normalize(value: ReviewBackfillJob, ownerId: string, projectId: string, id: string) {
  scope(ownerId, projectId, id);
  if (!value || value.version !== 1 || value.ownerId !== ownerId || value.projectId !== projectId || value.id !== id
    || !["queued", "dispatch_unknown", "running", "ready", "partial", "failed", "cancelled"].includes(value.status)
    || value.parentRunId !== undefined && !runId.test(value.parentRunId)
    || ![value.createdAt, value.updatedAt].every(date => typeof date === "string" && date.length <= 40 && Number.isFinite(Date.parse(date)))
    || !Array.isArray(value.rows) || Buffer.byteLength(JSON.stringify(value)) > 2 * 1024 * 1024) throw new Error("Invalid review-preparation record.");
  const canonical = normalizeReviewBackfillInputs(ownerId, value.rows.map(row => row.source));
  if (canonical.length !== value.rows.length || value.requestSha256 !== digest(canonical.map(row => row.source))) throw new Error("Review-preparation sources changed.");
  value.rows.forEach((row, index) => {
    if (row.id !== canonical[index].id || !["waiting", "preparing", "ready", "failed"].includes(row.state)
      || row.childRunId !== undefined && !runId.test(row.childRunId)) throw new Error("Invalid review-preparation row.");
    if (row.pinned) {
      assertReviewVideoSource(row.pinned);
      if (row.pinned.ownerId !== ownerId || row.pinned.bucket !== row.source.bucket || row.pinned.objectKey !== row.source.objectKey) throw new Error("Review-preparation source binding changed.");
    }
    if (row.state === "ready") {
      if (!row.pinned || typeof row.posterKey !== "string") throw new Error("Ready review preparation has no receipt.");
      const prefix = `${reviewVideoFolder(row.pinned)}/`;
      if (!row.posterKey.startsWith(prefix) || !/^[a-f0-9]{64}\.webp$/.test(row.posterKey.slice(prefix.length))) throw new Error("Review poster belongs to another source.");
    } else if (row.posterKey !== undefined) throw new Error("Unfinished review preparation cannot claim a poster.");
  });
  return value;
}
export async function readReviewBackfill(ownerId: string, projectId: string, id?: string, objects: StudioJsonObjectStore = studioProjectObjects) {
  if (!id) {
    const latest = await objects.read<{ ownerId: string; projectId: string; id: string }>(`${scope(ownerId, projectId)}/latest.json`);
    if (!latest) return null;
    if (latest.value.ownerId !== ownerId || latest.value.projectId !== projectId) throw new Error("Invalid review-preparation pointer.");
    id = latest.value.id;
  }
  const record = await objects.read<ReviewBackfillJob>(reviewBackfillObjectKey(ownerId, projectId, id));
  return record ? { job: normalize(record.value, ownerId, projectId, id), revision: record.revision } : null;
}
export async function createReviewBackfill(ownerId: string, projectId: string, id: string, sources: unknown, objects: StudioJsonObjectStore = studioProjectObjects) {
  const key = reviewBackfillObjectKey(ownerId, projectId, id), rows = normalizeReviewBackfillInputs(ownerId, sources);
  const existing = await readReviewBackfill(ownerId, projectId, id, objects), requestSha256 = digest(rows.map(row => row.source));
  if (existing) {
    if (existing.job.requestSha256 !== requestSha256) throw new StudioProjectConflictError("This preparation intent already has different sources.");
    await publishLatest(existing.job, objects);
    return existing;
  }
  const now = new Date().toISOString();
  const job: ReviewBackfillJob = { version: 1, ownerId, projectId, id, requestSha256, status: "dispatch_unknown", createdAt: now, updatedAt: now, rows };
  let revision: string;
  try { revision = await objects.write(key, job, null); }
  catch (error) {
    if (!(error instanceof StudioProjectConflictError)) throw error;
    const raced = await readReviewBackfill(ownerId, projectId, id, objects);
    if (!raced || raced.job.requestSha256 !== requestSha256) throw error;
    await publishLatest(raced.job, objects);
    return raced;
  }
  await publishLatest(job, objects);
  return { job, revision };
}
async function publishLatest(job: ReviewBackfillJob, objects: StudioJsonObjectStore) {
  const { ownerId, projectId, id, createdAt } = job;
  for (let attempt = 0; attempt < 4; attempt++) {
    const pointerKey = `${scope(ownerId, projectId)}/latest.json`;
    const previous = await objects.read<{ ownerId: string; projectId: string; id: string; createdAt: string }>(pointerKey);
    if (previous && (previous.value.ownerId !== ownerId || previous.value.projectId !== projectId || !uuid.test(previous.value.id)
      || !Number.isFinite(Date.parse(previous.value.createdAt)))) throw new Error("Invalid review-preparation pointer.");
    if (previous && (previous.value.id === id || previous.value.createdAt > createdAt
      || previous.value.createdAt === createdAt && previous.value.id > id)) break;
    try { await objects.write(pointerKey, { ownerId, projectId, id, createdAt }, previous?.revision ?? null); break; }
    catch (error) { if (!(error instanceof StudioProjectConflictError) || attempt === 3) throw error; }
  }
}
export async function updateReviewBackfill(ownerId: string, projectId: string, id: string, change: (job: ReviewBackfillJob) => ReviewBackfillJob,
  objects: StudioJsonObjectStore = studioProjectObjects) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const current = await readReviewBackfill(ownerId, projectId, id, objects);
    if (!current) throw new Error("Review preparation was not found.");
    const next = normalize(change(structuredClone(current.job)), ownerId, projectId, id);
    if (next.requestSha256 !== current.job.requestSha256 || next.createdAt !== current.job.createdAt
      || current.job.parentRunId && next.parentRunId !== current.job.parentRunId
      || current.job.rows.some((row, index) => row.state === "ready" && JSON.stringify(next.rows[index]) !== JSON.stringify(row))) throw new Error("Review-preparation binding or completed receipt changed.");
    if (!["queued", "dispatch_unknown", "running"].includes(current.job.status) && next.status !== current.job.status) throw new Error("Finished review preparation cannot be restarted.");
    if (JSON.stringify(next) === JSON.stringify(current.job)) return current;
    next.updatedAt = new Date().toISOString();
    try { return { job: next, revision: await objects.write(reviewBackfillObjectKey(ownerId, projectId, id), next, current.revision) }; }
    catch (error) { if (!(error instanceof StudioProjectConflictError) || attempt === 3) throw error; }
  }
  throw new Error("Review-preparation update did not settle.");
}
export function reviewBackfillSnapshot(record: NonNullable<Awaited<ReturnType<typeof readReviewBackfill>>>) {
  const { job, revision } = record;
  return { projectId: job.projectId, id: job.id, status: job.status, parentRunId: job.parentRunId, updatedAt: job.updatedAt, revision,
    rows: job.rows.map(row => ({ id: row.id, source: row.source, state: row.state, childRunId: row.childRunId, posterKey: row.posterKey })) };
}
