import { afterEach, expect, mock, test } from "bun:test";
import { assertReviewVideoSource } from "@/lib/preparedReviewVideoStore";
let user: string | null = "github-fixture", owned = true, ready = false, fail = false;
let authorized = 0, pins = 0, dispatches = 0;
const source = { ownerId: "github-fixture", bucket: "stack-structure", objectKey: "media-uploads/projects/github-fixture/clips/source.mp4", etag: '"version"', bytes: 100 };
mock.module("@/lib/session", () => ({ getSessionUser: async () => user ? { id: user } : null, unauthorizedResponse: () => Response.json({ error: "Sign in" }, { status: 401 }) }));
mock.module("@/lib/studioMediaAccess", () => ({ canReadMediaObject: async () => { authorized++; return owned; } }));
mock.module("@/lib/studioProjectObjectStore", () => ({ studioMediaStorage: () => ({ bucket: "stack-structure" }) }));
mock.module("@/lib/preparedReviewVideoStore", () => ({ assertReviewVideoSource,
  pinReviewVideoSource: async (ownerId: string) => { pins++; if (fail) throw new Error("PRIVATE_STORAGE_DIAGNOSTIC"); return { ...source, ownerId }; },
  readPreparedReviewVideo: async () => ready ? { fixture: "prepared" } : null }));
mock.module("@/lib/triggerOrchestration", () => ({ triggerReviewVideo: async (value: typeof source, intent: string) => {
  expect(value.ownerId).toBe(user!); expect(intent).toBe("f60c0142-6f93-46b4-a663-ef7c8bc0f74c"); dispatches++; return { id: "run-review" };
} }));
const { GET, POST } = await import("@/app/api/storage/review-video/route");
afterEach(() => { user = "github-fixture"; owned = true; ready = false; fail = false; authorized = 0; pins = 0; dispatches = 0; });
const input = { bucket: source.bucket, objectKey: source.objectKey, intentId: "f60c0142-6f93-46b4-a663-ef7c8bc0f74c" };
const request = (body: unknown = input) => new Request("http://localhost/api/storage/review-video", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const get = () => new Request(`http://localhost/api/storage/review-video?${new URLSearchParams({ bucket: source.bucket, objectKey: source.objectKey })}`);
test("auth and ownership precede storage and dispatch", async () => {
  user = null; expect((await POST(request())).status).toBe(401); expect((await GET(get())).status).toBe(401);
  expect(authorized).toBe(0); expect(pins).toBe(0);
  user = "github-fixture"; owned = false; expect((await POST(request())).status).toBe(403); expect(pins).toBe(0); expect(dispatches).toBe(0);
});
test("GET never starts work; ready POST reuses the stored result", async () => {
  expect(await (await GET(get())).json()).toEqual({ status: "unprepared" }); expect(dispatches).toBe(0);
  ready = true; const response = await POST(request()); expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: "ready", prepared: { fixture: "prepared" } }); expect(dispatches).toBe(0);
});
test("POST queues a pinned source and returns an honest acknowledgment", async () => {
  const response = await POST(request({ ...input, ownerId: "victim", etag: "forged", bytes: 1 }));
  expect(response.status).toBe(202); expect(await response.json()).toEqual({ status: "queued", orchestration: "trigger.dev", runId: "run-review" });
  expect(dispatches).toBe(1); expect(response.headers.get("cache-control")).toBe("private, no-store");
});
test("rejects metadata, traversal, other buckets, missing intent and oversized bodies", async () => {
  for (const body of [{ ...input, objectKey: "media-uploads/projects/github-fixture/project.json" }, { ...input, objectKey: "media-uploads/../source.mp4" },
    { ...input, intentId: undefined }, { ...input, padding: "x".repeat(4096) }, { ...input, bucket: "other" }]) expect((await POST(request(body))).status).toBe(400);
  expect(pins).toBe(0); expect(dispatches).toBe(0);
  fail = true; const response = await POST(request()); expect(response.status).toBe(503); expect(await response.text()).not.toContain("PRIVATE");
});
