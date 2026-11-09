import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { h3ProjectFixture } from "../helpers/h3Project";
import { generationScopeSha256, generationSemanticSha256, normalizeGenerationScopeReceipt, sourceReferenceManifest, type GenerationScopeReceipt } from "@/components/studio/generationScope";
import { placementInputSignature } from "@/components/studio/musicVideoProject";
import type { SavedStudioProject } from "@/lib/studioProjectStore";

let user: { id: string } | null = { id: "github-test" };
let saved: SavedStudioProject | null, canonical: GenerationScopeReceipt | null;
let rawFailure: unknown, mediaFailure: unknown, projectFailure: unknown, canonicalFailure: unknown;
const calls: { stage: string; args: unknown[] }[] = [];
const originalConsole = { warn: console.warn, error: console.error, log: console.log };
mock.module("@/lib/session", () => ({ getSessionUser: async () => user,
  unauthorizedResponse: () => Response.json({ success: false, error: "Sign in with GitHub to use this endpoint." }, { status: 401 }) }));
mock.module("@/lib/studioProjectStore", () => ({ readStudioProject: async (...args: unknown[]) => {
  calls.push({ stage: "project", args }); if (projectFailure !== undefined) throw projectFailure; return saved;
} }));
const forbidden = () => { throw new Error("Diagnostic must not write, enroll, pin or authorize anything"); };
mock.module("@/lib/generationScopeStore", () => ({ readGenerationScopeReceipt: async (...args: unknown[]) => {
  calls.push({ stage: "canonical", args }); if (canonicalFailure !== undefined) throw canonicalFailure; return canonical;
}, storeGenerationScopeReceipt: forbidden, readGenerationScopeBaseline: forbidden, storeGenerationScopeBaseline: forbidden }));
mock.module("@/lib/generationScopeRawReferences", () => ({ pinGenerationScopeRawReferences: forbidden,
  verifyGenerationScopeRawReferences: async (...args: unknown[]) => { calls.push({ stage: "raw", args }); if (rawFailure !== undefined) throw rawFailure; return []; } }));
mock.module("@/lib/generationScopeMedia", () => ({ pinGenerationScopeMedia: forbidden, bootstrapR31SourceMedia: forbidden,
  verifyGenerationScopeMedia: async (...args: unknown[]) => { calls.push({ stage: "media", args }); if (mediaFailure !== undefined) throw mediaFailure; return []; } }));
const { sourceSha, storySha, assertMaterializationGenerationScope } = await import("@/lib/generationScopeServer");
const { POST } = await import("@/app/api/studio/projects/[projectId]/source-check/route");
const { safeStorageDiagnostic } = await import("@/app/api/studio/projects/[projectId]/source-check/safeStorageDiagnostic");

beforeEach(() => {
  user = { id: "github-test" }; rawFailure = mediaFailure = projectFailure = canonicalFailure = undefined; calls.length = 0;
  saved = h3ProjectFixture().saved;
  const project = saved.draft.musicVideoProject!;
  project.sourceContextSignature = "synthetic-source-context";
  project.placementPlan!.inputSignature = placementInputSignature(project);
  const references = sourceReferenceManifest(saved.draft.referenceAssets!);
  const body: GenerationScopeReceipt["body"] = {
    version: 1, kind: "baseline", ownerId: saved.project.ownerId, projectId: saved.project.id, baselineRevision: '"fixture"',
    fromSourceContext: project.sourceContextSignature, toSourceContext: project.sourceContextSignature,
    fromInputSignature: project.placementPlan!.inputSignature, toInputSignature: project.placementPlan!.inputSignature,
    scopeSignature: project.placementPlan!.inputSignature, semanticSha256: generationSemanticSha256(project), references,
    rawReferences: references.map(reference => ({ assetId: reference.id, bucket: reference.storageBucket!, objectKey: reference.storagePath!, etag: '"pinned"', sha256: "a".repeat(64), byteLength: 10 })),
    sourceMediaVersions: [], appendedReferenceIds: [], sourceInventorySha256: sourceSha(saved.draft), storySha256: storySha(saved.draft),
  };
  const sha256 = generationScopeSha256(body);
  canonical = { version: 1, id: `generation-scope-${sha256}`, sha256, body };
  expect(Boolean(normalizeGenerationScopeReceipt(canonical))).toBe(true);
  project.generationScope = structuredClone(canonical);
});
afterEach(() => { Object.assign(console, originalConsole); });
const request = () => POST(new Request("http://localhost/api/studio/projects/project-1/source-check", { method: "POST" }), { params: Promise.resolve({ projectId: "project-1" }) });

