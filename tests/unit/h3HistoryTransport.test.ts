import { expect, mock, test } from "bun:test";
import { createHash, randomBytes } from "node:crypto";
import { gunzipSync } from "node:zlib";
import type { H3GenerationJob } from "@/components/studio/h3Generation";
import type { H3IdentityAssessment } from "@/components/studio/h3IdentityAssessment";
import { readH3DraftJobs } from "@/components/studio/h3DraftPlan";
import { STUDIO_JSON_MAX_EXPANDED_BYTES, STUDIO_JSON_MAX_WIRE_BYTES, STUDIO_JSON_TRANSPORT_HEADERS } from "@/lib/studioJsonTransport";
import { h3IdentityAssessmentFixture } from "../helpers/h3IdentityAssessment";
import { draftSimilarityFixture } from "../helpers/draftSimilarity";

const fixture = h3IdentityAssessmentFixture();
let signedIn = true, ownerId = fixture.job.ownerId, storageReads = 0;
let history: H3GenerationJob[] = [], job = fixture.job;
let assessment: H3IdentityAssessment = fixture.record;
const forbidden = async () => { throw new Error("Transport must not dispatch or mutate terminal jobs."); };
mock.module("@/lib/session", () => ({
  getSessionUser: async () => signedIn ? { id: ownerId } : null,
  unauthorizedResponse: () => Response.json({ success: false }, { status: 401 }),
}));
mock.module("@/lib/studioProjectStore", () => ({ readStudioProject: async (owner: string, project: string) => {
  storageReads++; return owner === fixture.job.ownerId && project === fixture.job.projectId ? { project: { id: project, ownerId: owner }, draft: {} } : null;
} }));
mock.module("@/lib/h3JobStore", () => ({
  listH3Jobs: async () => { storageReads++; return history; },
  readH3Job: async (_owner: string, _project: string, id: string) => { storageReads++; return id === job.id ? job : null; },
  createH3Job: forbidden, updateH3Job: forbidden, claimH3GenerationIntent: forbidden, pinH3JobReferences: forbidden,
}));
mock.module("@/lib/h3IdentityAssessmentStore", () => ({
  readH3IdentityAssessment: async (_owner: string, _project: string, _job: string, id: string) => {
    storageReads++; return id === fixture.scope.id ? assessment : null;
  }, claimH3IdentityAssessment: forbidden,
}));
mock.module("@/lib/triggerOrchestration", () => ({
  triggerH3Generation: forbidden, triggerH3IdentityRecheck: forbidden, retrieveTriggerRun: forbidden,
}));
const { GET } = await import("@/app/api/generate/h3/route");
function reset() { signedIn = true; ownerId = fixture.job.ownerId; storageReads = 0; history = []; job = fixture.job; assessment = fixture.record; }
const request = (query: Record<string, string> = {}, negotiated = true) => new Request(`https://app.test/api/generate/h3?${new URLSearchParams({ projectId: fixture.job.projectId, ...query })}`, {
  headers: negotiated ? STUDIO_JSON_TRANSPORT_HEADERS : {},
});
async function decode(response: Response) {
  const wire = new Uint8Array(await response.arrayBuffer());
  const bytes = response.headers.get("content-encoding") === "gzip" ? gunzipSync(wire) : wire;
  return { wire, text: new TextDecoder().decode(bytes), value: JSON.parse(new TextDecoder().decode(bytes)) };
}

/** Varied synthetic all-frame numeric proofs, not likeness evidence or real private job data. */
function largeHistory() {
  const { asset } = draftSimilarityFixture();
  const samples = Array.from({ length: 124 }, (_, frame) => ({
    timeSeconds: frame / 24, frameSha256: createHash("sha256").update(`synthetic-frame-${frame}`).digest("hex"),
    scores: Array.from({ length: 4 }, (_, index) => ({
      referenceHash: createHash("sha256").update(`synthetic-reference-${index % 2}`).digest("hex"),
      trackId: `face-${Math.floor(index / 2)}`, score: 0.51 + ((frame * 13 + index * 7) % 47) / 100,
    })),
  }));
  const proof = { ...asset.identityVerification!, samples,
    draftSimilarityFilter: { ...asset.identityVerification!.draftSimilarityFilter!, samples } };
  return Array.from({ length: 64 }, (_, index): H3GenerationJob => {
    const id = `h3-${index.toString(16).padStart(64, "0")}`;
    return { ...fixture.job, id, state: index % 3 ? "ready" : "failed", error: index % 3 ? undefined : "Original failed assessment remains saved.",
      result: { asset: { ...asset, id, jobId: id, identityVerification: { ...proof, assetId: id, jobId: id } } } };
  });
}

