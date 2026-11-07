import { describe, expect, test } from "bun:test";
import { checkCurrentReferenceRange, prepareReferenceMigration } from "@/components/studio/currentReferenceClient";
import { buildCurrentIdentityRequest } from "@/components/studio/currentReferenceIdentity";
import { generationScopeSha256 } from "@/components/studio/generationScope";
import { identityPolicySha256 } from "@/components/studio/issuedIdentityPolicy";
import { sourceConfirmationBaselineSha256 } from "@/components/studio/sourceConfirmationClient";
import { currentReferenceIdentityFixture } from "../helpers/currentReferenceIdentity";

function migrationFixture() {
  const fixture = currentReferenceIdentityFixture();
  const baseline = structuredClone(fixture.saved);
  delete baseline.draft.musicVideoProject!.generationScope;
  delete baseline.draft.musicVideoProject!.currentIdentity;
  const baselineSha256 = sourceConfirmationBaselineSha256(baseline.draft);
  const body = { ...fixture.receipt.body, referenceMigration: { ...fixture.receipt.body.referenceMigration!, baselineSha256 } };
  const sha256 = generationScopeSha256(body);
  const receipt = { ...fixture.receipt, body, sha256, id: `generation-scope-${sha256}` };
  const draft = { ...fixture.saved.draft, musicVideoProject: { ...fixture.saved.draft.musicVideoProject!, generationScope: receipt,
    currentIdentity: { ...fixture.context, migrationSha256: sha256, assessments: {}, activeAssessments: {} } } };
  return { baseline, result: { draft, receipt, expectedRevision: baseline.revision!, baselineSha256 } };
}

describe("explicit reference migration preparation", () => {
  test("returns a revision-bound candidate without adopting it or writing a project", async () => {
    const { baseline, result } = migrationFixture(), calls: { path: string; init?: RequestInit }[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ path: String(input), init });
      return Response.json(calls.length === 1 ? { saved: baseline } : result);
    }) as typeof fetch;
    expect(await prepareReferenceMigration({ projectId: baseline.project.id, baseline: baseline.draft, isCurrent: () => true, fetchImpl })).toEqual(result);
    expect(calls.map(call => call.init?.method ?? "GET")).toEqual(["GET", "POST"]);
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({ projectId: baseline.project.id, expectedRevision: baseline.revision });
  });
  for (const failure of ["remote edit", "local edit", "late project switch", "wrong revision", "wrong context", "wrong baseline", "forged receipt"]) {
    test(`rejects ${failure} without a project write`, async () => {
      const { baseline, result } = migrationFixture();
      const remote = structuredClone(baseline);
      let current = true, calls = 0;
      if (failure === "remote edit") remote.draft.generatedAssets = [];
      const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.method).not.toBe("PUT"); calls++;
        if (calls === 1) {
          if (failure === "local edit") current = false;
          return Response.json({ saved: remote });
        }
        if (failure === "late project switch") current = false;
        if (failure === "wrong revision") result.expectedRevision = '"other"';
        if (failure === "wrong context") result.draft.musicVideoProject.currentIdentity.contextSha256 = "0".repeat(64);
        if (failure === "wrong baseline") result.baselineSha256 = "0".repeat(64);
        if (failure === "forged receipt") result.receipt.body.scopeSignature = "forged";
        return Response.json(result);
      }) as typeof fetch;
      await expect(prepareReferenceMigration({ projectId: baseline.project.id, baseline: baseline.draft, isCurrent: () => current, fetchImpl })).rejects.toThrow();
      expect(calls).toBe(failure === "remote edit" || failure === "local edit" ? 1 : 2);
    });
  }
});

