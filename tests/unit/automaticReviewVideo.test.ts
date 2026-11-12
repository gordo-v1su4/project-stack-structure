import { expect, test } from "bun:test";
import { queueReviewVideoAfterIngest } from "@/lib/automaticReviewVideo";
const input = { ownerId: "github-fixture", bucket: "fixture", objectKey: "media-uploads/projects/github-fixture/generated/shot.mp4", projectId: "project-one", versionHint: "source-version-one" };
test("ingest review dispatch is CPU-only, owner-scoped and stable for one source version", async () => {
  const calls: Array<{ payload: unknown; options: { tags: string[]; idempotencyKey: string } }> = [];
  const dispatch = async (payload: unknown, options: { tags: string[]; idempotencyKey: string }) => { calls.push({ payload, options }); return { id: "run_auto" }; };
  expect(await queueReviewVideoAfterIngest(input, { configured: true, dispatch })).toEqual({ status: "submitted", runId: "run_auto" });
  await queueReviewVideoAfterIngest(input, { configured: true, dispatch });
  expect(calls[0].payload).toEqual({ applicationUserId: input.ownerId, input: { bucket: input.bucket, objectKey: input.objectKey } });
  expect(calls[0].options.tags.filter(tag => tag.startsWith("user:"))).toEqual(["user:github-fixture"]);
  expect(calls[0].options.tags).toContain("project:project-one");
  expect(calls[0].options.idempotencyKey).toBe(calls[1].options.idempotencyKey);
  await queueReviewVideoAfterIngest({ ...input, versionHint: "new-version" }, { configured: true, dispatch });
  expect(calls[2].options.idempotencyKey).not.toBe(calls[0].options.idempotencyKey);
});
test("missing configuration or invalid inputs never dispatch; rejected dispatch stays ancillary", async () => {
  let count = 0;
  const dispatch = async () => { count++; throw new Error("PRIVATE_PROVIDER_DIAGNOSTIC"); };
  expect(await queueReviewVideoAfterIngest(input, { configured: false, dispatch })).toEqual({ status: "unavailable" });
  expect(await queueReviewVideoAfterIngest({ ...input, objectKey: "media-uploads/../source.mp4" }, { configured: true, dispatch })).toEqual({ status: "unavailable" });
  expect(await queueReviewVideoAfterIngest({ ...input, versionHint: "" }, { configured: true, dispatch })).toEqual({ status: "unavailable" });
  expect(count).toBe(0);
  expect(await queueReviewVideoAfterIngest(input, { configured: true, dispatch })).toEqual({ status: "unavailable" }); expect(count).toBe(1);
});
test("observation deadline is unconfirmed, not a failed source or a reason to dispatch twice", async () => {
  let finish!: (value: { id: string }) => void, count = 0;
  const dispatch = () => { count++; return new Promise<{ id: string }>(resolve => { finish = resolve; }); };
  expect(await queueReviewVideoAfterIngest(input, { configured: true, dispatch, deadlineMs: 1 })).toEqual({ status: "unconfirmed" });
  expect(count).toBe(1); finish({ id: "run_late" }); await Promise.resolve(); expect(count).toBe(1);
});
