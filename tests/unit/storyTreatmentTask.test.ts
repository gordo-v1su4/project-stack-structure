import { afterEach, expect, mock, test } from "bun:test";

const spans: string[] = [];
const logs: unknown[] = [];
const stages: string[] = [];
const exposedMetadata: { key: string; value: unknown }[] = [];
const privateMetadata: Record<string, unknown> = {};
mock.module("@trigger.dev/sdk", () => ({
  AbortTaskRunError: class AbortTaskRunError extends Error {},
  task: (definition: unknown) => definition,
  queue: (definition: unknown) => definition,
  wait: { for: async () => {} },
  metadata: { set(key: string, value: unknown) { if (key === "stage" && typeof value === "string") stages.push(value); privateMetadata[key] = value; exposedMetadata.push({ key, value }); return this; }, current: () => privateMetadata, flush: async () => {} },
  logger: {
    trace: async (name: string, fn: () => Promise<unknown>) => { spans.push(name); return fn(); },
    info: (...args: unknown[]) => logs.push(args),
    warn: (...args: unknown[]) => logs.push(args),
  },
}));
const { runStoryTreatmentGateway, storyTreatmentTask } = await import("../../src/trigger/storyTreatment");
const { STORY_LOGLINE_REVIEW_REQUIRED } = await import("../../src/lib/storyLoglineReview");
type DiagnosticEvent = import("../../src/lib/storyTreatmentDiagnostics").StoryDiagnosticEvent;
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; spans.length = 0; logs.length = 0; stages.length = 0; exposedMetadata.length = 0; for (const key of Object.keys(privateMetadata)) delete privateMetadata[key]; });
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

test("captures exact unreviewed candidate before review and preserves fixed rejection before masking", async () => {
  const events: DiagnosticEvent[] = [];
  const calls = transport([healthy(), Response.json({ ok: true, output, model: "actual-8B" }), Response.json({ detail: "Story logline review failed: reviewer returned incomplete or invalid evidence; retry the story request", token: "NEVER" }, { status: 502 })]);
  await expect(runStoryTreatmentGateway(payload, "run-test", async event => {
    if (event.outcome === "authored-unreviewed") expect(calls).toHaveLength(2);
    events.push(structuredClone(event));
  })).rejects.toThrow("pitch needs a supported incident");
  expect(events.map(e => e.outcome)).toEqual(["authored-unreviewed", "rejected"]);
  expect(events[1].authoredOutput).toEqual(output);
  expect(events[1].actualModel).toBe("actual-8B");
  expect(events[1].rejection?.issues).toEqual([{ code: "review-evidence-invalid" }]);
  expect(events[1].httpStatus).toBe(502);
  expect(JSON.stringify(events)).not.toContain("NEVER");
  expect(JSON.stringify(logs)).not.toMatch(/private|NEVER/);
  expect(calls).toHaveLength(3);
});

test("failed diagnostic storage cannot mask the original semantic rejection or turn it into success", async () => {
  transport([healthy(), authored(), Response.json({ detail: "Story logline review failed: treatment 1 incident needs expression in the logline and story support (verdict: contradicted)" }, { status: 502 })]);
  await expect(runStoryTreatmentGateway(payload, "run-test", async () => { throw Error("PRIVATE storage credential"); })).rejects.toThrow("incident is contradicted");
  expect(JSON.stringify(logs)).not.toMatch(/PRIVATE|private|credential/);
});

test("success marker is recorded only after real review and missing marker is retained as rejected", async () => {
  const events: DiagnosticEvent[] = [];
  transport([healthy(), authored(), Response.json({ ok: true })]);
  await expect(runStoryTreatmentGateway(payload, "run-test", async event => { events.push(event); })).rejects.toThrow(STORY_LOGLINE_REVIEW_REQUIRED);
  expect(events.at(-1)?.gatewayReviewMarker).toBe("missing-or-invalid");
  expect(events.at(-1)?.rejection?.issues[0].code).toBe("review-approval-marker-missing");
  expect(events.some(event => event.outcome === "review-passed")).toBe(false);
});

const executeTask = (storyTreatmentTask as unknown as { run: (p: typeof payload, context: { ctx: { run: { id: string; tags: string[] } } }) => Promise<unknown> }).run;

test("production task retains private candidate under canonical owner and never sends its values to logs", async () => {
  transport([healthy(), Response.json({ ok: true, output, model: "actual-8B" }), Response.json({ detail: "Story logline review failed: treatment 1 incident needs expression in the logline and story support (verdict: contradicted)" }, { status: 502 })]);
  const forgedPayloadOwner = { ...payload, ownerId: "foreign", applicationUserId: "foreign" };
  await expect(executeTask(forgedPayloadOwner, { ctx: { run: { id: "run_canonical123", tags: ["user:github-owner", "story"] } } })).rejects.toThrow("incident is contradicted");
  const authored = privateMetadata.storyAuthoredDiagnosticRecord as { ownerId: string; candidate: unknown }, review = privateMetadata.storyReviewDiagnosticRecord as { ownerId: string; candidate?: unknown };
  expect(authored.ownerId).toBe("github-owner");
  expect(review.ownerId).toBe("github-owner");
  expect(authored.candidate).toEqual(output);
  expect(review.candidate).toBe(undefined);
  const pointers = exposedMetadata.filter(entry => ["storyAuthoredDiagnostic", "storyReviewDiagnostic"].includes(entry.key));
  expect(pointers.map(entry => entry.key)).toEqual(["storyAuthoredDiagnostic", "storyReviewDiagnostic"]);
  expect(JSON.stringify(pointers)).not.toMatch(/private pitch|private brief|private instructions|uploadToken|NEVER|foreign/);
  expect(JSON.stringify(logs)).not.toContain("private");
});

test("production task refuses missing or ambiguous owner tags before model/storage work", async () => {
  const calls = transport([]);
  for (const tags of [[], ["user:first", "user:second"]]) await expect(executeTask(payload, { ctx: { run: { id: "run_canonical123", tags } } })).rejects.toThrow("exactly one authenticated owner");
  expect(calls).toHaveLength(0);
  expect(privateMetadata.storyAuthoredDiagnosticRecord).toBe(undefined);
});