test("401 precedes every project/storage read; POST awaits Next route params", async () => {
  user = null;
  const response = await request();
  expect(response.status).toBe(401); expect(response.headers.get("Cache-Control")).toBe("no-store"); expect(calls).toEqual([]);
  user = { id: "github-test" };
  let resolve!: (value: { projectId: string }) => void;
  const params = new Promise<{ projectId: string }>(done => { resolve = done; });
  const pending = POST(new Request("http://localhost", { method: "POST" }), { params });
  await Promise.resolve(); expect(calls).toEqual([]);
  resolve({ projectId: "project-1" }); expect((await pending).status).toBe(200);
});

test("missing, cross-owner and mismatched project IDs are indistinguishable 404s without receipt reads", async () => {
  const initial = saved!;
  let expected: string | undefined;
  for (const value of [null, { ...initial, project: { ...initial.project, ownerId: "other-owner" } }, { ...initial, project: { ...initial.project, id: "other-project" } }]) {
    saved = value; calls.length = 0; const response = await request();
    expect(response.status).toBe(404); const body = await response.text(); expected ??= body; expect(body).toBe(expected);
    expect(calls.map(call => call.stage)).toEqual(["project"]);
  }
});

test("missing inline scope, missing canonical record and changed canonical record fail before source reads", async () => {
  const inline = saved!.draft.musicVideoProject!.generationScope;
  saved!.draft.musicVideoProject!.generationScope = undefined;
  expect((await request()).status).toBe(409); expect(calls.map(call => call.stage)).toEqual(["project"]);
  saved!.draft.musicVideoProject!.generationScope = inline; canonical = null; calls.length = 0;
  expect((await request()).status).toBe(409); expect(calls.map(call => call.stage)).toEqual(["project", "canonical"]);
  canonical = { ...inline!, body: { ...inline!.body, baselineRevision: '"different"' } }; calls.length = 0;
  expect((await request()).status).toBe(409); expect(calls.map(call => call.stage)).toEqual(["project", "canonical"]);
});

test("changed story, source manifest and current-reference context cannot produce a successful diagnostic", async () => {
  const original = structuredClone(saved!);
  const changes = [() => { saved!.draft.storyState.storyContentSignature = "changed"; },
    () => { saved!.draft.referenceAssets![0].storagePath += "changed"; },
    () => { saved!.draft.musicVideoProject!.currentIdentity = { migrationSha256: "a".repeat(64), contextSha256: "b".repeat(64), replacements: [], assessments: {}, activeAssessments: {} }; }];
  for (const change of changes) {
    saved = structuredClone(original); calls.length = 0; change();
    const response = await request(); expect(response.status).toBe(409); expect((await response.json()).success).toBe(false);
    expect(calls.some(call => call.stage === "raw" || call.stage === "media")).toBe(false);
  }
});

test("raw-reference wrapper failure recovers only closed code/status and short-circuits media", async () => {
  rawFailure = Object.assign(new Error("Reference metadata lookup failed (storage HTTP 403, SignatureDoesNotMatch)."), { $metadata: { httpStatusCode: 403 } });
  const response = await request(); expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ success: false, error: "Source verification could not complete.", stage: "raw-references", diagnostic: { errorClass: "Error", errorCode: "SignatureDoesNotMatch", httpStatus: 403 } });
  expect(calls.map(call => call.stage)).toEqual(["project", "canonical", "raw"]);
});

