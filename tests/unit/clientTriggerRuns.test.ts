import { describe, expect, test } from "bun:test";

import { waitForTriggerRunOutput } from "@/lib/clientTriggerRuns";

const originalFetch = globalThis.fetch;

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

describe("client Trigger run polling", () => {
  test("returns successful output", async () => {
    try {
      globalThis.fetch = (async () => Response.json({
        id: "run-success",
        status: "COMPLETED",
        isCompleted: true,
        isSuccess: true,
        isFailed: false,
        isCancelled: false,
        output: { value: 42 },
      })) as typeof fetch;

      const output = await waitForTriggerRunOutput("run-success", { timeoutMs: 100, pollIntervalMs: 0 });
      expect(output).toEqual({ value: 42 });
    } finally {
      restoreFetch();
    }
  });

  test("fails immediately when Trigger marks a run failed", async () => {
    try {
      globalThis.fetch = (async () => Response.json({
        id: "run-failed",
        status: "FAILED",
        isCompleted: false,
        isSuccess: false,
        isFailed: true,
        isCancelled: false,
        error: "provider failed",
      })) as typeof fetch;

      let error: unknown;
      try {
        await waitForTriggerRunOutput("run-failed", { timeoutMs: 100, pollIntervalMs: 0 });
      } catch (caught) {
        error = caught;
      }
      expect(error instanceof Error ? error.message : "").toContain("provider failed");
    } finally {
      restoreFetch();
    }
  });

  test("fails immediately when Trigger marks a run cancelled", async () => {
    try {
      globalThis.fetch = (async () => Response.json({
        id: "run-cancelled",
        status: "CANCELED",
        isCompleted: false,
        isSuccess: false,
        isFailed: false,
        isCancelled: true,
        error: "cancelled by operator",
      })) as typeof fetch;

      let error: unknown;
      try {
        await waitForTriggerRunOutput("run-cancelled", { timeoutMs: 100, pollIntervalMs: 0 });
      } catch (caught) {
        error = caught;
      }
      expect(error instanceof Error ? error.message : "").toContain("cancelled by operator");
    } finally {
      restoreFetch();
    }
  });
});
