import { afterEach, expect, mock, test } from "bun:test";
import { StudioProjectConflictError } from "@/lib/studioProjectObjectStore";
import type { EditPlanPreviewSegment } from "@/components/studio/musicVideoProject";

let user: string | null = "github-test", owned = true, reads = 0, writes = 0, fail = false;
let value: unknown = null, revision: string | null = null;
const base: EditPlanPreviewSegment = { kind: "gap", videoUrl: "", startTime: 0, endTime: 2, musicStart: 0, musicEnd: 2,
  planSignature: "plan", timelineItemId: "animatic:A001", animaticShotId: "A001", sectionId: "verse", label: "A001" };
mock.module("@/lib/session", () => ({ getSessionUser: async () => user ? { id: user } : null, unauthorizedResponse: () => Response.json({}, { status: 401 }) }));
mock.module("@/lib/studioProjectStore", () => ({ readStudioProject: async (owner: string, id: string) => {
  expect(owner).toBe("github-test"); expect(id).toBe("project-1");
  return owned ? { project: { id, ownerId: owner }, draft: { storyState: {} } } : null;
} }));
mock.module("@/lib/projectReviewCut", () => ({ projectReviewInputs: () => ({ base: [base] }) }));
mock.module("@/lib/studioProjectObjectStore", () => ({ StudioProjectConflictError, studioProjectObjects: {
  async read() { reads++; if (fail) throw new Error("PRIVATE STORAGE DIAGNOSTIC"); return value ? { value, revision } : null; },
  async write(_key: string, next: unknown, expected: string | null) { if (expected !== revision) throw new StudioProjectConflictError(); value = next; revision = `"r${++writes}"`; return revision; },
} }));
const { GET, POST } = await import("@/app/api/studio/projects/[projectId]/replacement-review/route");
const context = { params: Promise.resolve({ projectId: "project-1" }) };
function request(body?: unknown, contentType = "application/json") { return new Request("https://studio.test/api/studio/projects/project-1/replacement-review", body === undefined ? {} : { method: "POST", headers: { "content-type": contentType }, body: JSON.stringify(body) }); }
afterEach(() => { user = "github-test"; owned = true; reads = 0; writes = 0; fail = false; value = null; revision = null; });

test("review metadata requires authentication and project ownership before any artifact read/write", async () => {
  user = null; expect((await GET(request(), context)).status).toBe(401); expect((await POST(request({}), context)).status).toBe(401);
  user = "github-test"; owned = false; expect((await GET(request(), context)).status).toBe(404); expect((await POST(request({}), context)).status).toBe(404);
  expect(reads).toBe(0); expect(writes).toBe(0);
});

test("explicit marks survive reread; stale CAS and stale target writes cannot overwrite them", async () => {
  const initial = await (await GET(request(), context)).json(), key = initial.targets[0].key;
  const op = { revision: null, operation: { action: "mark", keys: [key] } };
  const marked = await POST(request(op), context); expect(marked.status).toBe(200);
  const body = await marked.json(); expect(body.marks[0].shotId).toBe("A001"); expect(body.revision).toBe('"r1"');
  expect((await POST(request(op), context)).status).toBe(409);
  expect((await POST(request({ revision, operation: { action: "mark", keys: ["foreign-target"] } }), context)).status).toBe(400);
  expect((await (await GET(request(), context)).json()).marks).toEqual(body.marks); expect(writes).toBe(1);
});

test("JSON-only writes and safe storage failures preserve marks and never report generation", async () => {
  expect((await POST(request({}, "text/plain"), context)).status).toBe(415);
  expect((await POST(request({ operation: { action: "mark", keys: [] } }), context)).status).toBe(400);
  expect((await POST(request({ revision: null, padding: "x".repeat(2 * 1024 * 1024) }), context)).status).toBe(400);
  fail = true; const response = await GET(request(), context); expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("PRIVATE"); expect(writes).toBe(0);
});
