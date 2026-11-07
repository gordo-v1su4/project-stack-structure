import { describe, expect, mock, test } from "bun:test";
import { gzipSync } from "node:zlib";
import type { PersistedStudioProjectDraft } from "@/components/studio/projectPersistence";
import type { SavedStudioProject } from "@/lib/studioProjectStore";
import { encodeStudioJsonRequest, STUDIO_JSON_MAX_EXPANDED_BYTES, STUDIO_JSON_MAX_WIRE_BYTES, STUDIO_JSON_TRANSPORT_HEADERS } from "@/lib/studioJsonTransport";
import { readStudioJsonBody } from "@/lib/studioJsonTransportServer";
import { ACTIVE_STUDIO_PROJECT_KEY, STUDIO_PROJECT_STORAGE_KEY, loadSavedStudioProject, saveNamedStudioProject } from "@/components/studio/projectPersistence";

let signedIn = true, saves = 0, draftUploads = 0;
let stored: SavedStudioProject | null = null;
mock.module("@/auth", () => ({ auth: async () => signedIn ? { user: { id: "owner-1" } } : null }));
mock.module("@/lib/session", () => ({
  getSessionUser: async () => signedIn ? { id: "owner-1" } : null,
  unauthorizedResponse: () => Response.json({ success: false }, { status: 401 }),
}));
mock.module("@/lib/studioProjectStore", () => ({
  createStudioProjectId: () => "project-1", listStudioProjects: async () => [],
  readStudioProject: async (ownerId: string, projectId: string) => ownerId === "owner-1" && projectId === "project-1" ? stored : null,
  saveStudioProject: async (input: { ownerId: string; projectId: string; name: string; draft: PersistedStudioProjectDraft }) => {
    saves++;
    stored = { version: 1, project: { id: input.projectId, name: input.name, ownerId: input.ownerId }, draft: input.draft, revision: '"test-base"' } as SavedStudioProject;
    return stored;
  },
}));
mock.module("@/lib/mediaGateway", () => ({
  normalizeMediaPath: (value: string) => value, getMediaGatewayConfig: () => null,
  buildMediaGatewayFileUrl: () => "https://media.invalid/unused",
  uploadJsonToMediaGateway: async () => { draftUploads++; return { storagePath: "media-uploads/studio-drafts/owner-1.json" }; },
}));
const projects = await import("@/app/api/studio/projects/route");
const project = await import("@/app/api/studio/projects/[projectId]/route");
const draftRoute = await import("@/app/api/studio/draft/route");
const context = { params: Promise.resolve({ projectId: "project-1" }) };
const url = "http://app.test/api/studio/projects/project-1";
const smallDraft = { version: 3, storyState: { storyBeats: [] }, videoSources: [] } as unknown as PersistedStudioProjectDraft;
function reset() { signedIn = true; saves = 0; draftUploads = 0; stored = { version: 1, project: { id: "project-1", ownerId: "owner-1", name: "Film" }, draft: smallDraft, revision: '"test-base"' } as SavedStudioProject; }
function request(body: BodyInit, headers: HeadersInit = {}, method = "PUT") {
  const versionedHeaders = new Headers(headers);
  if (method === "PUT") versionedHeaders.set("if-match", '"test-base"');
  return new Request(url, { method, headers: versionedHeaders, body });
}
async function decode(response: Response) {
  if (response.headers.get("content-encoding") !== "gzip") return response.json();
  return new Response(response.body!.pipeThrough(new DecompressionStream("gzip"))).json();
}

