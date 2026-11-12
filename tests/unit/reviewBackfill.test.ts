import { expect, test } from "bun:test";
import { createReviewBackfill, readReviewBackfill, reviewBackfillObjectKey, reviewBackfillSnapshot, updateReviewBackfill } from "@/lib/reviewBackfillStore";
import { runReviewBackfill } from "@/lib/runReviewBackfill";
import { StudioProjectConflictError, type StudioJsonObjectStore } from "@/lib/studioProjectObjectStore";
import { reviewVideoFolder, type PreparedReviewVideo, type ReviewVideoSource } from "@/lib/preparedReviewVideoStore";
import { isCanonicalStudioMetadata } from "@/lib/studioMetadataPrivacy";

const ownerId = "github-owner", projectId = "project", jobId = "00000000-0000-4000-8000-000000000001";
const sources = ["one", "two", "three"].map(label => ({ bucket: "stack-structure", objectKey: `media-uploads/projects/${ownerId}/${label}.mp4`, label }));
function fixture() {
  const rows = new Map<string, { value: unknown; revision: string }>(); let writes = 0;
  const objects: StudioJsonObjectStore = {
    async read<T>(key: string) { return structuredClone(rows.get(key) ?? null) as { value: T; revision: string } | null; },
    async write(key, value, revision) {
      if ((rows.get(key)?.revision ?? null) !== revision) throw new StudioProjectConflictError();
      const next = String(++writes); rows.set(key, { value: structuredClone(value), revision: next }); return next;
    },
  };
  return { rows, objects, writes: () => writes };
}
const pinned = (objectKey: string): ReviewVideoSource => ({ ownerId, bucket: "stack-structure", objectKey, etag: '"version"', bytes: 100 });
// The runner consumes only the source binding and durable poster receipt.
const receipt = (source: ReviewVideoSource) => ({ source, artifacts: { poster: `${reviewVideoFolder(source)}/${"a".repeat(64)}.webp` } }) as PreparedReviewVideo;

test("preparation intents deduplicate sources, isolate owners and repair a missing latest pointer", async () => {
  const f = fixture();
  const first = await createReviewBackfill(ownerId, projectId, jobId, [...sources, sources[0]], f.objects);
  expect(first.job.rows).toHaveLength(3);
  expect(isCanonicalStudioMetadata("stack-structure", reviewBackfillObjectKey(ownerId, projectId, jobId))).toBe(true);
  expect(await readReviewBackfill("other", projectId, jobId, f.objects)).toBeNull();
  for (const key of f.rows.keys()) if (key.endsWith("latest.json")) f.rows.delete(key);
  expect((await createReviewBackfill(ownerId, projectId, jobId, sources, f.objects)).job).toEqual(first.job);
  expect((await readReviewBackfill(ownerId, projectId, undefined, f.objects))?.job.id).toBe(jobId);
  await expect(createReviewBackfill(ownerId, projectId, jobId, [sources[0]], f.objects)).rejects.toBeInstanceOf(StudioProjectConflictError);
  expect([...f.rows.keys()].every(key => key.startsWith("media-uploads/studio-drafts/review-preparation/"))).toBe(true);
});

test("completed receipts and parent ownership cannot be overwritten by late updates", async () => {
  const f = fixture(); await createReviewBackfill(ownerId, projectId, jobId, sources, f.objects);
  const source = pinned(sources[0].objectKey);
  await updateReviewBackfill(ownerId, projectId, jobId, job => ({ ...job, parentRunId: "run_parent", status: "running", rows: job.rows.map((row, index) => index ? row : { ...row, pinned: source, state: "ready", posterKey: receipt(source).artifacts.poster }) }), f.objects);
  const writes = f.writes();
  await updateReviewBackfill(ownerId, projectId, jobId, job => job, f.objects);
  expect(f.writes()).toBe(writes);
  await expect(updateReviewBackfill(ownerId, projectId, jobId, job => ({ ...job, parentRunId: "run_other" }), f.objects)).rejects.toThrow();
  await expect(updateReviewBackfill(ownerId, projectId, jobId, job => ({ ...job, rows: job.rows.map(row => ({ ...row, state: "waiting", posterKey: undefined })) }), f.objects)).rejects.toThrow();
  const record = await readReviewBackfill(ownerId, projectId, jobId, f.objects);
  expect(JSON.stringify(reviewBackfillSnapshot(record!))).not.toContain('"pinned"');
  await updateReviewBackfill(ownerId, projectId, jobId, job => ({ ...job, status: "partial" }), f.objects);
  await expect(updateReviewBackfill(ownerId, projectId, jobId, job => ({ ...job, status: "running" }), f.objects)).rejects.toThrow();
});

test("runner reuses receipts, executes sequentially, requires stored output and retains successes", async () => {
  const f = fixture(); await createReviewBackfill(ownerId, projectId, jobId, sources, f.objects);
  const ready = new Set([sources[0].objectKey]); const executed: string[] = []; let active = 0, peak = 0;
  const result = await runReviewBackfill({ ownerId, projectId, jobId }, "run_parent", {
    objects: f.objects, authorize: async () => true,
    pin: async (_owner, _bucket, key) => pinned(key),
    ready: async source => ready.has(source.objectKey) ? receipt(source) : null,
    execute: async source => {
      active++; peak = Math.max(peak, active); executed.push(source.objectKey);
      await Promise.resolve(); if (source.objectKey === sources[1].objectKey) ready.add(source.objectKey);
      active--; return { id: `run_child${executed.length}`, ok: true };
    },
  });
  expect(peak).toBe(1); expect(executed).toEqual(sources.slice(1).map(source => source.objectKey));
  expect(result.rows.map(row => row.state)).toEqual(["ready", "ready", "failed"]);
  expect(result.status).toBe("partial");
  // Re-delivery of a terminal parent never submits any child again.
  await runReviewBackfill({ ownerId, projectId, jobId }, "run_parent", { objects: f.objects, execute: async () => { throw new Error("duplicate submission"); } });
  expect([...f.rows.keys()].every(key => key.includes("/review-preparation/"))).toBe(true);
});

test("runner rechecks authorization before pinning or dispatching each source", async () => {
  const f = fixture(); await createReviewBackfill(ownerId, projectId, jobId, [sources[0]], f.objects);
  const result = await runReviewBackfill({ ownerId, projectId, jobId }, "run_parent", {
    objects: f.objects, authorize: async () => false,
    pin: async () => { throw new Error("must not access source"); },
    execute: async () => { throw new Error("must not dispatch"); },
  });
  expect(result.status).toBe("partial"); expect(result.rows[0].childRunId).toBe(undefined);
});
