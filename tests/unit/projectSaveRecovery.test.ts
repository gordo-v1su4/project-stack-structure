import { afterEach, expect, test } from "bun:test";
import { saveNamedStudioProject } from "@/components/studio/projectPersistence";
import { isExactProjectSave } from "@/components/studio/projectSaveComparison";
import type { PersistedStudioProjectDraft } from "@/components/studio/projectPersistence";
import type { SavedStudioProject } from "@/lib/studioProjectStore";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const draft = { version: 3, savedAt: "before", storyState: { storyBeats: [] }, videoSources: [], referenceAssets: [], generatedAssets: [] } as unknown as PersistedStudioProjectDraft;
const saved = (id: string): SavedStudioProject => ({ version: 1, project: { id, name: "Film" }, draft: { ...draft, savedAt: "committed" }, revision: '"v2"' }) as SavedStudioProject;

test("create ID exists before POST and a lost ACK reconciles that exact ID with GET only", async () => {
  const calls: { method: string; url: string }[] = []; let id = "";
  globalThis.fetch = (async (input, init) => {
    const url = String(input), method = init?.method ?? "GET"; calls.push({ method, url });
    if (method === "POST") { const body = await new Request("https://example.test", init).json(); id = body.projectId; expect(id).toMatch(/^[a-f0-9-]{36}$/); throw Error("ACK lost"); }
    expect(url).toBe(`/api/studio/projects/${id}`);
    return Response.json({ success: true, saved: saved(id) });
  }) as typeof fetch;
  const result = await saveNamedStudioProject({ name: "Film", draft }, { cache: false });
  expect(result.project.id).toBe(id); expect(calls.map(call => call.method)).toEqual(["POST", "GET"]);
});

test("known 409 cannot fetch a new base and replay an obsolete body", async () => {
  let calls = 0;
  globalThis.fetch = (async (_input, init) => { calls++; expect(new Headers(init?.headers).get("if-match")).toBe('"v1"'); return Response.json({ success: false, error: "Other window changed it" }, { status: 409 }); }) as typeof fetch;
  await expect(saveNamedStudioProject({ projectId: "film", name: "Film", draft, expectedRevision: '"v1"' }, { cache: false })).rejects.toThrow("Other window");
  expect(calls).toBe(1);
});

test("uncertain update is reconciled only if every intended field matches", async () => {
  let calls = 0;
  globalThis.fetch = (async (_input, init) => { calls++; if (init?.method === "PUT") throw Error("ACK lost"); return Response.json({ success: true, saved: { ...saved("film"), draft: { ...draft, referenceAssets: [{ id: "new-user-crowd" }] } } }); }) as typeof fetch;
  await expect(saveNamedStudioProject({ projectId: "film", name: "Film", draft, expectedRevision: '"v1"' }, { cache: false })).rejects.toThrow("could not be confirmed");
  expect(calls).toBe(2);
});

test("exact ACK comparison tolerates only save timestamp/key order, never refs or project changes", () => {
  expect(isExactProjectSave(saved("film"), "film", " Film ", draft)).toBe(true);
  expect(isExactProjectSave(saved("other"), "film", "Film", draft)).toBe(false);
  expect(isExactProjectSave({ ...saved("film"), revision: undefined }, "film", "Film", draft)).toBe(false);
  expect(isExactProjectSave({ ...saved("film"), draft: { ...draft, referenceAssets: [{ id: "changed" }] } as PersistedStudioProjectDraft }, "film", "Film", draft)).toBe(false);
});

test("an old client without a base revision makes no request", async () => {
  globalThis.fetch = (async () => { throw Error("must not request"); }) as typeof fetch;
  await expect(saveNamedStudioProject({ projectId: "film", name: "Film", draft }, { cache: false })).rejects.toThrow("no saved revision");
});
