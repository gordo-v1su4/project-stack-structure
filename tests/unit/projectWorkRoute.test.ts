import { afterEach, expect, mock, test } from "bun:test";
import { reviewedScenePlanningFixture } from "../helpers/sceneProofPlanning";
import type { SavedStudioProject } from "@/lib/studioProjectStore";

let user: string | null = "github-test", saved: SavedStudioProject | null = null;
let reads = 0, lists = 0, imageReads = 0, failList = false, failImages = false, revision = 0;
mock.module("@/lib/session", () => ({ getSessionUser: async () => user ? { id: user } : null,
  unauthorizedResponse: () => Response.json({}, { status: 401 }) }));
mock.module("@/lib/studioProjectStore", () => ({ readStudioProject: async (owner: string, id: string) => {
  expect(owner).toBe("github-test"); expect(id).toBe("project-1"); reads++; return saved;
} }));
mock.module("@/lib/h3JobStore", () => ({ listH3Jobs: async (owner: string, id: string, signal: AbortSignal) => {
  expect(owner).toBe("github-test"); expect(id).toBe("project-1"); expect(signal.aborted).toBe(false); lists++;
  if (failList) throw new Error("private transport diagnostic");
  return [{ id: `h3-${"a".repeat(64)}`, request: { timelineItemId: saved!.draft.musicVideoProject!.editPlan.timelineItems[0].id,
    sectionId: "scene-1", prompt: "PRIVATE-PROMPT-MUST-NOT-LEAK" }, state: "rendering", updatedAt: "2026-11-11T20:00:00Z", runId: "run_test" }];
} }));
mock.module("@/lib/h3StillJobStore", () => ({ readH3StillJob: async (owner: string, id: string, jobId: string) => {
  expect(owner).toBe("github-test"); expect(id).toBe("project-1"); expect(jobId.startsWith("h3-still-")).toBe(true); imageReads++;
  if (failImages) throw new Error("private object read failure");
  return { state: "ready", updatedAt: "2026-11-11T19:00:00Z", runId: "run_image" };
} }));
const { GET } = await import("@/app/api/studio/projects/[projectId]/work/route");
const context = { params: Promise.resolve({ projectId: "project-1" }) };
const request = (headers = {}) => new Request("http://test/api/studio/projects/project-1/work", { headers });
function fixture() { saved = { ...reviewedScenePlanningFixture().saved, revision: `"work-${++revision}"` }; }
afterEach(() => { user = "github-test"; saved = null; reads = 0; lists = 0; imageReads = 0; failList = false; failImages = false; });

test("queue requires authenticated project ownership before history reads", async () => {
  user = null; expect((await GET(request(), context)).status).toBe(401); expect(reads).toBe(0);
  user = "github-test"; expect((await GET(request(), context)).status).toBe(404);
  expect((await GET(request(), { params: Promise.resolve({ projectId: "../foreign" }) })).status).toBe(404);
  expect(reads).toBe(1); expect(lists).toBe(0); expect(imageReads).toBe(0);
});

test("queue returns compact shot-bound receipts, coalesces reads and reauthorizes ETags", async () => {
  fixture(); const before = JSON.stringify(saved);
  const [first, second] = await Promise.all([GET(request(), context), GET(request(), context)]);
  const body = await first.json();
  expect(body.projectId).toBe("project-1"); expect(body.rows).toHaveLength(7);
  expect(body.rows[0].kind).toBe("video"); expect(body.rows[0].state).toBe("rendering");
  expect(body.rows.filter((r: { kind: string; state: string }) => r.kind === "image" && r.state === "ready")).toHaveLength(6);
  expect(JSON.stringify(body)).not.toContain("PRIVATE-PROMPT"); expect(body.rows[0].request).toBe(undefined);
  expect(lists).toBe(1); expect(imageReads).toBe(6);
  expect(first.headers.get("etag")).toBe(second.headers.get("etag"));
  expect((await GET(request({ "if-none-match": first.headers.get("etag")! }), context)).status).toBe(304);
  user = null; expect((await GET(request(), context)).status).toBe(401);
  expect(lists).toBe(1); expect(JSON.stringify(saved)).toBe(before);
});

test("receipt failures remain explicit without leaking transport details or claiming completion", async () => {
  fixture(); failList = true;
  const failed = await GET(request(), context); expect(failed.status).toBe(503);
  expect(await failed.text()).not.toContain("private transport");
  failList = false; failImages = true;
  const body = await (await GET(request(), context)).json();
  expect(body.partial).toBe(true);
  expect(body.rows.filter((r: { kind: string }) => r.kind === "image").every((r: { state: string }) => r.state === "unavailable")).toBe(true);
});
