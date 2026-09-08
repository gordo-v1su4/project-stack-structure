import { afterEach, expect, mock, test } from "bun:test";

const spans: string[] = [];
const logs: unknown[] = [];
const stages: string[] = [];
mock.module("@trigger.dev/sdk", () => ({
  AbortTaskRunError: class AbortTaskRunError extends Error {},
  task: (definition: unknown) => definition,
  queue: (definition: unknown) => definition,
  wait: { for: async () => {} },
  metadata: { set(key: string, value: string) { if (key === "stage") stages.push(value); return this; } },
  logger: {
    trace: async (name: string, fn: () => Promise<unknown>) => { spans.push(name); return fn(); },
    info: (...args: unknown[]) => logs.push(args),
    warn: (...args: unknown[]) => logs.push(args),
  },
}));
const { runStoryTreatmentGateway } = await import("../../src/trigger/storyTreatment");
const { STORY_LOGLINE_REVIEW_REQUIRED } = await import("../../src/lib/storyLoglineReview");
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; spans.length = 0; logs.length = 0; stages.length = 0; });
const payload = { operation: "revise" as const, instructions: "private instructions", input: "private story", model: "qwen-test", reviewContext: { brief: "private brief", constraints: [] } };
const output = { treatment: { id: "faithful", logline: "private pitch" } };
const approval = { version: 1, status: "passed" };
function transport(responses: Response[]) {
  const calls: { url: string; body?: Record<string, unknown> }[] = [];
  globalThis.fetch = (async (url, options) => {
    calls.push({ url: String(url), body: options?.body ? JSON.parse(String(options.body)) : undefined });
    const next = responses.shift();
    if (!next) throw new Error("Unexpected extra model request");
    return next;
  }) as typeof fetch;
  return calls;
}
const healthy = () => Response.json({ qwenBackendHealthy: true });
const authored = () => Response.json({ ok: true, output, model: "qwen-test" });

test("authoring and independent review are ordered trace stages on the exact same output", async () => {
  const calls = transport([healthy(), authored(), Response.json({ ok: true, logline_review: approval })]);
  const result = await runStoryTreatmentGateway(payload, "run-test");
  expect(calls.map(call => new URL(call.url).pathname)).toEqual(["/health", "/story/treatments/author", "/story/treatments/review"]);
  expect(calls[2].body).toEqual({ operation: "revise", output, review_context: payload.reviewContext });
  expect(result.output).toEqual(output);
  expect(result.loglineReview).toEqual(approval);
  expect(spans).toEqual(["Prepare GPU story model", "Author story on GPU", "Review story logline on GPU"]);
  expect(stages).toEqual(["generating", "reviewing"]);
  expect(JSON.stringify(logs)).not.toContain("private");
});

test("negative review stops the run with safe feedback and no repeated authoring", async () => {
  const calls = transport([healthy(), authored(), Response.json({ detail: "Story logline review failed: treatment 1 incident needs expression in the logline and story support (verdict: contradicted)" }, { status: 502 })]);
  await expect(runStoryTreatmentGateway(payload, "run-test")).rejects.toThrow("incident is contradicted");
  expect(calls).toHaveLength(3);
  expect(stages.at(-1)).toBe("reviewing");
});

test("an author response cannot supply approval on behalf of the review stage", async () => {
  transport([healthy(), Response.json({ ok: true, output, logline_review: approval }), Response.json({ ok: true })]);
  await expect(runStoryTreatmentGateway(payload, "run-test")).rejects.toThrow(STORY_LOGLINE_REVIEW_REQUIRED);
});

test("missing stage deployment fails explicitly without falling back to a combined call", async () => {
  const calls = transport([healthy(), Response.json({ detail: "Not Found" }, { status: 404 })]);
  await expect(runStoryTreatmentGateway(payload, "run-test")).rejects.toThrow(STORY_LOGLINE_REVIEW_REQUIRED);
  expect(calls).toHaveLength(2);
  expect(stages).toEqual(["generating"]);
});

test("invalid authored output never reaches review", async () => {
  const calls = transport([healthy(), Response.json({ ok: true, output: [] })]);
  await expect(runStoryTreatmentGateway(payload, "run-test")).rejects.toThrow("no JSON output object");
  expect(calls).toHaveLength(2);
});
