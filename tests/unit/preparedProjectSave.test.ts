import { afterEach, expect, test } from "bun:test";
import { saveVersionedStudioProject } from "@/components/studio/preparedProjectSave";
import { ProjectSaveSession } from "@/components/studio/projectSaveSession";
import type { PersistedStudioProjectDraft } from "@/components/studio/projectPersistence";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

for (const edit of ["clip audio", "shader accent"] as const) {
  test(`prepared approval cannot report saved or apply approval after a concurrent ${edit} edit`, async () => {
    const session = new ProjectSaveSession(); session.restore("film", '"v1"');
    const project = {
      version: 3, savedAt: "before", storyState: { storyBeats: [] }, videoSources: [], referenceAssets: [], generatedAssets: [],
      clipAudioSettings: { useClipAudio: false, overrides: {} }, workflowUiSettings: { shaderAccentKinds: {} },
    } as unknown as PersistedStudioProjectDraft;
    let live = { projectId: "film", projectName: "Film", project };
    let release!: () => void, requested!: () => void;
    const ack = new Promise<void>(resolve => { release = resolve; });
    const request = new Promise<void>(resolve => { requested = resolve; });
    let writes = 0;
    globalThis.fetch = (async (_input, init) => {
      writes++;
      expect(new Headers(init?.headers).get("if-match")).toBe('"v1"');
      const body = await new Request("https://example.test", init).json();
      requested(); await ack;
      return Response.json({ success: true, saved: { version: 1, project: { id: "film", name: "Film" }, draft: body.draft, revision: '"v2"' } });
    }) as typeof fetch;
    const approved = { ...project, generatedAssets: [{ id: "take-1", reviewStatus: "approved" }] } as PersistedStudioProjectDraft;
    let reportedSaved = false, appliedApproval = false;
    const flight = saveVersionedStudioProject(session, { projectId: "film", name: "Film", draft: approved }, {}, undefined, () => live)
      .then(() => { appliedApproval = true; reportedSaved = true; });
    const outcome = flight.then(() => null, error => error as Error);
    await request;
    live = { ...live, project: edit === "clip audio"
      ? { ...project, clipAudioSettings: { useClipAudio: true, overrides: {} } }
      : { ...project, workflowUiSettings: { ...project.workflowUiSettings, shaderAccentKinds: { beat: "glitch-cut" } } } };
    release();
    expect((await outcome)?.message).toContain("reconcile both versions");
    expect({ reportedSaved, appliedApproval }).toEqual({ reportedSaved: false, appliedApproval: false });
    expect(live.project.generatedAssets).toEqual([]);
    expect(edit === "clip audio" ? live.project.clipAudioSettings?.useClipAudio : live.project.workflowUiSettings?.shaderAccentKinds?.beat).toBe(edit === "clip audio" ? true : "glitch-cut");
    await expect(saveVersionedStudioProject(session, { projectId: "film", name: "Film", draft: live.project })).rejects.toThrow("reconcile both versions");
    expect(writes).toBe(1);
  });
}

test("an unchanged full source permits derived export recovery and advances the next autosave revision", async () => {
  const session = new ProjectSaveSession(); session.restore("film", '"v1"');
  const project = { version: 3, savedAt: "before", storyState: { storyBeats: [] }, videoSources: [], referenceAssets: [], generatedAssets: [] } as unknown as PersistedStudioProjectDraft;
  const live = { projectId: "film", projectName: "Film", project };
  const derived = { ...project, workflowUiSettings: { finalExport: { videoUrl: "https://example.test/export.mp4", downloadFileName: "film.mp4", cueCount: 1, status: "Ready" } } };
  const bases: string[] = [];
  globalThis.fetch = (async (_input, init) => {
    bases.push(new Headers(init?.headers).get("if-match")!);
    const body = await new Request("https://example.test", init).json();
    return Response.json({ success: true, saved: { version: 1, project: { id: "film", name: "Film" }, draft: body.draft, revision: bases.length === 1 ? '"v2"' : '"v3"' } });
  }) as typeof fetch;
  const saved = await saveVersionedStudioProject(session, { projectId: "film", name: "Film", draft: derived }, {}, undefined, () => live);
  expect(saved.draft.workflowUiSettings?.finalExport?.downloadFileName).toBe("film.mp4");
  await saveVersionedStudioProject(session, { projectId: "film", name: "Film", draft: project });
  expect(bases).toEqual(['"v1"', '"v2"']);
});

