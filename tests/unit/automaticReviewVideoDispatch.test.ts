import { expect, mock, test } from "bun:test";
const dispatch = mock(async () => ({ id: "run_worker_context" }));
mock.module("@trigger.dev/sdk", () => ({ tasks: { trigger: dispatch } }));
const { queueReviewVideoAfterIngest } = await import("@/lib/automaticReviewVideo");
test("automatic preparation uses the configured worker SDK without requiring web-only env names", async () => {
  const secretBefore = process.env.TRIGGER_SECRET_KEY, urlBefore = process.env.TRIGGER_API_URL;
  delete process.env.TRIGGER_SECRET_KEY; delete process.env.TRIGGER_API_URL;
  try {
    const input = { ownerId: "github-fixture", bucket: "fixture", objectKey: "media-uploads/projects/github-fixture/clips/source.mp4", versionHint: "source-version" };
    expect(await queueReviewVideoAfterIngest(input)).toEqual({ status: "submitted", runId: "run_worker_context" });
    const call = dispatch.mock.calls[0] as unknown as [string, unknown, { tags: string[] }, { retry: { maxAttempts: number } }];
    expect(call[0]).toBe("prepare-review-video");
    expect(call[1]).toEqual({ applicationUserId: input.ownerId, input: { bucket: input.bucket, objectKey: input.objectKey } });
    expect(call[2].tags.filter(tag => tag.startsWith("user:"))).toEqual(["user:github-fixture"]);
    expect(call[3].retry.maxAttempts).toBe(1);
  } finally {
    if (secretBefore === undefined) delete process.env.TRIGGER_SECRET_KEY; else process.env.TRIGGER_SECRET_KEY = secretBefore;
    if (urlBefore === undefined) delete process.env.TRIGGER_API_URL; else process.env.TRIGGER_API_URL = urlBefore;
  }
});
