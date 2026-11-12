import { afterEach, expect, mock, test } from "bun:test";
import type { PersistedStudioProjectDraft } from "@/components/studio/projectPersistence";

const objects = new Map<string, { body: string; etag: string }>();
const writes: Record<string, unknown>[] = [];
let serial = 0, loseAckFor: string | undefined, rejectIndexWrites = false;
let authenticated = true;
let rejectMigration = false;
let migrationValidation: { ownerId: string; projectId: string; expectedRevision: string } | undefined;
class SourceConfirmationError extends Error { status = 409; }
mock.module("@/lib/generationScopeServer", () => ({ SourceConfirmationError }));
mock.module("@/lib/referenceMigrationServer", () => ({
  validateReferenceMigrationAdoption: async (ownerId: string, current: { project: { id: string } }, _candidate: unknown, expectedRevision: string) => {
    migrationValidation = { ownerId, projectId: current.project.id, expectedRevision };
    if (rejectMigration) throw new SourceConfirmationError("Canonical migration differs.");
  },
}));
class GetObjectCommand { constructor(public input: Record<string, unknown>) {} }
class PutObjectCommand { constructor(public input: Record<string, unknown>) {} }
const failure = (code: number) => Object.assign(Error(`S3 ${code}`), { $metadata: { httpStatusCode: code } });
class S3Client {
  constructor(options: { maxAttempts: number }) { expect(options.maxAttempts).toBe(1); }
  destroy() {}
  async send(command: GetObjectCommand | PutObjectCommand) {
    const input = command.input, key = String(input.Key), current = objects.get(key);
    if (command instanceof GetObjectCommand) {
      if (!current) throw failure(404);
      return { ETag: current.etag, ContentLength: Buffer.byteLength(current.body), Body: { transformToString: async () => current.body } };
    }
    writes.push(input);
    if (rejectIndexWrites && key.endsWith("/index.json")) throw failure(412);
    if ((input.IfNoneMatch === "*" && current) || (input.IfMatch && input.IfMatch !== current?.etag)) throw failure(412);
    expect(Boolean(input.IfMatch) !== Boolean(input.IfNoneMatch)).toBe(true);
    const etag = `"v${++serial}"`; objects.set(key, { body: String(input.Body), etag });
    if (key === loseAckFor) { loseAckFor = undefined; throw Error("Acknowledgment lost after commit"); }
    return { ETag: etag };
  }
}
mock.module("@aws-sdk/client-s3", () => ({ GetObjectCommand, PutObjectCommand, S3Client }));
mock.module("@/lib/mediaGateway", () => ({
  getMediaGatewayConfig: () => ({ bucket: "studio", url: "https://media.example", token: "test-only" }),
  buildMediaGatewayFileUrl: (_config: unknown, bucket: string, key: string) => `https://media.example/${bucket}/${key}`,
  normalizeMediaPath: (path: string) => path.replace(/^\/+|\/+$/g, ""),
}));
mock.module("@/auth", () => ({ auth: async () => authenticated ? { user: { id: "github-test" } } : null }));
const { saveStudioProject, readStudioProject, listStudioProjects, setStudioProjectDeleted } = await import("@/lib/studioProjectStore");
const { mergeStudioProjectIndex, studioProjectObjects } = await import("@/lib/studioProjectObjectStore");
const { PUT, GET, DELETE, POST: restoreProject } = await import("@/app/api/studio/projects/[projectId]/route");
const { POST } = await import("@/app/api/studio/projects/route");
const originalFetch = globalThis.fetch;
const names = ["NODE_ENV", "RUSTFS_S3_ENDPOINT", "RUSTFS_ACCESS_KEY", "RUSTFS_SECRET_KEY"] as const;
const oldEnv = Object.fromEntries(names.map(name => [name, process.env[name]]));
const draft = (label: string) => ({ version: 3, savedAt: "input", videoSources: [], storyState: { storyBeats: [] }, referenceAssets: [{ id: label }] }) as unknown as PersistedStudioProjectDraft;
const ownerId = "github-test", projectId = "film", key = `media-uploads/projects/${ownerId}/${projectId}/project.json`, indexKey = `media-uploads/projects/${ownerId}/index.json`;

