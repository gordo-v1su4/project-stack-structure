import { describe, expect, test } from "bun:test";
import { normalizeTriggerRunStatus } from "@/lib/triggerRunStatus";
import { createRunLookupHandler } from "@/app/api/orchestration/runs/[runId]/runLookupRoute";
import type { retrieveTriggerRun } from "@/lib/triggerOrchestration";

describe("Trigger terminal status compatibility", () => {
  test("the production TIMED_OUT response is terminal even when the older SDK flags are false", async () => {
    const raw = { id: "run-timeout", status: "TIMED_OUT", isCompleted: false, isFailed: false,
      isCancelled: false, isSuccess: false, isExecuting: true, isWaiting: true, isQueued: true,
      error: { message: "trigger.dev internal error (MAX_DURATION_EXCEEDED)" },
      finishedAt: new Date("2026-11-10T21:23:09.040Z") };
    const normalized = normalizeTriggerRunStatus(raw);
    expect(normalized).toMatchObject({ status: "TIMED_OUT", isCompleted: true, isFailed: true,
      isCancelled: false, isSuccess: false, isExecuting: false, isWaiting: false, isQueued: false });
    expect(normalized.error).toBe(raw.error);
    expect(normalized.finishedAt).toBe(raw.finishedAt);
    expect(raw.isCompleted).toBe(false);
    const handler = createRunLookupHandler({ session: async () => ({ id: "owner" }),
      retrieve: async () => normalized as unknown as Awaited<ReturnType<typeof retrieveTriggerRun>> });
    const response = await handler(new Request("https://app.test/api/orchestration/runs/run-timeout"),
      { params: Promise.resolve({ runId: raw.id }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "TIMED_OUT", isFailed: true,
      isCompleted: true, error: raw.error.message });
  });

  test("known terminal outcomes agree with their status and preserve the result", () => {
    for (const status of ["FAILED", "CRASHED", "SYSTEM_FAILURE", "EXPIRED", "INTERRUPTED", "TIMED_OUT", "CANCELED", "COMPLETED"]) {
      const output = { asset: "durable" };
      const run = normalizeTriggerRunStatus({ status, output });
      expect(run).toMatchObject({ isCompleted: true, isFailed: !["CANCELED", "COMPLETED"].includes(status),
        isCancelled: status === "CANCELED", isSuccess: status === "COMPLETED" });
      expect(run.output).toBe(output);
    }
  });

  test("waiting, executing and unrecognized states are never ended because of age or timestamps", () => {
    for (const status of ["QUEUED", "EXECUTING", "WAITING", "DELAYED", "PENDING_VERSION", "NEW_UNKNOWN_STATUS"]) {
      const run = { status, isCompleted: false, isFailed: false, finishedAt: new Date(0) };
      expect(normalizeTriggerRunStatus(run)).toBe(run);
    }
  });
});
