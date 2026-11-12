import { assertReviewVideoSource } from "./preparedReviewVideoStore";
import { createTriggerIdempotencyKey } from "./triggerIdempotency";
import { REVIEW_VIDEO_RECIPE } from "@/components/studio/reviewVideo";
import type { reviewVideoTask } from "@/trigger/reviewVideo";

type Input = { ownerId: string; bucket: string; objectKey: string; versionHint: string; projectId?: string };
type Payload = { applicationUserId: string; input: { bucket: string; objectKey: string } };
type DispatchOptions = { tags: string[]; idempotencyKey: string; idempotencyKeyTTL: "30d"; metadata: Record<string, string> };
type Options = { configured?: boolean; deadlineMs?: number; dispatch?: (payload: Payload, options: DispatchOptions) => Promise<{ id: string }> };

/** Ancillary CPU work. An unconfirmed dispatch never downgrades a completed source job. */
export async function queueReviewVideoAfterIngest(input: Input, options: Options = {}): Promise<{ status: "submitted"; runId: string } | { status: "unavailable" | "unconfirmed" }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    assertReviewVideoSource({ ownerId: input.ownerId, bucket: input.bucket, objectKey: input.objectKey, etag: '"deferred"', bytes: 1 });
    if (!input.versionHint || input.versionHint.length > 256 || /[\r\n]/.test(input.versionHint)
      || input.projectId !== undefined && !/^[\w-]{1,96}$/.test(input.projectId)) return { status: "unavailable" };
    // Child dispatch uses the SDK's worker context; web-only env names are not a readiness test.
    if (options.configured === false) return { status: "unavailable" };
    const dispatch = options.dispatch ?? (async (payload, dispatchOptions) => {
      const { tasks } = await import("@trigger.dev/sdk");
      return tasks.trigger<typeof reviewVideoTask>("prepare-review-video", payload, dispatchOptions, { retry: { maxAttempts: 1 } });
    });
    const result = await Promise.race([
      dispatch({ applicationUserId: input.ownerId, input: { bucket: input.bucket, objectKey: input.objectKey } }, {
        tags: [`user:${input.ownerId}`, "stack-structure", "review-preparation", ...(input.projectId ? [`project:${input.projectId}`] : [])],
        idempotencyKey: createTriggerIdempotencyKey("review-video-ingest-v1", [input.ownerId, input.bucket, input.objectKey, input.versionHint, REVIEW_VIDEO_RECIPE]),
        idempotencyKeyTTL: "30d", metadata: { stage: "queued", providerStatus: "queued", progressMode: "indeterminate", stageLabel: "Waiting to prepare review media" },
      }),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), options.deadlineMs ?? 8000); }),
    ]);
    if (!result) return { status: "unconfirmed" }; // The same idempotent request may still be accepted.
    if (!/^run_[\w-]{1,150}$/.test(result.id)) return { status: "unavailable" };
    return { status: "submitted", runId: result.id };
  } catch {
    return { status: "unavailable" };
  } finally { if (timer) clearTimeout(timer); }
}