function setup() {
  objects.clear(); writes.length = 0; serial = 0; loseAckFor = undefined; rejectIndexWrites = false; authenticated = true;
  rejectMigration = false; migrationValidation = undefined;
  Object.assign(process.env, { NODE_ENV: "production" }); process.env.RUSTFS_S3_ENDPOINT = "https://storage.example";
  process.env.RUSTFS_ACCESS_KEY = "test-only-access"; process.env.RUSTFS_SECRET_KEY = "test-only-secret";
  globalThis.fetch = (async input => {
    const objectKey = new URL(String(input)).pathname.slice("/studio/".length), object = objects.get(objectKey);
    return object ? new Response(object.body) : new Response("missing", { status: 404 });
  }) as typeof fetch;
}
afterEach(() => { globalThis.fetch = originalFetch; for (const name of names) { if (oldEnv[name] === undefined) Reflect.deleteProperty(process.env, name); else Object.assign(process.env, { [name]: oldEnv[name] }); } });

test("same-base writers cannot erase one another's reference edits", async () => {
  setup();
  const created = await saveStudioProject({ ownerId, projectId, name: "Film", draft: draft("initial"), expectedRevision: null });
  const results = await Promise.allSettled([
    saveStudioProject({ ownerId, projectId, name: "Film", draft: draft("new-crowds"), expectedRevision: created.revision }),
    saveStudioProject({ ownerId, projectId, name: "Film", draft: draft("obsolete-tab"), expectedRevision: created.revision }),
  ]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
  const winner = results.find(result => result.status === "fulfilled")!;
  if (winner.status !== "fulfilled") throw Error("missing winner");
  expect((await readStudioProject(ownerId, projectId, { fresh: true }))?.draft).toEqual(winner.value.draft);
  expect(JSON.parse(objects.get(key)!.body).revision).toBe(undefined);
});

test("Trash hides only the chosen project, retains its draft, and can restore it", async () => {
  setup();
  const created = await saveStudioProject({ ownerId, projectId, name: "Film", draft: draft("retained"), expectedRevision: null });
  const other = await saveStudioProject({ ownerId, projectId: "other", name: "Keep", draft: draft("other"), expectedRevision: null });
  await setStudioProjectDeleted({ ownerId, projectId, deleted: true, expectedRevision: created.revision });
  expect((await listStudioProjects(ownerId)).map(project => project.id)).toEqual([other.project.id]);
  expect((await listStudioProjects(ownerId, { deleted: true })).map(project => project.id)).toEqual([projectId]);
  expect(await readStudioProject(ownerId, projectId, { fresh: true })).toBeNull();
  expect(JSON.parse(objects.get(key)!.body).draft).toEqual(created.draft);
  await expect(saveStudioProject({ ownerId, projectId, name: "Old tab", draft: draft("obsolete"), expectedRevision: created.revision })).rejects.toThrow("Trash");
  await setStudioProjectDeleted({ ownerId, projectId, deleted: false });
  expect((await readStudioProject(ownerId, projectId, { fresh: true }))?.draft).toEqual(created.draft);
  expect(await listStudioProjects(ownerId, { deleted: true })).toEqual([]);
});

test("delete requires the current revision and cannot delete another owner's project", async () => {
  setup();
  const created = await saveStudioProject({ ownerId, projectId, name: "Film", draft: draft("first"), expectedRevision: null });
  await saveStudioProject({ ownerId, projectId, name: "Film", draft: draft("fresh"), expectedRevision: created.revision });
  await expect(setStudioProjectDeleted({ ownerId, projectId, deleted: true, expectedRevision: created.revision })).rejects.toThrow();
  expect(await setStudioProjectDeleted({ ownerId: "github-other", projectId, deleted: true, expectedRevision: created.revision })).toBeNull();
  expect((await readStudioProject(ownerId, projectId, { fresh: true }))?.draft.referenceAssets?.[0]?.id).toBe("fresh");
});

test("delete and restore routes reject anonymous callers before writes", async () => {
  setup(); authenticated = false;
  const context = { params: Promise.resolve({ projectId }) };
  expect((await DELETE(new Request("https://app.example/api/studio/projects/film", { method: "DELETE" }), context)).status).toBe(401);
  expect((await restoreProject(new Request("https://app.example/api/studio/projects/film", { method: "POST" }), context)).status).toBe(401);
  expect(writes).toHaveLength(0);
});

test("same-ID creates with different names claim one deterministic object", async () => {
  setup();
  const results = await Promise.allSettled([
    saveStudioProject({ ownerId, projectId, name: "First name", draft: draft("first"), expectedRevision: null }),
    saveStudioProject({ ownerId, projectId, name: "Other name", draft: draft("other"), expectedRevision: null }),
  ]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect([...objects.keys()].filter(path => path.endsWith("/project.json"))).toEqual([key]);
  const actual = await readStudioProject(ownerId, projectId, { fresh: true });
  expect(actual?.project.name).toBe(JSON.parse(objects.get(key)!.body).project.name);
});

test("an old client without If-Match is rejected before any write", async () => {
  setup();
  await saveStudioProject({ ownerId, projectId, name: "Film", draft: draft("kept"), expectedRevision: null });
  const count = writes.length;
  const response = await PUT(new Request("https://app.example/api/studio/projects/film", { method: "PUT", body: JSON.stringify({ name: "Film", draft: draft("old") }) }), { params: Promise.resolve({ projectId }) });
  expect(response.status).toBe(428); expect(writes.length).toBe(count);
});

test("project PUT validates reference adoption before its conditional write", async () => {
  setup();
  const created = await saveStudioProject({ ownerId, projectId, name: "Film", draft: draft("kept"), expectedRevision: null });
  const before = objects.get(key)!.body, count = writes.length;
  rejectMigration = true;
  const response = await PUT(new Request("https://app.example/api/studio/projects/film", {
    method: "PUT", headers: { "if-match": created.revision! }, body: JSON.stringify({ draft: draft("invalid-migration") }),
  }), { params: Promise.resolve({ projectId }) });
  expect(response.status).toBe(409);
  expect((await response.json()).code).toBe("REFERENCE_MIGRATION_INVALID");
  expect(migrationValidation).toEqual({ ownerId, projectId, expectedRevision: created.revision! });
  expect(writes.length).toBe(count); expect(objects.get(key)!.body).toBe(before);
});

test("a stale project revision is rejected before reference adoption validation", async () => {
  setup();
  const created = await saveStudioProject({ ownerId, projectId, name: "Film", draft: draft("initial"), expectedRevision: null });
  await saveStudioProject({ ownerId, projectId, name: "Film", draft: draft("winner"), expectedRevision: created.revision });
  const count = writes.length;
  const response = await PUT(new Request("https://app.example/api/studio/projects/film", {
    method: "PUT", headers: { "if-match": created.revision! }, body: JSON.stringify({ draft: draft("obsolete") }),
  }), { params: Promise.resolve({ projectId }) });
  expect(response.status).toBe(409); expect(migrationValidation).toBe(undefined); expect(writes.length).toBe(count);
});

test("auth remains first and another owner cannot read a record", async () => {
  setup();
  await saveStudioProject({ ownerId, projectId, name: "Film", draft: draft("kept"), expectedRevision: null });
  authenticated = false;
  expect((await PUT(new Request("https://app.example", { method: "PUT", body: "invalid" }), { params: Promise.resolve({ projectId }) })).status).toBe(401);
  expect(await readStudioProject("github-other", projectId, { fresh: true })).toBeNull();
});

test("lost create ACK still leaves an exact ID readable before any index exists", async () => {
  setup();
  loseAckFor = key;
  await expect(saveStudioProject({ ownerId, projectId, name: "Film", draft: draft("committed"), expectedRevision: null })).rejects.toThrow("Acknowledgment lost");
  expect(objects.has(indexKey)).toBe(false);
  const response = await GET(new Request("https://app.example"), { params: Promise.resolve({ projectId }) });
  expect(response.status).toBe(200); expect((await response.json()).saved.draft.referenceAssets[0].id).toBe("committed");
  const before = objects.get(key)!.body;
  await expect(saveStudioProject({ ownerId, projectId, name: "Other", draft: draft("replay"), expectedRevision: null })).rejects.toThrow("already exists");
  expect(objects.get(key)!.body).toBe(before);
});

test("POST propagates postcommit index conflicts as uncertain failures, never rejected project writes", async () => {
  setup(); rejectIndexWrites = true;
  const error = await POST(new Request("https://app.example/api/studio/projects", {
    method: "POST", body: JSON.stringify({ projectId, name: "Recovery copy", draft: draft("committed") }),
  }))
    .then(() => null, error => error as Error);
  expect(error?.message).toContain("index acknowledgment could not be confirmed");
  expect(error?.name).toBe("Error");
  expect(error?.cause).toBeInstanceOf((await import("@/lib/studioProjectObjectStore")).StudioProjectConflictError);
  expect(writes.filter(write => write.Key === key)).toHaveLength(1);
  expect(writes.filter(write => write.Key === indexKey)).toHaveLength(5);
  const response = await GET(new Request("https://app.example"), { params: Promise.resolve({ projectId }) });
  expect(response.status).toBe(200);
  const recovered = (await response.json()).saved;
  expect(recovered.project.name).toBe("Recovery copy");
  expect(recovered.draft.referenceAssets[0].id).toBe("committed");
  expect(objects.has(indexKey)).toBe(false);
});

test("index CAS preserves different concurrent projects", async () => {
  setup();
  const stamp = "2026-11-07T00:00:00.000Z";
  await Promise.all([
    mergeStudioProjectIndex(studioProjectObjects, indexKey, async () => ({ id: "a", updatedAt: stamp })),
    mergeStudioProjectIndex(studioProjectObjects, indexKey, async () => ({ id: "b", updatedAt: stamp })),
  ]);
  expect(JSON.parse(objects.get(indexKey)!.body).projects.map((project: { id: string }) => project.id).sort()).toEqual(["a", "b"]);
});

test("a canonical project remains readable during an index gateway outage", async () => {
  setup();
  await saveStudioProject({ ownerId, projectId, name: "Film", draft: draft("kept"), expectedRevision: null });
  globalThis.fetch = (async () => { throw Error("Index gateway unavailable"); }) as typeof fetch;
  expect((await readStudioProject(ownerId, projectId, { fresh: true }))?.draft.referenceAssets?.[0].id).toBe("kept");
});

test("unmarked legacy canonical data never hides its newer indexed named successor", async () => {
  setup();
  const old = await saveStudioProject({ ownerId, projectId, name: "Film", draft: draft("old"), expectedRevision: null });
  const legacyBody = JSON.parse(objects.get(key)!.body); delete legacyBody.objectKeyVersion;
  objects.set(key, { body: JSON.stringify(legacyBody), etag: old.revision! });
  const folder = old.project.storageFolder!;
  objects.set(`${folder}/project.json`, { body: JSON.stringify({ version: 1, project: old.project, draft: draft("newer") }), etag: '"newer-named"' });
  expect((await readStudioProject(ownerId, projectId, { fresh: true }))?.draft.referenceAssets?.[0].id).toBe("newer");
});

test("a delayed equal-timestamp index merge reads the authoritative latest summary", async () => {
  setup();
  const stamp = "2026-11-07T00:00:00.000Z";
  let latest = { id: "film", name: "older", updatedAt: stamp };
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const oldMerge = mergeStudioProjectIndex(studioProjectObjects, indexKey, async () => { await gate; return latest; });
  latest = { ...latest, name: "newer" };
  await mergeStudioProjectIndex(studioProjectObjects, indexKey, async () => latest);
  release(); await oldMerge;
  expect(JSON.parse(objects.get(indexKey)!.body).projects[0].name).toBe("newer");
});
