import { afterEach, expect, mock, test } from "bun:test";
import { reviewedScenePlanningFixture } from "../helpers/sceneProofPlanning";
import type { SavedStudioProject } from "@/lib/studioProjectStore";
import { animaticContextSha256 } from "@/components/studio/stillAnimatic";
let signedIn = true, reads = 0;
let saved: SavedStudioProject | null = null;
mock.module("@/lib/session", () => ({ getSessionUser: async () => signedIn ? { id: "github-test" } : null,
  unauthorizedResponse: () => Response.json({}, { status: 401 }) }));
mock.module("@/lib/studioProjectStore", () => ({ readStudioProject: async (owner: string, project: string, options: { fresh: boolean }) => {
  reads++; expect(owner).toBe("github-test"); expect(project).toBe("project-1"); expect(options.fresh).toBe(true); return saved;
} }));
const { GET } = await import("@/app/api/studio/projects/[projectId]/preview/route");
const context = { params: Promise.resolve({ projectId: "project-1" }) };
const request = (headers = {}) => new Request("http://app.test/api/studio/projects/project-1/preview", { headers });
afterEach(() => { signedIn = true; reads = 0; saved = null; });

test("preview projection rejects anonymous or missing-owned projects without a write path", async () => {
  signedIn = false; expect((await GET(request(), context)).status).toBe(401); expect(reads).toBe(0);
  signedIn = true; expect((await GET(request(), context)).status).toBe(404);
  expect((await GET(request(), { params: Promise.resolve({ projectId: "../other" }) })).status).toBe(404); expect(reads).toBe(1);
});

test("revision ETags observe the owned fresh project and omit unchanged content", async () => {
  saved = { ...reviewedScenePlanningFixture().saved, revision: '"current"' };
  const response = await GET(request({ "if-none-match": '"current"' }), context);
  expect(response.status).toBe(304); expect(await response.text()).toBe(""); expect(response.headers.get("etag")).toBe('"current"');
  expect(reads).toBe(1);
});

test("projection returns current context and durable master without unrelated draft or archived history", async () => {
  const f = reviewedScenePlanningFixture(), input = f.source();
  const plan = { version: 1 as const, projectId: "project-1", contextSha256: animaticContextSha256(input), fps: 24,
    masterDuration: 10, totalFrames: 240, shots: [{ id: "A001", sceneId: "S01", title: "Opening", sourceTimelineItemId: "old-item",
      startFrame: 0, endFrame: 240, prompt: "[Static] Wide shot.", referenceAssetIds: ["club"] }] };
  f.saved.draft.storyState.stillAnimaticPlan = { ...plan, priorVersions: [{ ...plan, archivedAt: new Date().toISOString() }] };
  f.saved.draft.analysis = { ...f.saved.draft.analysis!, sourceLabel: "Master.wav", storageBucket: "studio", storagePath: "media-uploads/github-test/master.wav" };
  saved = { ...f.saved, revision: '"new"' };
  const before = JSON.stringify(saved), response = await GET(request(), context), body = await response.json();
  expect(response.status).toBe(200); expect(body.plan.shots).toHaveLength(1); expect(body.plan.priorVersions).toBe(undefined);
  expect(body.audioUrl).toBe("/api/storage/media?bucket=studio&objectKey=media-uploads%2Fgithub-test%2Fmaster.wav");
  expect(body.contextSha256).toBe(animaticContextSha256(input)); expect(body.draft).toBe(undefined); expect(body.referenceAssets).toBe(undefined);
  expect(body.cut.segments).toHaveLength(1);
  expect(body.cut.segments[0].kind).toBe("gap");
  expect(body.cut.selectedVideoCount).toBe(0);
  expect(body.cut.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(saved)).toBe(before);
  f.saved.draft.storyState.stillAnimaticPlan.shots[0].endFrame = 239;
  expect((await GET(request(), context)).status).toBe(503);
});