describe("bounded authenticated project JSON transport", () => {
  test("a delayed export save ACK cannot switch this tab back to the old project", async () => {
    const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window"), oldFetch = globalThis.fetch;
    const mirror = new Map([[ACTIVE_STUDIO_PROJECT_KEY, "project-old"], [STUDIO_PROJECT_STORAGE_KEY, "old draft"]]);
    Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: {
      setItem: (key: string, value: string) => mirror.set(key, value), removeItem: (key: string) => mirror.delete(key),
    } } });
    let acknowledge!: (response: Response) => void, markEntered!: () => void;
    const entered = new Promise<void>(resolve => { markEntered = resolve; });
    globalThis.fetch = (() => { markEntered(); return new Promise<Response>(resolve => { acknowledge = resolve; }); }) as typeof fetch;
    try {
      const pending = saveNamedStudioProject({ projectId: "project-old", name: "Old film", draft: smallDraft, expectedRevision: '"test-base"' }, { cache: false });
      await entered;
      mirror.set(ACTIVE_STUDIO_PROJECT_KEY, "project-new"); mirror.set(STUDIO_PROJECT_STORAGE_KEY, "new draft");
      acknowledge(Response.json({ success: true, saved: { version: 1, project: { id: "project-old" }, draft: smallDraft, revision: '"test-next"' } }));
      expect((await pending).project.id).toBe("project-old");
      expect(mirror.get(ACTIVE_STUDIO_PROJECT_KEY)).toBe("project-new");
      expect(mirror.get(STUDIO_PROJECT_STORAGE_KEY)).toBe("new draft");
    } finally {
      globalThis.fetch = oldFetch;
      if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow); else Reflect.deleteProperty(globalThis, "window");
    }
  });
  test("round trips a multi-megabyte 21-source project without removing story or accepted placements", async () => {
    reset();
    const accepted = Array.from({ length: 13 }, (_, id) => ({ id: `accepted-${id}`, sourceStart: id * 0.137, songStart: id * 2.7 }));
    const draft = { ...smallDraft,
      storyState: { brief: { text: "The approved story and continuity remain intact. ".repeat(110_000) } },
      videoSources: Array.from({ length: 21 }, (_, id) => ({ id, name: `clip-${id}.mp4`, scenes: [{ caption: `Scene ${id} retained.` }] })),
      musicVideoProject: { placementPlan: { placements: accepted } },
    };
    expect(new TextEncoder().encode(JSON.stringify(draft)).byteLength).toBeGreaterThan(4_500_000);
    const encoded = await encodeStudioJsonRequest({ name: "Existing film", draft });
    expect(encoded.headers["content-encoding"]).toBe("gzip");
    expect((encoded.body as ArrayBuffer).byteLength).toBeLessThan(STUDIO_JSON_MAX_WIRE_BYTES);
    const created = await projects.POST(request(encoded.body, encoded.headers, "POST"));
    expect(created.status).toBe(201); expect(created.headers.get("content-encoding")).toBe("gzip");
    expect((await decode(created)).saved.draft).toEqual(draft);
    const updated = await project.PUT(request(encoded.body, encoded.headers), context);
    expect(updated.status).toBe(200); expect((await decode(updated)).saved.draft.musicVideoProject.placementPlan.placements).toEqual(accepted);
    const loaded = await project.GET(new Request(url, { headers: STUDIO_JSON_TRANSPORT_HEADERS }), context);
    expect((await decode(loaded)).saved.draft).toEqual(draft);
    expect(saves).toBe(2);
  });

  test("keeps ordinary JSON callers and validation compatible", async () => {
    reset();
    const response = await project.PUT(request(JSON.stringify({ draft: smallDraft }), { "content-type": "application/json" }), context);
    expect(response.status).toBe(200); expect(response.headers.get("content-encoding")).toBe(null);
    expect((await response.json()).saved.draft).toEqual(smallDraft);
    for (const invalid of [null, {}, { draft: {} }, { draft: [] }]) {
      expect((await project.PUT(request(JSON.stringify(invalid)), context)).status).toBe(400);
    }
    expect(saves).toBe(1);
  });

  test("all save routes reject anonymous input before accessing the body", async () => {
    reset(); signedIn = false;
    let bodyReads = 0;
    function unreadable() {
      const input = request("invalid compressed bytes", { "content-encoding": "gzip" });
      Object.defineProperty(input, "body", { get() { bodyReads++; throw new Error("Anonymous body was read"); } });
      return input;
    }
    expect((await projects.POST(unreadable())).status).toBe(401);
    expect((await project.PUT(unreadable(), context)).status).toBe(401);
    expect((await draftRoute.PUT(unreadable())).status).toBe(401);
    expect((await draftRoute.POST(unreadable())).status).toBe(401);
    expect(bodyReads).toBe(0); expect(saves).toBe(0); expect(draftUploads).toBe(0);
  });

  test("invalid encodings, gzip, UTF-8 and JSON return 400 without writes", async () => {
    reset();
    const invalid = [
      request("no", { "content-encoding": "br" }), request("no", { "content-encoding": "gzip" }),
      request(gzipSync("not JSON"), { "content-encoding": "gzip" }), request(new Uint8Array([255, 255])),
      request("{"),
    ];
    for (const input of invalid) expect((await project.PUT(input, context)).status).toBe(400);
    expect(saves).toBe(0);
  });

  test("oversized streamed input and gzip expansion return 413 without writes", async () => {
    reset();
    expect((await project.PUT(request(new Uint8Array(STUDIO_JSON_MAX_WIRE_BYTES + 1)), context)).status).toBe(413);
    expect((await projects.POST(request("{}", { "content-length": String(STUDIO_JSON_MAX_WIRE_BYTES + 1) }, "POST"))).status).toBe(413);
    const bomb = gzipSync("x".repeat(STUDIO_JSON_MAX_EXPANDED_BYTES + 1));
    expect(bomb.byteLength).toBeLessThan(STUDIO_JSON_MAX_WIRE_BYTES);
    expect((await project.PUT(request(bomb, { "content-encoding": "gzip" }), context)).status).toBe(413);
    expect(saves).toBe(0);
  });

  test("browser encoder rejects expanded overflow before issuing a request", async () => {
    let message = "";
    try { await encodeStudioJsonRequest({ data: "x".repeat(STUDIO_JSON_MAX_EXPANDED_BYTES) }); }
    catch (error) { message = (error as Error).message; }
    expect(message).toContain("32 MiB");
  });

  test("compressed legacy draft saves retain their ownership pointer cookie", async () => {
    reset();
    const environment = process.env as Record<string, string | undefined>;
    const previous = environment.NODE_ENV;
    environment.NODE_ENV = "production";
    try {
      const encoded = await encodeStudioJsonRequest({ draft: { ...smallDraft, storyState: { brief: { text: "keep ".repeat(20_000) } } } });
      const response = await draftRoute.PUT(request(encoded.body, encoded.headers));
      expect(response.status).toBe(200);
      expect(response.headers.get("set-cookie")).toContain("HttpOnly");
      expect(response.headers.get("set-cookie")).toContain("Secure");
      expect((await decode(response)).draft.videoSources).toEqual([]);
      expect(draftUploads).toBe(1);
    } finally { if (previous === undefined) delete environment.NODE_ENV; else environment.NODE_ENV = previous; }
  });

  test("browser save/load uses compressed transport and survives an exhausted local mirror quota", async () => {
    reset();
    const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const oldFetch = globalThis.fetch;
    const mirror = new Map([[STUDIO_PROJECT_STORAGE_KEY, "stale previous draft"]]);
    Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: {
      setItem: (key: string, value: string) => {
        if (key === STUDIO_PROJECT_STORAGE_KEY) throw new DOMException("Quota full", "QuotaExceededError");
        mirror.set(key, value);
      }, removeItem: (key: string) => mirror.delete(key),
    } } });
    const draft = { ...smallDraft, storyState: { brief: { text: "approved story ".repeat(10_000) } } } as unknown as PersistedStudioProjectDraft;
    let savesThroughClient = 0, loadsThroughClient = 0;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("x-studio-json-transport")).toBe("gzip");
      if (init?.method === "PUT") {
        expect(new Headers(init.headers).get("content-encoding")).toBe("gzip");
        const received = await readStudioJsonBody(new Request(url, init)) as { draft: unknown };
        expect(received.draft).toEqual(draft); savesThroughClient++;
      } else loadsThroughClient++;
      return Response.json({ success: true, saved: { version: 1, project: { id: "project-1" }, draft, revision: '"test-next"' } });
    }) as typeof fetch;
    try {
      expect((await saveNamedStudioProject({ projectId: "project-1", name: "Existing film", draft, expectedRevision: '"test-base"' })).draft).toEqual(draft);
      expect((await loadSavedStudioProject("project-1")).draft).toEqual(draft);
      expect(savesThroughClient).toBe(1); expect(loadsThroughClient).toBe(1);
      expect(mirror.get(ACTIVE_STUDIO_PROJECT_KEY)).toBe("project-1");
      expect(mirror.has(STUDIO_PROJECT_STORAGE_KEY)).toBe(false);
    } finally {
      globalThis.fetch = oldFetch;
      if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow); else Reflect.deleteProperty(globalThis, "window");
    }
  });
});
