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
