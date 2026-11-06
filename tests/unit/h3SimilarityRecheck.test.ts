import { expect, test } from "bun:test";
import { recheckH3Similarity } from "@/components/studio/h3SimilarityRecheck";
import type { H3GenerationJob } from "@/components/studio/h3Generation";
import { draftSimilarityFixture } from "../helpers/draftSimilarity";

function fixture() {
  const { asset } = draftSimilarityFixture();
  delete asset.identityVerification!.draftSimilarityFilter;
  return { version: 1, id: asset.id, projectId: "75101b25-fea6-42b1-b2c6-85a9d1deb8eb", state: "ready",
    runId: "original-video-render", result: { asset } } as H3GenerationJob;
}

test("rechecks existing bytes once, waits for changed canonical evidence and never starts another render", async () => {
  const job = fixture(), fresh = structuredClone(job), requests: { method?: string; body?: unknown }[] = [];
  fresh.result!.asset.identityVerification = draftSimilarityFixture().asset.identityVerification;
  let reads = 0;
  const asset = await recheckH3Similarity(job, { requestIntentId: "new-recheck-intent", wait: async () => {},
    fetchImpl: (async (_url, init) => {
      requests.push({ method: init?.method ?? "GET", body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
      if (init?.method === "PATCH") return Response.json({ verificationRunId: "cpu-check" });
      return Response.json({ job: ++reads === 1 ? job : fresh });
    }) as typeof fetch });
  expect(asset.identityVerification!.status).toBe("unverifiable");
  expect(asset.identityVerification!.draftSimilarityFilter!.status).toBe("eligible");
  expect(requests).toHaveLength(3);
  expect(requests[0].body).toEqual({ projectId: job.projectId, jobId: job.id, action: "recheck_identity", requestIntentId: "new-recheck-intent" });
  expect(job.runId).toBe("original-video-render");
  expect(requests.some(request => request.method === "POST")).toBe(false);
});

test("uncertain check submission is not repeated and cannot silently deliver stale evidence", async () => {
  let calls = 0, error = "";
  try {
    await recheckH3Similarity(fixture(), { requestIntentId: "intent", fetchImpl: (async () => {
      calls++; return Response.json({ error: "Try later" }, { status: 503 });
    }) as typeof fetch });
  } catch (failure) { error = (failure as Error).message; }
  expect(error).toBe("Try later");
  expect(calls).toBe(1);
});

test("unchanged evidence times out within90seconds and rejected takes never request reassessment", async () => {
  const job = fixture(); let time = 0, calls = 0, error = "";
  const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
    calls++; return Response.json(init?.method === "PATCH" ? { verificationRunId: "cpu-check" } : { job });
  }) as typeof fetch;
  try { await recheckH3Similarity(job, { requestIntentId: "intent", now: () => time, wait: async ms => { time += ms; }, fetchImpl }); }
  catch (failure) { error = (failure as Error).message; }
  expect(error).toContain("still pending");
  expect(time).toBe(90_000);
  const before = calls;
  job.result!.asset.reviewStatus = "rejected";
  try { await recheckH3Similarity(job, { requestIntentId: "intent", fetchImpl }); } catch {}
  expect(calls).toBe(before);
});