function checkFixture() {
  const fixture = currentReferenceIdentityFixture();
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
  const queues = new Map<string, Promise<void>>();
  const lock = { async request<T>(name: string, callback: () => Promise<T>): Promise<T> {
    const previous = queues.get(name) ?? Promise.resolve();
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    queues.set(name, previous.then(() => pending));
    await previous;
    try { return await callback(); } finally { release(); }
  } };
  const input = { projectId: fixture.job.projectId, expectedRevision: fixture.saved.revision!, baselineSha256: sourceConfirmationBaselineSha256(fixture.saved.draft),
    migrationId: fixture.receipt.id, contextSha256: fixture.context.contextSha256, jobId: fixture.job.id, assetId: fixture.asset.id,
    trimStart: fixture.asset.trimStart ?? 0, storage, lock, wait: async () => {}, maximumPolls: 2, isCurrent: () => true };
  const response = (intent: string) => {
    const { id: _id, policyId, policySha256, ...base } = fixture.assessment.scope; void _id;
    const scope = { ...base, requestIntentId: intent };
    const request = buildCurrentIdentityRequest({ migrationId: input.migrationId, expectedRevision: input.expectedRevision,
      baselineSha256: input.baselineSha256, scope });
    const assessmentBody = { ...scope, policyId, policySha256 };
    const assessment = { ...fixture.assessment, scope: { ...assessmentBody, id: `h3-current-assessment-${identityPolicySha256(assessmentBody)}` } };
    return { request, runId: "run_current_test", assessment, outcome: { requestId: request.id, status: "ready" as const, assessmentId: assessment.scope.id } };
  };
  return { ...fixture, data, input, response };
}

