import { describe, expect, test } from "bun:test";
import { ACTIVE_STUDIO_PROJECT_KEY, clearStudioProjectSelection, loadStudioProjectSelection, readStudioProjectSelection, rememberStudioProjectSelection } from "@/components/studio/projectSelection";
import { loadSavedStudioProject } from "@/components/studio/projectPersistence";

function storage() {
  const data = new Map<string, string>();
  return { data, getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
}

describe("tab-owned project selection", () => {
  test("two tabs retain their own projects across other-tab saves and reloads", () => {
    const shared = storage(), a = { tab: storage(), shared }, b = { tab: storage(), shared };
    rememberStudioProjectSelection("finishing", a);
    expect(readStudioProjectSelection(b).projectId).toBe("finishing");
    rememberStudioProjectSelection("canary", b);
    expect(readStudioProjectSelection(a).projectId).toBe("finishing");
    expect(readStudioProjectSelection(b).projectId).toBe("canary");
    rememberStudioProjectSelection("finishing", a);
    expect(readStudioProjectSelection(b).projectId).toBe("canary");
    // Explicit New/load/save in one tab updates only its tab selection.
    rememberStudioProjectSelection("new-project", b);
    expect(readStudioProjectSelection(a).projectId).toBe("finishing");
    expect(readStudioProjectSelection(b).projectId).toBe("new-project");
  });

  test("legacy last-project fallback and explicit clear cannot reopen another project's mirror", async () => {
    const stores = { tab: storage(), shared: storage() };
    stores.shared.setItem(ACTIVE_STUDIO_PROJECT_KEY, "legacy-project");
    expect(readStudioProjectSelection(stores)).toEqual({ projectId: "legacy-project", explicitlyCleared: false });
    clearStudioProjectSelection(stores);
    stores.shared.setItem(ACTIVE_STUDIO_PROJECT_KEY, "other-tab-project");
    const selection = readStudioProjectSelection(stores);
    expect(selection).toEqual({ projectId: null, explicitlyCleared: true });
    let loads = 0;
    expect(await loadStudioProjectSelection(selection, { named: async () => { loads++; return "named"; }, local: async () => { loads++; return "global mirror"; } })).toBe(null);
    expect(loads).toBe(0);
  });

  test("a failed named load never silently restores a different global draft", async () => {
    let localLoads = 0;
    await expect(loadStudioProjectSelection({ projectId: "missing-project", explicitlyCleared: false }, {
      named: async () => { throw new Error("Project not found"); }, local: async () => { localLoads++; return "other project"; },
    })).rejects.toThrow("Project not found");
    expect(localLoads).toBe(0);
    expect(await loadStudioProjectSelection({ projectId: null, explicitlyCleared: false }, {
      named: async () => "unexpected", local: async () => "legacy local draft",
    })).toBe("legacy local draft");
  });

  test("malformed tab selections fail closed; blocked stores do not throw", () => {
    const stores = { tab: storage(), shared: storage() };
    stores.shared.setItem(ACTIVE_STUDIO_PROJECT_KEY, "other-project");
    stores.tab.setItem(ACTIVE_STUDIO_PROJECT_KEY, "../not-a-project");
    expect(readStudioProjectSelection(stores)).toEqual({ projectId: null, explicitlyCleared: true });
    const blocked = { getItem: () => { throw Error("blocked"); }, setItem: () => { throw Error("blocked"); }, removeItem: () => { throw Error("blocked"); } };
    expect(readStudioProjectSelection({ tab: blocked, shared: blocked })).toEqual({ projectId: null, explicitlyCleared: false });
    rememberStudioProjectSelection("new-project", { tab: blocked, shared: blocked });
    clearStudioProjectSelection({ tab: blocked, shared: blocked });
    rememberStudioProjectSelection("canary", { tab: stores.tab, shared: blocked });
    expect(readStudioProjectSelection({ tab: stores.tab, shared: blocked }).projectId).toBe("canary");
  });

  test("an uncommitted restore fetch cannot overwrite a newer tab choice", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window"), oldFetch = globalThis.fetch;
    const tab = storage(), shared = storage();
    Object.defineProperty(globalThis, "window", { configurable: true, value: { sessionStorage: tab, localStorage: shared } });
    globalThis.fetch = (async () => Response.json({ success: true, saved: { project: { id: "old-project" }, draft: {} } })) as typeof fetch;
    try {
      rememberStudioProjectSelection("new-project");
      await loadSavedStudioProject("old-project", { cache: false });
      expect(readStudioProjectSelection().projectId).toBe("new-project");
      await loadSavedStudioProject("old-project");
      expect(readStudioProjectSelection().projectId).toBe("old-project");
    } finally {
      globalThis.fetch = oldFetch;
      if (descriptor) Object.defineProperty(globalThis, "window", descriptor); else Reflect.deleteProperty(globalThis, "window");
    }
  });

  test("browser storage property access may be blocked independently", () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window"), shared = storage();
    const browser = { localStorage: shared };
    Object.defineProperty(browser, "sessionStorage", { get() { throw new Error("blocked"); } });
    Object.defineProperty(globalThis, "window", { configurable: true, value: browser });
    try {
      rememberStudioProjectSelection("legacy-fallback");
      expect(readStudioProjectSelection().projectId).toBe("legacy-fallback");
      clearStudioProjectSelection();
      expect(readStudioProjectSelection().projectId).toBe(null);
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "window", descriptor); else Reflect.deleteProperty(globalThis, "window");
    }
  });
});
