import { describe, expect, test } from "bun:test";

import { isRetryableTriggerTransportError, nextTriggerPollInterval, triggerPollSleepDuration, waitForTriggerRunOutput } from "@/lib/clientTriggerRuns";

const originalFetch = globalThis.fetch;

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

describe("client Trigger run polling", () => {
  test("progressively backs off polling to a 15 second ceiling", () => {
    expect(nextTriggerPollInterval(1_500)).toBe(2_250);
    expect(nextTriggerPollInterval(10_000)).toBe(15_000);
    expect(nextTriggerPollInterval(15_000)).toBe(15_000);
  });

  test("caps each polling sleep at the remaining timeout", () => {
    expect(triggerPollSleepDuration(15_000, 14_990, 15_000)).toBe(10);
    expect(triggerPollSleepDuration(1_500, 20_000, 15_000)).toBe(0);
  });

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

  test("retries a transient status request timeout until the run succeeds", async () => {
    try {
      let requests = 0;
      globalThis.fetch = (async () => {
        requests += 1;
        if (requests === 1) throw new DOMException("signal timed out", "TimeoutError");
        return Response.json({
          id: "run-after-timeout",
          status: "COMPLETED",
          isCompleted: true,
          isSuccess: true,
          isFailed: false,
          isCancelled: false,
          output: { value: 42 },
        });
      }) as typeof fetch;

      const output = await waitForTriggerRunOutput("run-after-timeout", { timeoutMs: 100, pollIntervalMs: 0 });
      expect(requests).toBe(2);
      expect(output).toEqual({ value: 42 });
    } finally {
      restoreFetch();
    }
  });

  test("retries only recognized browser transport failures", () => {
    expect(isRetryableTriggerTransportError(new DOMException("timed out", "TimeoutError"))).toBe(true);
    expect(isRetryableTriggerTransportError(new DOMException("aborted", "AbortError"))).toBe(true);
    expect(isRetryableTriggerTransportError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isRetryableTriggerTransportError(new Error("application bug"))).toBe(false);
  });

  test("does not hide non-transport polling exceptions", async () => {
    try {
      globalThis.fetch = (async () => {
        throw new Error("application bug");
      }) as typeof fetch;

      let error: unknown;
      try {
        await waitForTriggerRunOutput("run-bug", { timeoutMs: 100, pollIntervalMs: 0 });
      } catch (caught) {
        error = caught;
      }
      expect(error instanceof Error ? error.message : "").toContain("application bug");
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