test("a prepared source superseded in the save queue is never written and leaves newer edits saveable", async () => {
  const session = new ProjectSaveSession(); session.restore("film", '"v1"');
  const project = { version: 3, savedAt: "before", storyState: { storyBeats: [] }, videoSources: [], referenceAssets: [], generatedAssets: [] } as unknown as PersistedStudioProjectDraft;
  let live = { projectId: "film", projectName: "Film", project };
  let writes = 0;
  globalThis.fetch = (async (_input, init) => {
    writes++;
    const body = await new Request("https://example.test", init).json();
    return Response.json({ success: true, saved: { version: 1, project: { id: "film", name: body.name }, draft: body.draft, revision: '"v2"' } });
  }) as typeof fetch;
  const flight = saveVersionedStudioProject(session, { projectId: "film", name: "Film", draft: project }, {}, undefined, () => live);
  live = { ...live, projectName: "Renamed film" };
  await expect(flight).rejects.toThrow("prepared snapshot was not written");
  expect(writes).toBe(0);
  await saveVersionedStudioProject(session, { projectId: "film", name: live.projectName, draft: live.project }, {}, undefined, () => live);
  expect(writes).toBe(1);
});

for (const status of [409, 412]) test(`a real ${status} rejection permits only a fresh create request for Save as`, async () => {
  const session = new ProjectSaveSession(); session.restore("film", '"old"');
  const project = { version: 3, savedAt: "before", storyState: { storyBeats: [] }, videoSources: [], referenceAssets: [], generatedAssets: [] } as unknown as PersistedStudioProjectDraft;
  const requests: { path: string; method: string; revision: string | null; projectId?: string }[] = [];
  globalThis.fetch = (async (input, init) => {
    const body = await new Request("https://example.test", init).json();
    requests.push({ path: String(input), method: init!.method!, revision: new Headers(init?.headers).get("if-match"), projectId: body.projectId });
    if (requests.length === 1) return Response.json({ success: false, error: "Another window changed this saved project." }, { status });
    expect(init!.method).toBe("POST");
    expect(String(input)).toBe("/api/studio/projects");
    expect(body.projectId).not.toBe("film");
    expect(body.projectId).toMatch(/^[a-f0-9-]{36}$/);
    return Response.json({ success: true, saved: { version: 1, project: { id: body.projectId, name: body.name }, draft: body.draft, revision: '"copy-v1"' } });
  }) as typeof fetch;
  await expect(saveVersionedStudioProject(session, { projectId: "film", name: "Film", draft: project })).rejects.toThrow("Save as a new project");
  await expect(saveVersionedStudioProject(session, { projectId: "film", name: "Film", draft: project })).rejects.toThrow("Automatic saving is paused");
  const live = { projectId: "film", projectName: "Film", project };
  const copy = await saveVersionedStudioProject(session, { projectId: null, name: "Recovery copy", draft: project }, {}, undefined, () => live);
  expect(copy.project.name).toBe("Recovery copy");
  expect(copy.draft).toEqual(project);
  expect(requests).toEqual([
    { path: "/api/studio/projects/film", method: "PUT", revision: '"old"', projectId: undefined },
    { path: "/api/studio/projects", method: "POST", revision: null, projectId: copy.project.id },
  ]);
});