test("media SDK failure is distinct and never serializes transport details", async () => {
  mediaFailure = Object.assign(new Error("https://secret.example/key?credential=SYNTHETIC_SECRET <XML>secret</XML>"), { name: "SignatureDoesNotMatch", $metadata: { httpStatusCode: 403, headers: { secret: "SYNTHETIC_SECRET" } }, code: "SYNTHETIC_SECRET" });
  const response = await request(); const text = await response.text();
  expect(response.status).toBe(503); expect(JSON.parse(text)).toEqual({ success: false, error: "Source verification could not complete.", stage: "source-media", diagnostic: { errorClass: "StorageError", errorCode: "SignatureDoesNotMatch", httpStatus: 403 } });
  expect(text).not.toContain("SYNTHETIC_SECRET"); expect(text).not.toContain("https"); expect(calls.map(call => call.stage)).toEqual(["project", "canonical", "raw", "media"]);
});

test("safe classifier ignores malicious names, message suffixes, unknown status and accessor properties", () => {
  let getterCalls = 0;
  const hostile = Object.create({ get name() { getterCalls++; throw new Error("SYNTHETIC_SECRET"); } });
  for (const key of ["message", "code", "$metadata", "stack", "cause", "toJSON"]) Object.defineProperty(hostile, key, { get() { getterCalls++; throw new Error("SYNTHETIC_SECRET"); } });
  expect(safeStorageDiagnostic(hostile)).toEqual({ errorClass: "Unknown" }); expect(getterCalls).toBe(0);
  expect(safeStorageDiagnostic({ name: "SYNTHETIC_SECRET", code: "SYNTHETIC_SECRET", $metadata: { httpStatusCode: "403" } })).toEqual({ errorClass: "Unknown" });
  const wrapped = "Reference metadata full GET after ranged signature rejection failed (storage HTTP 403, SignatureDoesNotMatch).";
  expect(safeStorageDiagnostic(Object.assign(new Error(wrapped), { $metadata: { httpStatusCode: 403 } }))).toMatchObject({ errorClass: "Error", errorCode: "SignatureDoesNotMatch", httpStatus: 403 });
  for (const message of [wrapped + "\n", wrapped + " SYNTHETIC_SECRET", "SYNTHETIC_SECRET " + wrapped]) {
    expect(safeStorageDiagnostic({ message, $metadata: { httpStatusCode: 403 } })).toEqual({ errorClass: "Unknown", httpStatus: 403 });
  }
  const proxy = new Proxy({}, { get() { getterCalls++; throw new Error("secret"); }, getOwnPropertyDescriptor() { throw new Error("secret"); }, getPrototypeOf() { throw new Error("secret"); } });
  expect(safeStorageDiagnostic(proxy)).toEqual({ errorClass: "Unknown" }); expect(getterCalls).toBe(0);
});

test("hostile errors remain safe through the actual route response and no success logs are emitted", async () => {
  let logs = 0;
  console.warn = console.error = console.log = () => { logs++; };
  let accessors = 0;
  rawFailure = Object.defineProperties({}, Object.fromEntries(["message", "name", "code", "$metadata", "stack", "cause", "toJSON"].map(key => [key, { get() { accessors++; throw new Error("SYNTHETIC_SECRET"); } }])));
  const failed = await request(); expect(failed.status).toBe(503); expect(await failed.text()).not.toContain("SYNTHETIC_SECRET"); expect(accessors).toBe(0);
  rawFailure = undefined;
  const before = JSON.stringify(saved); calls.length = 0;
  const response = await request(); expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toEqual({ success: true, checks: [{ stage: "raw-references", status: "passed" }, { stage: "source-media", status: "passed" }] });
  expect(calls[0]).toEqual({ stage: "project", args: ["github-test", "project-1", { fresh: true }] });
  expect(calls[1]).toEqual({ stage: "canonical", args: ["github-test", "project-1", canonical!.id] });
  expect(calls[2].args).toEqual(["github-test", canonical!.body.references, canonical!.body.rawReferences]);
  expect(calls[3].args).toEqual(["github-test", saved!.draft, canonical!.body.sourceMediaVersions]);
  expect(calls[3].args[1]).toBe(saved!.draft); expect(JSON.stringify(saved)).toBe(before);
  expect(() => assertMaterializationGenerationScope(saved!)).toThrow("Validate the canonical source confirmation before generation.");
  expect(logs).toBe(0);
});
