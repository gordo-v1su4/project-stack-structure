import { afterEach, expect, mock, test } from "bun:test";
import { StudioProjectConflictError, type StudioJsonObjectStore } from "@/lib/studioProjectObjectStore";
let user: string | null = "github-owner", exists = true, dispatchFails = false;
let terminal: string | null = null, dispatches = 0, reads = 0;
const objects = new Map<string, { value: unknown; revision: string }>(); let revision = 0;
const source = { bucket: "studio", objectKey: "media-uploads/projects/github-owner/video.mp4", label: "Video" };
const legacy = { bucket: "studio", objectKey: "media-uploads/legacy.mp4", label: "Legacy" };
const storage: StudioJsonObjectStore = {
  async read<T>(key: string) { reads++; return structuredClone(objects.get(key) ?? null) as { value: T; revision: string } | null; },
  async write(key, value, expected) {
    if ((objects.get(key)?.revision ?? null) !== expected) throw new StudioProjectConflictError();
    const next = `"${++revision}"`; objects.set(key, { value: structuredClone(value), revision: next }); return next;
  },
};
mock.module("@/lib/session", () => ({ getSessionUser: async () => user ? { id: user } : null, unauthorizedResponse: () => Response.json({}, { status: 401 }) }));
mock.module("@/lib/studioProjectStore", () => ({ readStudioProject: async () => exists ? { draft: { videoSources: [{ name: "Legacy", storageBucket: legacy.bucket, storagePath: legacy.objectKey }] } } : null }));
mock.module("@/lib/studioProjectObjectStore", () => ({ StudioProjectConflictError, studioProjectObjects: storage, studioMediaStorage: () => ({ bucket: "studio" }) }));
mock.module("@/lib/triggerOrchestration", () => ({ triggerReviewBackfill: async () => { dispatches++; if (dispatchFails) throw new Error("PRIVATE_ERROR"); return { id: "run_parent" }; },
  retrieveTriggerRun: async () => ({ taskIdentifier: "prepare-project-review-videos", isFailed: terminal === "failed", isCancelled: terminal === "cancelled", isCompleted: Boolean(terminal) }) }));
const { GET, POST } = await import("@/app/api/studio/projects/[projectId]/review-preparation/route");
const { readReviewBackfill } = await import("@/lib/reviewBackfillStore");
const id = "00000000-0000-4000-8000-000000000001", context = { params: Promise.resolve({ projectId: "project" }) };
const post = (sources: unknown = [source], intentId = id) => new Request("http://app.test/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ intentId, sources }) });
const get = (headers = {}) => new Request(`http://app.test/api?jobId=${id}`, { headers });
afterEach(() => { user = "github-owner"; exists = true; dispatchFails = false; terminal = null; dispatches = 0; reads = 0; objects.clear(); revision = 0; });
test("authentication and exact-project authorization precede job writes and dispatch", async () => {
  user = null; expect((await GET(get(), context)).status).toBe(401); expect((await POST(post(), context)).status).toBe(401); expect(reads).toBe(0);
  user = "github-owner"; exists = false; expect((await POST(post(), context)).status).toBe(404); expect(objects.size).toBe(0);
  exists = true; expect((await POST(post([{ ...source, bucket: "foreign" }]), context)).status).toBe(400);
  expect((await POST(post([{ ...source, objectKey: "media-uploads/unowned.mp4" }]), context)).status).toBe(403); expect(dispatches).toBe(0);
  expect((await POST(post([legacy]), context)).status).toBe(202);
});
test("uncertain acknowledgement retains the same durable intent and rejects changed sources", async () => {
  dispatchFails = true; const response = await POST(post(), context); expect(response.status).toBe(503); expect(await response.text()).not.toContain("PRIVATE");
  expect((await readReviewBackfill("github-owner", "project", id))?.job.status).toBe("dispatch_unknown");
  expect((await POST(post([legacy]), context)).status).toBe(409);
  dispatchFails = false; expect((await POST(post(), context)).status).toBe(202);
  const body = await (await GET(get(), context)).json(); expect(body.preparation.id).toBe(id); expect(body.preparation.parentRunId).toBe("run_parent");
});
test("compact read-only ETags and terminal reconciliation never claim missing output ready", async () => {
  await POST(post(), context); const response = await GET(get(), context); const etag = response.headers.get("etag")!;
  expect((await GET(get({ "if-none-match": etag }), context)).status).toBe(304); expect(dispatches).toBe(1);
  terminal = "completed"; const job = (await (await GET(get(), context)).json()).preparation;
  expect(job.status).toBe("failed"); expect(job.rows[0].state).toBe("waiting");
  expect((await POST(post(), context)).status).toBe(200); expect(dispatches).toBe(1);
});
test("bounded requests reject malformed intent, too many rows and non-video references", async () => {
  expect((await POST(post([source], "invalid"), context)).status).toBe(400);
  expect((await POST(post(Array.from({ length: 257 }, () => source)), context)).status).toBe(400);
  expect((await POST(post([{ ...source, objectKey: "media-uploads/project.json" }]), context)).status).toBe(400);
  expect(dispatches).toBe(0); expect(objects.size).toBe(0);
});
