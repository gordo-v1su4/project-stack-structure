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
const { runStoryTreatmentGateway, storyTreatmentTask, STORY_REVIEW_EVIDENCE_FORMAT_CONSTRAINT } = await import("../../src/trigger/storyTreatment");
const { STORY_LOGLINE_REVIEW_REQUIRED } = await import("../../src/lib/storyLoglineReview");
type DiagnosticEvent = import("../../src/lib/storyTreatmentDiagnostics").StoryDiagnosticEvent;
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; spans.length = 0; logs.length = 0; stages.length = 0; exposedMetadata.length = 0; for (const key of Object.keys(privateMetadata)) delete privateMetadata[key]; });
const payload = { operation: "revise" as const, instructions: "private instructions", input: "private story", model: "qwen-test", reviewContext: { brief: "private brief", constraints: [] } };
const output = { treatment: { id: "faithful", logline: "private pitch" } };
const approval = { version: 1, status: "passed" };
function transport(responses: Response[], onRequest?: (count: number) => void) {
  const calls: { url: string; body?: Record<string, unknown>; signal?: AbortSignal | null }[] = [];
  globalThis.fetch = (async (url, options) => {
    calls.push({ url: String(url), body: options?.body ? JSON.parse(String(options.body)) : undefined, signal: options?.signal });
    onRequest?.(calls.length);
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

const formatFailure = (reason: string) => Response.json({ detail: `Story logline review failed: treatment 1 stakes reviewer ${reason}` }, { status: 502 });
test("only exact quote/id evidence failures retry review once on byte-identical candidates and brief with one shared deadline", async () => {
  for (const reason of ["logline quote is not an exact excerpt", "brief quote is not an exact excerpt", "cited an unknown moment id"]) {
    const events: DiagnosticEvent[] = [];
    const before = JSON.stringify(payload);
    const calls = transport([healthy(), authored(), formatFailure(reason), Response.json({ ok: true, logline_review: approval })]);
    const result = await runStoryTreatmentGateway(payload, "run-test", async event => { events.push(structuredClone(event)); });
    expect(calls).toHaveLength(4);
    expect(calls[2].signal).toBe(calls[3].signal);
    expect(JSON.stringify(calls[2].body?.output)).toBe(JSON.stringify(calls[3].body?.output));
    expect(calls[3].body?.review_context).toEqual({ brief: payload.reviewContext.brief, constraints: [STORY_REVIEW_EVIDENCE_FORMAT_CONSTRAINT] });
    expect(JSON.stringify(payload)).toBe(before);
    expect(events.filter(e => e.phase === "review").map(e => [e.reviewAttempt, e.outcome])).toEqual([[1, "rejected"], [2, "review-passed"]]);
    expect(result.output).toEqual(output);
    expect(result.loglineReview).toEqual(approval);
  }
});

test("semantic, spoiler, unavailable and generic malformed evidence failures do not trigger format repair", async () => {
  for (const detail of [
    "treatment 1 stakes needs expression in the logline and story support (verdict: unclear)",
    "treatment 1 must avoid revealing its resolution",
    "reviewer unavailable; retry the story request",
    "reviewer returned incomplete or invalid evidence; retry the story request",
    "treatment 1 stakes reviewer logline quote is not an exact excerpt; treatment 2 goal needs expression in the logline and story support (verdict: contradicted)",
  ]) {
    const calls = transport([healthy(), authored(), Response.json({ detail: `Story logline review failed: ${detail}` }, { status: 502 })]);
    await expect(runStoryTreatmentGateway(payload, "run-test")).rejects.toThrow();
    expect(calls).toHaveLength(3);
  }
});

test("a second evidence failure or missing second approval marker never accepts and never retries a third time", async () => {
  for (const response of [formatFailure("brief quote is not an exact excerpt"), Response.json({ ok: true })]) {
    const calls = transport([healthy(), authored(), formatFailure("logline quote is not an exact excerpt"), response]);
    await expect(runStoryTreatmentGateway(payload, "run-test")).rejects.toThrow();
    expect(calls).toHaveLength(4);
  }
});

test("expiration of the shared review timer cannot accept a late repair response", async () => {
  const controller = new AbortController(), originalTimeout = AbortSignal.timeout;
  AbortSignal.timeout = ms => ms === 135_000 ? controller.signal : originalTimeout(ms);
  try {
    const events: DiagnosticEvent[] = [];
    const calls = transport([healthy(), authored(), formatFailure("logline quote is not an exact excerpt"), Response.json({ ok: true, logline_review: approval })], count => { if (count === 4) controller.abort(); });
    await expect(runStoryTreatmentGateway(payload, "run-test", async e => { events.push(e); })).rejects.toThrow("original time budget");
    expect(calls[2].signal).toBe(calls[3].signal);
    expect(events.some(e => e.outcome === "review-passed")).toBe(false);
    expect(events.at(-1)?.rejection?.issues[0].code).toBe("review-time-budget");
  } finally { AbortSignal.timeout = originalTimeout; }
});

test("an expired first review or full context budget prevents any second HTTP review", async () => {
  const controller = new AbortController(), originalTimeout = AbortSignal.timeout;
  AbortSignal.timeout = ms => ms === 135_000 ? controller.signal : originalTimeout(ms);
  try {
    const calls = transport([healthy(), authored(), formatFailure("brief quote is not an exact excerpt")], count => { if (count === 3) controller.abort(); });
    await expect(runStoryTreatmentGateway(payload, "run-test")).rejects.toThrow("original time budget");
    expect(calls).toHaveLength(3);
  } finally { AbortSignal.timeout = originalTimeout; }
  const calls = transport([healthy(), authored(), formatFailure("brief quote is not an exact excerpt")]);
  await expect(runStoryTreatmentGateway({ ...payload, reviewContext: { brief: "b".repeat(12_000), constraints: [] } }, "run-test")).rejects.toThrow();
  expect(calls).toHaveLength(3);
});

test("production retention keeps both review attempts hash-bound under canonical owner without logging candidates", async () => {
  transport([healthy(), authored(), formatFailure("brief quote is not an exact excerpt"), Response.json({ ok: true, logline_review: approval })]);
  const result = await executeTask(payload, { ctx: { run: { id: "run_repair123", tags: ["user:github-owner"] } } });
  expect(result).not.toBe(undefined);
  const first = privateMetadata.storyReviewDiagnosticRecord as Record<string, unknown>, second = privateMetadata.storyReviewRepairDiagnosticRecord as Record<string, unknown>;
  expect(first.outcome).toBe("rejected"); expect(second.outcome).toBe("review-passed");
  expect(first.candidateSha256).toBe(second.candidateSha256);
  expect(first.ownerId).toBe("github-owner"); expect(second.ownerId).toBe("github-owner");
  expect(JSON.stringify(logs)).not.toContain("private");
});

test("a shared-deadline fetch rejection aborts the task instead of permitting an authoring transport retry", async () => {
  const controller = new AbortController(), originalTimeout = AbortSignal.timeout;
  AbortSignal.timeout = ms => ms === 135_000 ? controller.signal : originalTimeout(ms);
  try {
    const calls = transport([healthy(), authored()], count => {
      if (count === 3) { controller.abort(); throw new DOMException("private abort details", "AbortError"); }
    });
    let caught: unknown;
    try { await executeTask(payload, { ctx: { run: { id: "run_deadline123", tags: ["user:github-owner"] } } }); }
    catch (error) { caught = error; }
    expect(caught instanceof Error && caught.constructor.name === "AbortTaskRunError").toBe(true);
    expect((caught as Error).message).toContain("original time budget");
    expect(calls).toHaveLength(3);
    const record = privateMetadata.storyReviewDiagnosticRecord as Record<string, unknown>;
    expect(record.outcome).toBe("rejected");
    expect(record.reviewAttempt).toBe(1);
    expect(record.httpStatus).toBe(undefined);
    expect((record.rejection as { issues: { code: string }[] }).issues[0].code).toBe("review-time-budget");
    expect(JSON.stringify(logs)).not.toContain("private");
  } finally { AbortSignal.timeout = originalTimeout; }
});

test("ordinary nondeadline review transport rejection keeps its original retry semantics and error object", async () => {
  const failure = new Error("private connection failure");
  const calls = transport([healthy(), authored()], count => { if (count === 3) throw failure; });
  let caught: unknown;
  try { await runStoryTreatmentGateway(payload, "run-test"); } catch (error) { caught = error; }
  expect(caught).toBe(failure);
  expect(calls).toHaveLength(3);
});
