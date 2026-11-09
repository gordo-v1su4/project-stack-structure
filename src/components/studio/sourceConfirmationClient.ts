import type { PersistedStudioProjectDraft } from "./projectPersistence";
import type { SavedStudioProject } from "@/lib/studioProjectStore";
import { generationScopeSha256, normalizeGenerationScopeReceipt, type GenerationScopeReceipt } from "./generationScope";
import { STUDIO_JSON_TRANSPORT_HEADERS } from "@/lib/studioJsonTransport";

/** UI/navigation timestamps are not source edits. Every bank object and editorial input remains guarded. */
export function sourceConfirmationBaselineSha256(draft: PersistedStudioProjectDraft): string {
  const inputs = { ...draft };
  delete (inputs as Partial<PersistedStudioProjectDraft>).savedAt;
  const workflow = { ...draft.workflowUiSettings };
  delete workflow.activeTab; delete workflow.isPreviewExpanded;
  inputs.workflowUiSettings = Object.keys(workflow).length ? workflow : undefined;
  return generationScopeSha256(inputs);
}

export async function prepareAppendedSourceConfirmation(params: { projectId: string; baseline: PersistedStudioProjectDraft;
  isCurrent: () => boolean; fetchImpl?: typeof fetch; mode?: "creative-rebaseline" }): Promise<{ draft: PersistedStudioProjectDraft; receipt: GenerationScopeReceipt; expectedRevision: string }> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const fresh = await fetchImpl(`/api/studio/projects/${encodeURIComponent(params.projectId)}`, { cache: "no-store", headers: STUDIO_JSON_TRANSPORT_HEADERS });
  const payload = await fresh.json() as { saved?: SavedStudioProject & { revision?: string }; error?: string };
  const value = payload.saved;
  if (!fresh.ok || !value?.draft || value.project.id !== params.projectId || !value.revision) throw new Error(payload.error || "Reload this saved project before confirming its sources.");
  if (!params.isCurrent() || sourceConfirmationBaselineSha256(value.draft) !== sourceConfirmationBaselineSha256(params.baseline)) {
    throw new Error("The saved project or open draft changed. Reload and review its sources before confirming.");
  }
  const response = await fetchImpl("/api/studio/projects/source-confirmation", { method: "POST", headers: { ...STUDIO_JSON_TRANSPORT_HEADERS, "content-type": "application/json" },
    body: JSON.stringify({ projectId: params.projectId, expectedRevision: value.revision, ...(params.mode ? { mode: params.mode } : {}) }) });
  const result = await response.json() as { draft?: PersistedStudioProjectDraft; receipt?: GenerationScopeReceipt; expectedRevision?: string; error?: string };
  if (!response.ok || !result.draft || !normalizeGenerationScopeReceipt(result.receipt) || result.expectedRevision !== value.revision
    || result.draft.musicVideoProject?.generationScope?.sha256 !== result.receipt?.sha256) throw new Error(result.error || "The appended sources could not be confirmed.");
  if (!params.isCurrent()) throw new Error("The open project changed while confirming its sources. The candidate was not saved.");
  return { draft: result.draft, receipt: result.receipt!, expectedRevision: value.revision };
}