test("negotiated history preserves all64 jobs, failed attempts, order and full124-frame numeric proofs over4MB", async () => {
  reset();
  history = largeHistory();
  const expected = JSON.stringify({ success: true, jobs: history }), before = JSON.stringify(history);
  expect(Buffer.byteLength(expected)).toBeGreaterThan(STUDIO_JSON_MAX_WIRE_BYTES);
  const response = await GET(request());
  expect(response.status).toBe(200); expect(response.headers.get("content-encoding")).toBe("gzip");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("vary")).toBe("x-studio-json-transport");
  const body = await decode(response);
  expect(body.wire.byteLength).toBeLessThan(STUDIO_JSON_MAX_WIRE_BYTES);
  expect(body.text).toBe(expected); expect(JSON.stringify(history)).toBe(before);
  expect(body.value.jobs.map((entry: H3GenerationJob) => entry.id)).toEqual(history.map(entry => entry.id));
});

test("the actual panel reader negotiates gzip and consumes Fetch-decoded complete history without a write", async () => {
  reset();
  history = largeHistory(); let reads = 0;
  const restored = await readH3DraftJobs(fixture.job.projectId, (async (url, init) => {
    reads++; expect(init?.method ?? "GET").toBe("GET"); expect(init?.cache).toBe("no-store");
    expect(new Headers(init?.headers).get("x-studio-json-transport")).toBe("gzip");
    const response = await GET(new Request(new URL(String(url), "https://app.test"), init));
    // Browser Fetch decodes the body before response.json(); emulate that boundary for an in-process route response.
    const body = await decode(response);
    return new Response(body.text, { status: response.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch);
  expect(JSON.stringify(restored)).toBe(JSON.stringify(history)); expect(reads).toBe(1);
});

test("targeted job and range assessment retain exact proof and scope with gzip or ordinary small JSON", async () => {
  reset();
  job = largeHistory()[1];
  const targeted = await GET(request({ jobId: job.id }));
  expect(targeted.status).toBe(200); expect(targeted.headers.get("content-encoding")).toBe("gzip");
  expect((await decode(targeted)).text).toBe(JSON.stringify({ success: true, job }));
  job = fixture.job;
  const scopeQuery = { jobId: job.id, assessmentId: fixture.scope.id };
  const assessed = await GET(request(scopeQuery));
  expect(assessed.status).toBe(200);
  expect((await decode(assessed)).text).toBe(JSON.stringify({ success: true, jobId: job.id, assessment: fixture.record }));
  assessment = { version: 1, status: "failed", scope: fixture.scope, assessedAt: fixture.record.assessedAt,
    error: "The exact range assessment failed. ".repeat(3000) };
  const failed = await GET(request(scopeQuery));
  expect(failed.headers.get("content-encoding")).toBe("gzip");
  expect((await decode(failed)).text).toBe(JSON.stringify({ success: true, jobId: job.id, assessment }));
  const plain = await GET(request({ jobId: job.id }, false));
  expect(plain.status).toBe(200); expect(plain.headers.has("content-encoding")).toBe(false);
  expect(await plain.json()).toEqual(JSON.parse(JSON.stringify({ success: true, job })));
});

test("anonymous requests read no storage and foreign ownership never reaches job history", async () => {
  reset();
  signedIn = false;
  const queries: Record<string, string>[] = [{}, { jobId: job.id }, { jobId: job.id, assessmentId: fixture.scope.id }];
  for (const query of queries) {
    expect((await GET(request(query))).status).toBe(401);
  }
  expect(storageReads).toBe(0);
  signedIn = true; ownerId = "different-owner";
  for (const query of queries) expect((await GET(request(query))).status).toBe(404);
  expect(storageReads).toBe(queries.length);
});

test("small unnegotiated histories work while large legacy callers receive bounded413 instead of overflow", async () => {
  reset();
  history = [fixture.job];
  expect((await GET(request({}, false))).status).toBe(200);
  history = largeHistory();
  const response = await GET(request({}, false));
  expect(response.status).toBe(413); expect((await response.json()).error).toContain("requires gzip");
});

test("expanded and incompressible histories keep existing transport bounds rather than stripping evidence", async () => {
  reset();
  history = [{ ...fixture.job, compiledPrompt: "x".repeat(STUDIO_JSON_MAX_EXPANDED_BYTES) }];
  const expanded = await GET(request());
  expect(expanded.status).toBe(413); expect((await expanded.json()).error).toContain("32 MiB");
  history = [{ ...fixture.job, compiledPrompt: randomBytes(4_100_000).toString("base64") }];
  const compressed = await GET(request());
  expect(compressed.status).toBe(413); expect((await compressed.json()).error).toContain("4 MB");
});

test("history read errors reach the caller without a retry or a new submission", async () => {
  let reads = 0;
  await expect(readH3DraftJobs("project/with space", (async (url) => {
    reads++; expect(String(url)).toContain("project%2Fwith%20space");
    return Response.json({ error: "Update the observer transport." }, { status: 413 });
  }) as typeof fetch)).rejects.toThrow("Update the observer transport.");
  expect(reads).toBe(1);
});
