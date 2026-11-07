import type { PersistedStudioProjectDraft } from "./projectPersistence";
import type { SavedStudioProject } from "@/lib/studioProjectStore";

function canonical(value: unknown): string {
  return JSON.stringify((function sort(item: unknown): unknown {
    if (Array.isArray(item)) return item.map(sort);
    if (!item || typeof item !== "object") return item;
    return Object.fromEntries(Object.entries(item).filter(([, entry]) => entry !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, sort(entry)]));
  })(value));
}

/** A lost ACK can reconcile only the exact intended owner-scoped snapshot. */
export function isExactProjectSave(saved: SavedStudioProject, projectId: string, name: string, draft: PersistedStudioProjectDraft): boolean {
  return Boolean(saved.revision && saved.project.id === projectId
    && saved.project.name === (name.trim().replace(/\s+/g, " ").slice(0, 120) || "Untitled project")
    && canonical({ ...saved.draft, savedAt: undefined }) === canonical({ ...draft, savedAt: undefined }));
}
