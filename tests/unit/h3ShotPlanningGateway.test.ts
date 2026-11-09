import { describe, expect, test } from "bun:test";
import { generateH3ShotPlan, H3_SHOT_GATEWAY_LIMITS, type H3ShotAuthorInput, type H3ShotChunkCandidate } from "@/lib/h3ShotPlanningGateway";
import { buildH3ShotPlanningInput } from "@/components/studio/h3ShotPlanning";
import { createMusicVideoProject, prepareApprovedPlacements, buildEditPlanPreviewSegments } from "@/components/studio/musicVideoProject";
import { generationScopeSha256 } from "@/components/studio/generationScope";

const env = { SCENE_CAPTION_SMART_GATEWAY_URL: "http://gateway.test", SCENE_CAPTION_SMART_GATEWAY_TOKEN: "private-test-token" };
function fixture(count = 50) {
  const draft = createMusicVideoProject({ analysis: null, duration: count, videoSources: [], storyDrafts: [
    { id: "escape", label: "Escape", start: 0, end: count, prompt: "Approved escape sequence." },
  ] });
  draft.editPlan.timelineItems[0].requirements = { subjects: ["Diego"], actionSequence: ["first action", "second action", "third action"],
    excludedActions: ["restart"], physicalStates: ["door open"], setting: "CLUB_MAIN" };
  const project = prepareApprovedPlacements({ project: draft, videoSources: [] });
  const segment = buildEditPlanPreviewSegments({ project, videoSources: [] })[0];
  const segments = Array.from({ length: count }, (_, index) => ({ ...segment, musicStart: index, musicEnd: index + 1 }));
  return buildH3ShotPlanningInput({ project, segments, subjectNames: ["Diego"] });
}
function candidate(input: H3ShotAuthorInput): H3ShotChunkCandidate {
  return { version: 1, bindingSha256: input.bindingSha256, directions: input.windows.map(window => ({
    windowId: window.id, direction: `Direction ${window.id}`, entryState: `state ${window.id}`, exitState: `state ${window.id + 1}`,
    actionIndices: window.id === 0 ? [0] : window.id === 24 ? [1] : window.id === 48 ? [2] : [],
  })) };
}
type Call = { path: string; body: unknown; signal: AbortSignal };
function gateway(override?: (path: string, body: unknown, calls: Call[]) => Response | undefined | Promise<Response | undefined>) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: RequestInfo | URL, options: RequestInit = {}) => {
    const path = new URL(String(url)).pathname;
    const body = JSON.parse(options.body as string);
    calls.push({ path, body, signal: options.signal as AbortSignal });
    expect(new Headers(options.headers).get("authorization")).toBe("Bearer private-test-token");
    expect(options.redirect).toBe("error");
    const custom = await override?.(path, body, calls);
    if (custom) return custom;
    if (path === "/story/shots/author") return Response.json(candidate(body as H3ShotAuthorInput));
    const review = body as { input: H3ShotAuthorInput; candidate: H3ShotChunkCandidate; candidateSha256: string };
    expect(review.candidateSha256).toBe(generationScopeSha256(review.candidate));
    return Response.json({ version: 1, bindingSha256: review.input.bindingSha256, candidateSha256: review.candidateSha256, status: "passed", violations: [] });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe("bounded H3 shot planning gateway", () => {
  test("candidate hashing matches the gateway's permanent Unicode/quote parity fixture", () => {
    expect(generationScopeSha256({ version: 1, bindingSha256: "a".repeat(64), directions: [{ windowId: 24,
      direction: 'Diego — 界 / "x"', entryState: "state 24", exitState: "state 25", actionIndices: [1] }] }))
      .toBe("59d44f64be95d3930a8d6c3eb1fd02c9199c7c59a406e930324dc682ae7a669d");
  });
  test("authors/reviews full canonical groups in chunks with exact carried state and global action allocation", async () => {
    const input = fixture();
    input.groups[0].windows[1].sourceEvidence = { momentId: "accepted-source", caption: "Already holding the rail.", sourceStart: 3, sourceEnd: 4 };
    input.groups[0].windows[2].generatedEvidence = { assetId: "selected-prefix", sourceStart: 4, sourceEnd: 5,
      evidenceKind: "media-only", completion: "unverified", mediaSha256: "a".repeat(64) };
    const inputBody = { ...input }; delete (inputBody as Partial<typeof input>).bindingSha256;
    input.bindingSha256 = generationScopeSha256(inputBody);
    const mock = gateway();
    const result = await generateH3ShotPlan(input, { env, fetchImpl: mock.fetchImpl });
    expect(result.directions).toHaveLength(50);
    expect(result.directions.flatMap(direction => direction.actionIndices)).toEqual([0, 1, 2]);
    expect(mock.calls.map(call => call.path)).toEqual(Array.from({ length: 3 }, () => ["/story/shots/author", "/story/shots/review"]).flat());
    const authors = mock.calls.filter(call => call.path.endsWith("author")).map(call => call.body as H3ShotAuthorInput);
    expect(authors.map(body => body.windows.length)).toEqual([24, 24, 2]);
    expect(authors.map(body => body.windows[0].id)).toEqual([0, 24, 48]);
    expect(authors.map(body => body.context.completedActionCount)).toEqual([0, 1, 2]);
    expect(authors.map(body => body.context.remainingWindowCount)).toEqual([50, 26, 2]);
    expect(authors.map(body => body.context.previousExitState)).toEqual([undefined, "state 24", "state 48"]);
    expect(authors[0].context.constraints).toEqual(input.groups[0].constraints);
    expect(authors[0].windows[0].inference).toEqual(input.groups[0].windows[0].inference);
    expect(authors[0].windows[1].sourceEvidence).toEqual(input.groups[0].windows[1].sourceEvidence);
    expect(authors[0].windows[2].generatedEvidence).toEqual(input.groups[0].windows[2].generatedEvidence);
    expect(new Set(authors.map(author => author.bindingSha256)).size).toBe(3);
    for (const author of authors) expect(author.bindingSha256).toBe(generationScopeSha256({ inputBinding: input.bindingSha256,
      groupId: input.groups[0].id, context: author.context, windows: author.windows }));
    expect(result.bindingSha256).toBe(input.bindingSha256);
    expect(new Set(mock.calls.map(call => call.signal)).size).toBe(1);
    expect(JSON.stringify(result)).not.toContain("private-test-token");
  });

  test("prefers configured internal gateway and never falls back when that URL is invalid", async () => {
    const hosts: string[] = [];
    const mock = gateway();
    const fetchImpl = (async (url, options) => { hosts.push(new URL(String(url)).host); return mock.fetchImpl(url, options); }) as typeof fetch;
    await generateH3ShotPlan(fixture(), { env: { ...env, SCENE_CAPTION_SMART_GATEWAY_INTERNAL_URL: "http://internal.test:18091" }, fetchImpl });
    expect(hosts.every(host => host === "internal.test:18091")).toBe(true);
    const invalid = gateway();
    await expect(generateH3ShotPlan(fixture(), { env: { ...env, SCENE_CAPTION_SMART_GATEWAY_INTERNAL_URL: "not a URL" }, fetchImpl: invalid.fetchImpl })).rejects.toThrow("not configured");
    expect(invalid.calls).toHaveLength(0);
  });

  test("rejects another group's author response even when its ordinal window IDs are identical", async () => {
    const draft = createMusicVideoProject({ analysis: null, duration: 4, videoSources: [], storyDrafts: [
      { id: "first", label: "First", start: 0, end: 2, prompt: "First approved action." },
      { id: "second", label: "Second", start: 2, end: 4, prompt: "Second approved action." },
    ] });
    const project = prepareApprovedPlacements({ project: draft, videoSources: [] });
    const segments = buildEditPlanPreviewSegments({ project, videoSources: [] }).flatMap(segment => [
      { ...segment, musicEnd: segment.musicStart + 1 }, { ...segment, musicStart: segment.musicStart + 1 },
    ]);
    const input = buildH3ShotPlanningInput({ project, segments });
    let first: H3ShotChunkCandidate | undefined;
    const mock = gateway((path, body) => {
      if (!path.endsWith("author")) return;
      if (first) return Response.json(first);
      first = candidate(body as H3ShotAuthorInput);
      first.directions.forEach(direction => { direction.actionIndices = []; });
      return Response.json(first);
    });
    await expect(generateH3ShotPlan(input, { env, fetchImpl: mock.fetchImpl })).rejects.toThrow("chunk binding");
    expect(mock.calls).toHaveLength(3);
    const authors = mock.calls.filter(call => call.path.endsWith("author")).map(call => call.body as H3ShotAuthorInput);
    expect(authors[0].windows.map(window => window.id)).toEqual(authors[1].windows.map(window => window.id));
    expect(authors[0].bindingSha256).not.toBe(authors[1].bindingSha256);
  });

  test("does not retry or fall back to legacy treatment endpoints", async () => {
    for (const status of [404, 405, 422, 503]) {
      const mock = gateway(() => new Response("private backend detail", { status }));
      await expect(generateH3ShotPlan(fixture(), { env, fetchImpl: mock.fetchImpl })).rejects.toThrow(status === 404 || status === 405 ? "does not support" : "rejected");
      expect(mock.calls).toHaveLength(1);
    }
  });

  test("rejects malformed, repeated and reordered author output before independent review", async () => {
    for (const alter of [
      (value: H3ShotChunkCandidate) => { value.bindingSha256 = "other"; },
      (value: H3ShotChunkCandidate) => { value.directions[1].windowId = 0; },
      (value: H3ShotChunkCandidate) => { value.directions[1].entryState = "reset"; },
      (value: H3ShotChunkCandidate) => { value.directions[0].actionIndices = [1]; },
      (value: H3ShotChunkCandidate) => { value.directions[1].actionIndices = [0]; },
    ]) {
      const mock = gateway((path, body) => {
        if (!path.endsWith("author")) return;
        const value = candidate(body as H3ShotAuthorInput); alter(value); return Response.json(value);
      });
      await expect(generateH3ShotPlan(fixture(), { env, fetchImpl: mock.fetchImpl })).rejects.toThrow();
      expect(mock.calls).toHaveLength(1);
    }
  });

  test("rejects uncertain, mismatched or failed independent reviews without re-authoring", async () => {
    for (const change of [ { status: "unclear" }, { status: "rejected" }, { status: "passed", violations: ["unclear"] },
      { candidateSha256: "other" }, { bindingSha256: "other" }, { violations: ["invented"] } ]) {
      const mock = gateway((path, body) => {
        if (!path.endsWith("review")) return;
        const value = body as { input: H3ShotAuthorInput; candidateSha256: string };
        return Response.json({ version: 1, bindingSha256: value.input.bindingSha256, candidateSha256: value.candidateSha256, status: "passed", violations: [], ...change });
      });
      await expect(generateH3ShotPlan(fixture(), { env, fetchImpl: mock.fetchImpl })).rejects.toThrow("review did not pass");
      expect(mock.calls).toHaveLength(2);
    }
  });

  test("a later chunk cannot restart actions or change the previous chunk exit state", async () => {
    for (const reset of ["action", "state"]) {
      const mock = gateway((path, body) => {
        const wire = body as H3ShotAuthorInput;
        if (!path.endsWith("author") || wire.windows[0].id !== 24) return;
        const value = candidate(wire);
        if (reset === "action") value.directions[0].actionIndices = [0];
        else value.directions[0].entryState = "state 0";
        return Response.json(value);
      });
      await expect(generateH3ShotPlan(fixture(), { env, fetchImpl: mock.fetchImpl })).rejects.toThrow();
      expect(mock.calls).toHaveLength(3);
    }
  });

  test("bounds streamed bytes and declared body sizes without reading unbounded JSON", async () => {
    let cancelled = false;
    const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(H3_SHOT_GATEWAY_LIMITS.bodyBytes + 1)); }, cancel() { cancelled = true; } }));
    const streamed = gateway(() => response);
    await expect(generateH3ShotPlan(fixture(), { env, fetchImpl: streamed.fetchImpl })).rejects.toThrow("byte bound");
    expect(cancelled).toBe(true);
    const declared = gateway(() => new Response("{}", { headers: { "content-length": String(H3_SHOT_GATEWAY_LIMITS.bodyBytes + 1) } }));
    await expect(generateH3ShotPlan(fixture(), { env, fetchImpl: declared.fetchImpl })).rejects.toThrow("byte bound");
    expect(declared.calls).toHaveLength(1);
  });

  test("one deadline covers author, review and body reads, including non-cooperative mocks", async () => {
    let now = 0;
    const mock = gateway((path) => { if (path.endsWith("author")) now = 100; return undefined; });
    await expect(generateH3ShotPlan(fixture(), { env, fetchImpl: mock.fetchImpl, now: () => now, timeoutMs: 100 })).rejects.toThrow("deadline");
    expect(mock.calls).toHaveLength(1);
    const hanging = (async () => await new Promise<Response>(() => {})) as typeof fetch;
    await expect(generateH3ShotPlan(fixture(), { env, fetchImpl: hanging, timeoutMs: 5 })).rejects.toThrow("deadline");
    const body = gateway(() => new Response(new ReadableStream({ start() {} })));
    await expect(generateH3ShotPlan(fixture(), { env, fetchImpl: body.fetchImpl, timeoutMs: 5 })).rejects.toThrow("deadline");
  });

  test("rejects oversized later contexts before any call and sanitizes transport errors", async () => {
    const input = fixture(); input.groups[0].approvedDirection = "界".repeat(25_000);
    const body = { ...input }; delete (body as Partial<typeof input>).bindingSha256;
    input.bindingSha256 = generationScopeSha256(body);
    const mock = gateway();
    await expect(generateH3ShotPlan(input, { env, fetchImpl: mock.fetchImpl })).rejects.toThrow("admission");
    expect(mock.calls).toHaveLength(0);
    const leaking = (async () => { throw new Error("private-test-token"); }) as typeof fetch;
    await expect(generateH3ShotPlan(fixture(), { env, fetchImpl: leaking })).rejects.toThrow("transport or validation failed");
  });
});
