import { describe, expect, test } from "bun:test";
import { createBlankNamedStudioProject, newStudioProjectNameError } from "@/components/studio/newStudioProject";
import { ACTIVE_STUDIO_PROJECT_KEY, STUDIO_PROJECT_STORAGE_KEY } from "@/components/studio/projectPersistence";

const emptyStory = { vocalStemName: "", transcriptSummary: null, storyBeats: [], activeBeatId: "intro", storyGenerated: false };
const originalFetch = globalThis.fetch;

describe("confirmed blank named project creation", () => {
  test("blank and overlong names are rejected before any persistence", async () => {
    let requests = 0;
    globalThis.fetch = (async () => { requests++; throw new Error("Unexpected request"); }) as typeof fetch;
    try {
      for (const name of ["", " \n\t ", "x".repeat(121)]) {
        expect(newStudioProjectNameError(name) === null).toBe(false);
        await expect(createBlankNamedStudioProject(name, emptyStory)).rejects.toThrow();
      }
      expect(requests).toBe(0);
      expect(newStudioProjectNameError("  New film  ")).toBe(null);
    } finally { globalThis.fetch = originalFetch; }
  });

  test("explicit creation POSTs only a named blank draft and keeps the previous project record untouched", async () => {
    const existing = { project: { id: "existing-film" }, draft: { videoSources: [{ id: 0 }], generatedAssets: [{ id: "selected" }] } };
    const before = JSON.stringify(existing);
    const requests: string[] = [];
    globalThis.fetch = (async (input, init) => {
      requests.push(`${init?.method} ${input}`);
      const payload = JSON.parse(String(init?.body));
      expect(payload.name).toBe("New film");
      expect(payload.draft).toMatchObject({ analysis: null, videoSources: [], musicVideoProject: null, referenceAssets: [], generatedAssets: [], generatedDraft: null,
        workflowUiSettings: { activeTab: "review" }, storyState: { storyGenerated: false, transcriptSummary: null } });
      return Response.json({ success: true, saved: { version: 1, project: { id: payload.projectId, name: payload.name, ownerId: "authenticated-owner" }, draft: payload.draft, revision: '"new-v1"' } });
    }) as typeof fetch;
    try {
      const result = await createBlankNamedStudioProject("  New   film  ", emptyStory);
      expect(result.project.id).toMatch(/^[a-f0-9-]{36}$/);
      expect(requests).toEqual(["POST /api/studio/projects"]);
      expect(JSON.stringify(existing)).toBe(before);
    } finally { globalThis.fetch = originalFetch; }
  });

  test("a failed creation preserves the current local project pointer and draft", async () => {
    const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    const entries = new Map([[ACTIVE_STUDIO_PROJECT_KEY, "existing-film"], [STUDIO_PROJECT_STORAGE_KEY, "existing draft"]]);
    Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: {
      setItem: (key: string, value: string) => entries.set(key,value), removeItem: (key: string) => entries.delete(key),
    } } });
    globalThis.fetch = (async () => Response.json({ error: "Storage unavailable" }, { status: 503 })) as typeof fetch;
    try {
      await expect(createBlankNamedStudioProject("New film", emptyStory)).rejects.toThrow("could not be confirmed");
      expect(entries.get(ACTIVE_STUDIO_PROJECT_KEY)).toBe("existing-film");
      expect(entries.get(STUDIO_PROJECT_STORAGE_KEY)).toBe("existing draft");
    } finally {
      globalThis.fetch = originalFetch;
      if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
      else Reflect.deleteProperty(globalThis, "window");
    }
  });
});
