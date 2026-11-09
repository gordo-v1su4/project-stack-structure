import type { PersistedFinalExport, PersistedStudioProjectDraft } from "./projectPersistence";
import { isFinalExportIntentCurrent, normalizeFinalExportIntent } from "./finalExportRecovery";

/** A durable file is current only for the exact completed project/render receipt. */
export function currentCompletedExport(draft: PersistedStudioProjectDraft, projectId: string | null): PersistedFinalExport | undefined {
  const intent = normalizeFinalExportIntent(draft.workflowUiSettings?.finalExportIntent);
  const artifact = draft.workflowUiSettings?.finalExport;
  return artifact && intent?.state === "ready" && isFinalExportIntentCurrent(intent, projectId, draft) ? artifact : undefined;
}

/** Strip stale display metadata before saving. The remote media object is untouched. */
export function discardStaleCompletedExport(draft: PersistedStudioProjectDraft, projectId: string | null): PersistedStudioProjectDraft {
  if (!draft.workflowUiSettings?.finalExport || currentCompletedExport(draft, projectId)) return draft;
  return { ...draft, workflowUiSettings: { ...draft.workflowUiSettings, finalExport: undefined } };
}