describe("durable current-reference CPU requests", () => {
  test("lost POST acknowledgment and later reload use the same intent with no second POST", async () => {
    const fixture = checkFixture(); let posts = 0, gets = 0, intent = "";
    const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") { posts++; intent = JSON.parse(String(init.body)).requestIntentId; throw new Error("ACK lost after dispatch"); }
      gets++; return Response.json(fixture.response(intent));
    }) as typeof fetch;
    const first = await checkCurrentReferenceRange({ ...fixture.input, fetchImpl });
    expect(first.scope.requestIntentId).toBe(intent);
    expect(await checkCurrentReferenceRange({ ...fixture.input, fetchImpl })).toEqual(first);
    expect(posts).toBe(1); expect(gets).toBe(2);
    expect([...fixture.data.values()].every(value => JSON.parse(value).requestIntentId === intent)).toBe(true);
  });
  test("unresolved ACK remains GET-only on a later explicit recovery", async () => {
    const fixture = checkFixture(); let posts = 0, intent = "", ready = false;
    const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") { posts++; intent = JSON.parse(String(init.body)).requestIntentId; throw new Error("unknown transport"); }
      return ready ? Response.json(fixture.response(intent)) : Response.json({ code: "CURRENT_IDENTITY_REQUEST_NOT_FOUND" }, { status: 404 });
    }) as typeof fetch;
    await expect(checkCurrentReferenceRange({ ...fixture.input, fetchImpl })).rejects.toThrow("acknowledgment is unresolved");
    ready = true;
    expect((await checkCurrentReferenceRange({ ...fixture.input, fetchImpl })).scope.requestIntentId).toBe(intent);
    expect(posts).toBe(1);
  });
  test("a reserved intent that was never submitted can be dispatched once after returning to the draft", async () => {
    const fixture = checkFixture(); let current = false, posts = 0;
    const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe("POST"); posts++;
      return Response.json(fixture.response(JSON.parse(String(init?.body)).requestIntentId));
    }) as typeof fetch;
    const input = { ...fixture.input, fetchImpl, isCurrent: () => current };
    await expect(checkCurrentReferenceRange(input)).rejects.toThrow("reserved intent was not submitted");
    current = true;
    await checkCurrentReferenceRange(input);
    expect(posts).toBe(1);
  });
  test("known rejections permit only two explicit attempts and preserve the rejected intent", async () => {
    const fixture = checkFixture(); let posts = 0;
    const intents = new Set<string>();
    const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method !== "POST") return Response.json({ code: "CURRENT_IDENTITY_REQUEST_NOT_FOUND" }, { status: 404 });
      posts++; intents.add(JSON.parse(String(init?.body)).requestIntentId);
      return Response.json({ error: "Reload the changed saved project.", code: "CHECK_NOT_SUBMITTED" }, { status: 409 });
    }) as typeof fetch;
    for (let attempt = 0; attempt < 3; attempt++) await expect(checkCurrentReferenceRange({ ...fixture.input, fetchImpl })).rejects.toThrow();
    expect(posts).toBe(2); expect(intents.size).toBe(2);
    expect([...fixture.data.keys()].some(key => key.includes(":rejected:"))).toBe(true);
  });
  test("an error after dispatch recovers its canonical intent without another POST", async () => {
    const fixture = checkFixture(); let posts = 0, intent = "";
    const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts++; intent = JSON.parse(String(init.body)).requestIntentId;
        return Response.json({ error: "Dispatch acknowledgment unavailable." }, { status: 409 });
      }
      return Response.json(fixture.response(intent));
    }) as typeof fetch;
    await checkCurrentReferenceRange({ ...fixture.input, fetchImpl });
    await checkCurrentReferenceRange({ ...fixture.input, fetchImpl });
    expect(posts).toBe(1);
  });
  test("ambiguous rejection and absent GET remain unknown until the same intent is recovered", async () => {
    const fixture = checkFixture(); let posts = 0, intent = "", ready = false;
    const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts++; intent = JSON.parse(String(init.body)).requestIntentId;
        return Response.json({ error: "ACK unresolved", code: "SUBMISSION_UNKNOWN" }, { status: 503 });
      }
      return ready ? Response.json(fixture.response(intent)) : Response.json({ code: "CURRENT_IDENTITY_REQUEST_NOT_FOUND" }, { status: 404 });
    }) as typeof fetch;
    await expect(checkCurrentReferenceRange({ ...fixture.input, fetchImpl })).rejects.toThrow("acknowledgment is unresolved");
    ready = true;
    await checkCurrentReferenceRange({ ...fixture.input, fetchImpl });
    expect(posts).toBe(1);
  });
  test("a fresh baseline can reserve a bounded attempt after two proven pre-submission rejections", async () => {
    const fixture = checkFixture(); let posts = 0;
    const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method !== "POST") return Response.json({ code: "CURRENT_IDENTITY_REQUEST_NOT_FOUND" }, { status: 404 });
      posts++;
      return Response.json({ error: "Saved project changed.", code: "CHECK_NOT_SUBMITTED" }, { status: 409 });
    }) as typeof fetch;
    for (let attempt = 0; attempt < 2; attempt++) await expect(checkCurrentReferenceRange({ ...fixture.input, fetchImpl })).rejects.toThrow();
    await expect(checkCurrentReferenceRange({ ...fixture.input, expectedRevision: '"fresh"', baselineSha256: "b".repeat(64), fetchImpl })).rejects.toThrow();
    expect(posts).toBe(3);
    expect([...fixture.data.keys()].filter(key => key.includes(":rejected:"))).toHaveLength(2);
  });
  test("a missing project response cannot prove that the original intent was never submitted", async () => {
    const fixture = checkFixture(); let posts = 0;
    const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts++;
        return Response.json({ error: "Changed project.", code: "CHECK_NOT_SUBMITTED" }, { status: 409 });
      }
      return Response.json({ error: "Project not found." }, { status: 404 });
    }) as typeof fetch;
    await expect(checkCurrentReferenceRange({ ...fixture.input, fetchImpl })).rejects.toThrow("Project not found");
    await expect(checkCurrentReferenceRange({ ...fixture.input, fetchImpl })).rejects.toThrow("Project not found");
    expect(posts).toBe(1);
  });
  test("two tabs share one scope lock and recover a single submitted intent", async () => {
    const fixture = checkFixture(); let posts = 0, intent = "";
    const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") { posts++; intent = JSON.parse(String(init.body)).requestIntentId; await Promise.resolve(); }
      return Response.json(fixture.response(intent));
    }) as typeof fetch;
    const [first, second] = await Promise.all([
      checkCurrentReferenceRange({ ...fixture.input, fetchImpl }), checkCurrentReferenceRange({ ...fixture.input, fetchImpl }),
    ]);
    expect(posts).toBe(1); expect(first).toEqual(second);
  });
  test("a completed response for another exact frame interval cannot be delivered", async () => {
    const fixture = checkFixture(); let intent = "";
    const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") intent = JSON.parse(String(init.body)).requestIntentId;
      const value = fixture.response(intent); value.assessment.scope.endFrameExclusive++;
      return Response.json(value);
    }) as typeof fetch;
    await expect(checkCurrentReferenceRange({ ...fixture.input, fetchImpl })).rejects.toThrow("assessment differs");
  });
});
