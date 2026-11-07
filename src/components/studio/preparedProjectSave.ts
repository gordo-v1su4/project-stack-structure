import { saveNamedStudioProject, type PersistedStudioProjectDraft } from "./projectPersistence";
import { projectDraftFingerprint } from "./projectSaveComparison";
import type { ProjectSaveSession } from "./projectSaveSession";

type PreparedProjectSource = {
  projectId: string | null;
  projectName: string;
  project: PersistedStudioProjectDraft;
};

/** Prepared writes may derive a new draft, but their entire live source must stay current through the ACK. */
export function saveVersionedStudioProject(
  session: ProjectSaveSession,
  params: Parameters<typeof saveNamedStudioProject>[0],
  options: Parameters<typeof saveNamedStudioProject>[1] = {},
  contextEpoch?: number,
  readSource?: () => PreparedProjectSource,
) {
  const source = readSource?.();
  const fingerprint = source ? projectDraftFingerprint(source.project) : undefined;
  const isCurrent = source && readSource ? () => {
    const live = readSource();
    return live.projectId === source.projectId && live.projectName === source.projectName
      && projectDraftFingerprint(live.project) === fingerprint;
  } : undefined;
  return session.save(params.projectId?.trim() || null, expectedRevision => {
    if (params.expectedRevision && params.expectedRevision !== expectedRevision) throw new Error("The confirmed source revision is no longer this editor's saved revision. Reopen the project before saving it.");
    return saveNamedStudioProject({ ...params, expectedRevision }, { ...options, cache: false });
  }, contextEpoch, isCurrent);
}
