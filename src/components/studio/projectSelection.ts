/** Last project is a new-tab fallback; an existing tab owns its own selection. */
export const ACTIVE_STUDIO_PROJECT_KEY = "project-stack-structure:active-project:v1";

type SelectionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type ProjectSelectionStores = { tab?: SelectionStorage; shared?: SelectionStorage };
export type StudioProjectSelection = { projectId: string | null; explicitlyCleared: boolean };

function browserStores(): ProjectSelectionStores {
  if (typeof window === "undefined") return {};
  let tab: SelectionStorage | undefined, shared: SelectionStorage | undefined;
  try { tab = window.sessionStorage; } catch { /* Browser storage can be blocked. */ }
  try { shared = window.localStorage; } catch { /* Independent best-effort fallback. */ }
  return { tab, shared };
}

function get(storage: SelectionStorage | undefined): string | null {
  try { return storage?.getItem(ACTIVE_STUDIO_PROJECT_KEY) ?? null; } catch { return null; }
}

function validId(value: string): boolean { return /^[A-Za-z0-9_-]{1,96}$/.test(value); }

export function readStudioProjectSelection(stores = browserStores()): StudioProjectSelection {
  const tab = get(stores.tab);
  // Empty/invalid explicit tab values never inherit another tab's project.
  if (tab !== null) return { projectId: validId(tab) ? tab : null, explicitlyCleared: !validId(tab) };
  const shared = get(stores.shared);
  return { projectId: shared && validId(shared) ? shared : null, explicitlyCleared: false };
}

export function rememberStudioProjectSelection(projectId: string, stores = browserStores()): void {
  if (!validId(projectId)) return;
  for (const storage of [stores.tab, stores.shared]) {
    try { storage?.setItem(ACTIVE_STUDIO_PROJECT_KEY, projectId); } catch { /* Durable save/load already succeeded. */ }
  }
}

export function clearStudioProjectSelection(stores = browserStores()): void {
  // Tombstone survives reload without falling back to another tab's shared ID.
  try { stores.tab?.setItem(ACTIVE_STUDIO_PROJECT_KEY, ""); } catch { /* Storage may be blocked. */ }
  try { stores.shared?.removeItem(ACTIVE_STUDIO_PROJECT_KEY); } catch { /* Best effort. */ }
}

export async function loadStudioProjectSelection<T>(selection: StudioProjectSelection, loaders: {
  named: (projectId: string) => Promise<T>;
  local: () => Promise<T | null>;
}): Promise<T | null> {
  // A failed named load must not substitute a different project's global mirror.
  if (selection.projectId) return loaders.named(selection.projectId);
  return selection.explicitlyCleared ? null : loaders.local();
}
