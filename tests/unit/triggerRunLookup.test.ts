import { describe, expect, test } from "bun:test";
import { createRunLookupHandler } from "@/app/api/orchestration/runs/[runId]/runLookupRoute";
import { retrieveOwnedTriggerRun, TriggerRunOwnershipError } from "@/lib/triggerRunAccess";
import type { retrieveTriggerRun } from "@/lib/triggerOrchestration";

type Run = Awaited<ReturnType<typeof retrieveTriggerRun>>;
const owner = "github-run-owner";
const request = new Request("https://app.example/api/orchestration/runs/run_owned");
const context = { params: Promise.resolve({ runId: "run_owned" }) };
function runFixture(tags = [`user:${owner}`]): Run {
  return {
    id: "run_owned", taskIdentifier: "ffmpeg-final-music-video-export", status: "COMPLETED",
    isQueued: false, isExecuting: false, isWaiting: false, isCompleted: true,
    isSuccess: true, isFailed: false, isCancelled: false, tags,
    output: { requestKey: "owned-key", privateResult: "owner-only-output" },
    error: undefined, createdAt: new Date("2026-11-09T12:00:00Z"),
    startedAt: new Date("2026-11-09T12:00:01Z"), finishedAt: new Date("2026-11-09T12:00:06Z"),
  } as Run;
}

describe("Trigger run lookup access boundary", () => {
  test("anonymous lookup returns401 before reading params or retrieving a run", async () => {
    let reads = 0, retrieves = 0;
    const handler = createRunLookupHandler({
      session: async () => null,
      retrieve: async () => { retrieves++; throw new Error("provider must not run"); },
    });
    const response = await handler(request, {
      get params(): Promise<{ runId: string }> { reads++; throw new Error("params must not be read"); },
    });
    expect(response.status).toBe(401);
    expect(reads).toBe(0);
    expect(retrieves).toBe(0);
    expect(await response.json()).toEqual({ error: "Sign in with GitHub to view Trigger runs." });
  });

  test("foreign and missing exact owner tags return403 without run or output data", async () => {
    for (const tags of [["user:someone-else"], [], [`user:${owner}-suffix`]]) {
      let retrieves = 0;
      const handler = createRunLookupHandler({
        session: async () => ({ id: owner }),
        retrieve: (id) => retrieveOwnedTriggerRun(id, owner, async (providerId) => {
          retrieves++;
          expect(providerId).toBe("run_owned");
          return runFixture(tags);
        }),
      });
      const response = await handler(request, context);
      expect(response.status).toBe(403);
      expect(retrieves).toBe(1);
      const body = await response.json();
      expect(body).toEqual({ error: new TriggerRunOwnershipError().message });
      expect("output" in body).toBe(false);
      expect("id" in body).toBe(false);
      expect(JSON.stringify(body)).not.toContain("owner-only-output");
    }
  });

  test("owned lookup preserves terminal flags, result and timestamps without exposing tags", async () => {
    const run = runFixture();
    const handler = createRunLookupHandler({
      session: async () => ({ id: owner }),
      retrieve: (id) => retrieveOwnedTriggerRun(id, owner, async () => run),
    });
    const response = await handler(request, context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: run.id, taskIdentifier: run.taskIdentifier, status: run.status,
      isQueued: false, isExecuting: false, isWaiting: false, isCompleted: true,
      isSuccess: true, isFailed: false, isCancelled: false, output: run.output,
      createdAt: "2026-11-09T12:00:00.000Z", startedAt: "2026-11-09T12:00:01.000Z",
      finishedAt: "2026-11-09T12:00:06.000Z",
    });
  });

  test("provider errors with ownership-like text or403 metadata remain unexpected failures", async () => {
    for (const error of [new Error(new TriggerRunOwnershipError().message),
      Object.assign(new Error("Provider authorization failed"), { status: 403 })]) {
      const handler = createRunLookupHandler({
        session: async () => ({ id: owner }),
        retrieve: (id) => retrieveOwnedTriggerRun(id, owner, async () => { throw error; }),
      });
      const response = await handler(request, context);
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: error.message });
    }
  });

  test("existing provider not-found and configuration responses remain404 and503", async () => {
    for (const [message, status] of [["Run not found", 404], ["Trigger.dev is not configured.", 503]] as const) {
      const handler = createRunLookupHandler({ session: async () => ({ id: owner }),
        retrieve: async () => { throw new Error(message); } });
      const response = await handler(request, context);
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: message });
    }
  });

  test("owned retrieval returns the same provider object and never translates provider errors", async () => {
    const run = runFixture();
    expect(await retrieveOwnedTriggerRun("run_owned", owner, async () => run)).toBe(run);
    const failure = new Error("Provider transport failed");
    await expect(retrieveOwnedTriggerRun("run_owned", owner, async () => { throw failure; })).rejects.toBe(failure);
    await expect(retrieveOwnedTriggerRun("run_owned", owner, async () => runFixture(["user:other"])))
      .rejects.toBeInstanceOf(TriggerRunOwnershipError);
  });
});
