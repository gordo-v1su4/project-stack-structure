import { expect, test } from "bun:test";
import { createH3StillHandlers } from "@/app/api/generate/h3/stills/stillRoute";
import { H3RequestError } from "@/lib/h3GenerationServer";
import type { H3StillJob } from "@/lib/h3StillJobStore";

type Dependencies = NonNullable<Parameters<typeof createH3StillHandlers>[0]>;
function setup(state: H3StillJob["state"] = "queued") {
  const calls: string[] = [];
  const job = { id: `h3-still-${"a".repeat(64)}`, projectId: "project", ownerId: "owner", state } as H3StillJob;
  const dependencies: Dependencies = {
    session: async () => ({ id: "owner" }),
    project: async () => { calls.push("project"); return {} as never; },
    prepare: async owner => { expect(owner).toBe("owner"); calls.push("prepare"); return job; },
    read: async (owner, project, id) => { expect([owner, project, id]).toEqual(["owner", "project", job.id]); calls.push("read"); return job; },
    cancel: async (owner, project, id) => { expect([owner, project, id]).toEqual(["owner", "project", job.id]); calls.push("cancel"); return { ...job, state: "cancel_requested" }; },
    trigger: async input => { expect(input).toBe(job); calls.push("trigger"); return { id: "run-owned" }; },
    run: async () => ({ tags: ["user:owner", `h3-still:${job.id}`], isCompleted: true }) as never,
    reconcile: async () => { calls.push("reconcile"); return { id: "run-reconcile" }; },
    intent: async (owner, project, intent, attempt) => {
      expect([owner, project, intent, attempt]).toEqual(["owner", "project", "a0c4aba6-2c57-4cc8-a510-2cb7f9bf5fae", 0]);
      calls.push("intent"); return job;
    },
  };
  const request = (body: unknown = {}) => new Request("http://localhost/api/generate/h3/stills", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return { calls, job, dependencies, request, url: `http://localhost/api/generate/h3/stills?projectId=project&jobId=${job.id}` };
}

test("all still operations authenticate before reading input, storage or dispatch", async () => {
  const f = setup(), handlers = createH3StillHandlers({ ...f.dependencies, session: async () => null });
  for (const method of ["POST", "GET", "DELETE", "PATCH"] as const) {
    expect((await handlers[method](f.request())).status).toBe(401);
  }
  expect(f.calls).toEqual([]);
});
test("explicit still reconciliation requires the owned prior run to be terminal, without a new creative submission", async () => {
  const f = setup("submission_unknown"); f.job.runId = "run-old"; f.job.workflowSha256 = "b".repeat(64);
  const body = { projectId: "project", jobId: f.job.id, requestIntentId: "a0c4aba6-2c57-4cc8-a510-2cb7f9bf5fae" };
  f.dependencies.run = async () => ({ tags: ["user:owner", `h3-still:${f.job.id}`], isCompleted: false }) as never;
  expect((await createH3StillHandlers(f.dependencies).PATCH(f.request(body))).status).toBe(409);
  expect(f.calls).not.toContain("reconcile");
  f.dependencies.run = async () => ({ tags: ["user:owner", `h3-still:${f.job.id}`], isCompleted: true }) as never;
  expect((await createH3StillHandlers(f.dependencies).PATCH(f.request(body))).status).toBe(202);
  expect(f.calls).toContain("reconcile"); expect(f.calls).not.toContain("trigger"); expect(f.calls).not.toContain("prepare");
  f.calls.length = 0;
  f.dependencies.run = async () => ({ tags: ["user:owner", `h3-still:${f.job.id}`], isCompleted: false, isCancelled: true }) as never;
  expect((await createH3StillHandlers(f.dependencies).PATCH(f.request(body))).status).toBe(202);
  expect(f.calls).toContain("reconcile"); expect(f.calls).not.toContain("trigger");
});
test("bounded JSON admission precedes preparation and Trigger dispatch", async () => {
  const f = setup(), handlers = createH3StillHandlers(f.dependencies);
  expect((await handlers.POST(f.request({ prompt: "x".repeat(33 * 1024) }))).status).toBe(413);
  expect((await handlers.POST(new Request(f.url, { method: "POST", body: "{" }))).status).toBe(400);
  expect(f.calls).toEqual([]);
});
test("lost creation ACK recovers by owned intent after project edits without revalidation or another dispatch", async () => {
  const f = setup("rendering"); f.job.runId = "run-original";
  f.dependencies.prepare = async () => { throw new H3RequestError("The saved plan changed.", 409); };
  const url = `http://localhost/api/generate/h3/stills?projectId=project&requestIntentId=a0c4aba6-2c57-4cc8-a510-2cb7f9bf5fae&attempt=0`;
  const response = await createH3StillHandlers(f.dependencies).GET(new Request(url));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ job: { id: f.job.id, runId: "run-original" } });
  expect(f.calls).toEqual(["project", "intent"]);
});
test("owned canonical job is dispatched once per request and returned without identity approval", async () => {
  const f = setup(), response = await createH3StillHandlers(f.dependencies).POST(f.request());
  expect(response.status).toBe(202);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toMatchObject({ runId: "run-owned", screenStatus: "pending-worker-preflight", job: { state: "queued" } });
  expect(f.calls).toEqual(["prepare", "trigger"]);
});
test("terminal replay and a worker-owned job never dispatch a replacement run", async () => {
  for (const state of ["ready", "failed", "cancelled", "cancel_requested", "rendering"] as const) {
    const f = setup(state); if (state === "rendering") f.job.runId = "run-original";
    expect((await createH3StillHandlers(f.dependencies).POST(f.request())).status).toBe(200);
    expect(f.calls).toEqual(["prepare"]);
  }
});
test("read stays read-only and cancellation never calls Trigger or the provider", async () => {
  const f = setup(), handlers = createH3StillHandlers(f.dependencies);
  expect((await handlers.GET(new Request(f.url))).status).toBe(200);
  expect(f.calls).toEqual(["project", "read"]); f.calls.length = 0;
  expect((await handlers.DELETE(new Request(f.url, { method: "DELETE" }))).status).toBe(200);
  expect(f.calls).toEqual(["project", "cancel"]);
  f.calls.length = 0;
  expect((await handlers.GET(new Request(`${f.url}&workflow=bad`))).status).toBe(400);
  expect(f.calls).toEqual([]);
});
test("canonical rejection does not dispatch and infrastructure errors are redacted", async () => {
  const f = setup();
  f.dependencies.prepare = async () => { throw new H3RequestError("Saved story changed.", 409); };
  const first = await createH3StillHandlers(f.dependencies).POST(f.request());
  expect(first.status).toBe(409); expect(await first.json()).toEqual({ error: "Saved story changed." });
  f.dependencies.prepare = async () => { throw new Error("private infrastructure details"); };
  const second = await createH3StillHandlers(f.dependencies).POST(f.request());
  expect(second.status).toBe(503); expect(JSON.stringify(await second.json())).not.toContain("private");
  expect(f.calls).toEqual([]);
});