test("a recovery-copy POST 500 reconciles its exact target with GET and advances only the copy revision", async () => {
  const session = new ProjectSaveSession(); session.restore("film", '"old"');
  const project = { version: 3, savedAt: "before", storyState: { storyBeats: [] }, videoSources: [], referenceAssets: [], generatedAssets: [] } as unknown as PersistedStudioProjectDraft;
  const requests: { path: string; method: string }[] = [];
  let copyId = "";
  globalThis.fetch = (async (input, init) => {
    const path = String(input), method = init?.method ?? "GET";
    requests.push({ path, method });
    if (requests.length === 1) return Response.json({ success: false, error: "Conflict" }, { status: 409 });
    if (method === "POST") {
      const body = await new Request("https://example.test", init).json();
      copyId = body.projectId;
      expect(copyId).toMatch(/^[a-f0-9-]{36}$/);
      expect(body.draft).toEqual(project);
      return Response.json({ success: false, error: "Index acknowledgment unavailable" }, { status: 500 });
    }
    expect(path).toBe(`/api/studio/projects/${copyId}`);
    if (method === "PUT") expect(new Headers(init?.headers).get("if-match")).toBe('"copy-v1"');
    return Response.json({ success: true, saved: { version: 1, project: { id: copyId, name: "Recovery copy" }, draft: { ...project, savedAt: "committed" }, revision: method === "GET" ? '"copy-v1"' : '"copy-v2"' } });
  }) as typeof fetch;
  await expect(saveVersionedStudioProject(session, { projectId: "film", name: "Film", draft: project })).rejects.toThrow("Conflict");
  const copy = await saveVersionedStudioProject(session, { projectId: null, name: "Recovery copy", draft: project });
  expect(copy.project.id).toBe(copyId);
  expect(copy.revision).toBe('"copy-v1"');
  await expect(saveVersionedStudioProject(session, { projectId: "film", name: "Film", draft: project })).rejects.toThrow("obsolete snapshot was not written");
  await saveVersionedStudioProject(session, { projectId: copyId, name: "Recovery copy", draft: project });
  expect(requests).toEqual([
    { path: "/api/studio/projects/film", method: "PUT" },
    { path: "/api/studio/projects", method: "POST" },
    { path: `/api/studio/projects/${copyId}`, method: "GET" },
    { path: `/api/studio/projects/${copyId}`, method: "PUT" },
  ]);
});

for (const reconciliation of ["unavailable", "wrong ID", "wrong name", "changed draft", "missing revision"] as const) {
  test(`a recovery-copy POST 500 with ${reconciliation} GET keeps all writes fenced`, async () => {
    const session = new ProjectSaveSession(); session.restore("film", '"old"');
    const project = { version: 3, savedAt: "before", storyState: { storyBeats: [] }, videoSources: [], referenceAssets: [], generatedAssets: [] } as unknown as PersistedStudioProjectDraft;
    const requests: { path: string; method: string }[] = [];
    let copyId = "";
    globalThis.fetch = (async (input, init) => {
      const path = String(input), method = init?.method ?? "GET";
      requests.push({ path, method });
      if (requests.length === 1) return Response.json({ success: false, error: "Conflict" }, { status: 409 });
      if (method === "POST") {
        const body = await new Request("https://example.test", init).json(); copyId = body.projectId;
        return Response.json({ success: false, error: "Index acknowledgment unavailable" }, { status: 500 });
      }
      expect(method).toBe("GET"); expect(path).toBe(`/api/studio/projects/${copyId}`);
      if (reconciliation === "unavailable") throw Error("GET unavailable");
      return Response.json({ success: true, saved: {
        version: 1,
        project: { id: reconciliation === "wrong ID" ? "film" : copyId, name: reconciliation === "wrong name" ? "Other copy" : "Recovery copy" },
        draft: reconciliation === "changed draft" ? { ...project, referenceAssets: [{ id: "other-reference" }] } : project,
        revision: reconciliation === "missing revision" ? undefined : '"copy-v1"',
      } });
    }) as typeof fetch;
    await expect(saveVersionedStudioProject(session, { projectId: "film", name: "Film", draft: project })).rejects.toThrow("Conflict");
    const epoch = session.contextEpoch;
    await expect(saveVersionedStudioProject(session, { projectId: null, name: "Recovery copy", draft: project })).rejects.toThrow("could not be confirmed");
    expect(session.contextEpoch).toBe(epoch);
    for (const projectId of ["film", null]) {
      await expect(saveVersionedStudioProject(session, { projectId, name: "Another copy", draft: project })).rejects.toThrow("could not be confirmed");
    }
    expect(requests).toEqual([
      { path: "/api/studio/projects/film", method: "PUT" },
      { path: "/api/studio/projects", method: "POST" },
      { path: `/api/studio/projects/${copyId}`, method: "GET" },
    ]);
  });
}
