import { afterEach, expect, mock, test } from "bun:test";
let definition: { run: (payload: unknown) => Promise<unknown> };
let owned = true, pins = 0, preparations = 0;
let authorization: unknown;
const source = { ownerId: "github-fixture", bucket: "fixture", objectKey: "media-uploads/projects/github-fixture/clips/source.mp4", etag: '"actual"', bytes: 100 };
class AbortTaskRunError extends Error {}
mock.module("@trigger.dev/sdk", () => ({ AbortTaskRunError, queue: (value: unknown) => value, task: (value: typeof definition) => { definition = value; return value; } }));
mock.module("@/lib/studioMediaAccess", () => ({ canReadMediaObject: async (value: unknown) => { authorization = value; return owned; } }));
mock.module("@/lib/preparedReviewVideoStore", () => ({ pinReviewVideoSource: async (owner: string) => { pins++; return { ...source, ownerId: owner }; } }));
mock.module("@/lib/prepareStoredReviewVideo", () => ({ prepareStoredReviewVideo: async (value: unknown) => { preparations++; return value; } }));
mock.module("@/trigger/workMetadata", () => ({ markWorkRunning: () => {}, markWorkCompleted: () => {} }));
await import("@/trigger/reviewVideo");
afterEach(() => { owned = true; pins = 0; preparations = 0; authorization = null; });
test("automatic ingest checks ownership before pinning and ignores a forged input user field", async () => {
  const payload = { applicationUserId: source.ownerId, input: { bucket: source.bucket, objectKey: source.objectKey, userId: "victim" } };
  owned = false; await expect(definition.run(payload)).rejects.toThrow("does not belong"); expect(pins).toBe(0); expect(preparations).toBe(0);
  expect(authorization).toEqual({ userId: source.ownerId, bucket: source.bucket, objectKey: source.objectKey });
  owned = true; expect(await definition.run(payload)).toEqual(source); expect(pins).toBe(1); expect(preparations).toBe(1);
});
test("a pinned interactive request retains its binding and mismatched owners are rejected", async () => {
  await expect(definition.run({ applicationUserId: "other", source })).rejects.toThrow("owner");
  expect(preparations).toBe(0); expect(pins).toBe(0);
  expect(await definition.run({ applicationUserId: source.ownerId, source })).toEqual(source);
  expect(preparations).toBe(1); expect(pins).toBe(0);
});
