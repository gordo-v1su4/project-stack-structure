import { normalizeStudioOwnerSegment, resolveLegacyProjectObjectPath } from "./studioStoragePaths";
import { studioProjectObjects, StudioProjectConflictError, type StudioJsonObjectStore } from "./studioProjectObjectStore";
import { applyReplacementOperation, normalizeReplacementMarks, type ReplacementMark, type ReplacementOperation, type ReplacementTarget } from "@/components/studio/replacementReview";

type Document = { version: 1; ownerId: string; projectId: string; marks: ReplacementMark[] };
function key(ownerId: string, projectId: string) { return resolveLegacyProjectObjectPath(ownerId, projectId).replace(/project\.json$/, "review/replacement-marks.json"); }

export async function readReplacementReview(ownerId: string, projectId: string, objects: StudioJsonObjectStore = studioProjectObjects) {
  const stored = await objects.read<Document>(key(ownerId, projectId));
  if (!stored) return { marks: [] as ReplacementMark[], revision: null as string | null };
  if (stored.value.version !== 1 || stored.value.ownerId !== normalizeStudioOwnerSegment(ownerId) || stored.value.projectId !== projectId) throw new Error("Replacement review ownership is invalid.");
  return { marks: normalizeReplacementMarks(stored.value.marks), revision: stored.revision as string | null };
}

/** Caller must first authenticate and resolve the owned project's current targets. */
export async function writeReplacementReview(ownerId: string, projectId: string, expectedRevision: string | null,
  targets: ReplacementTarget[], operation: ReplacementOperation, objects: StudioJsonObjectStore = studioProjectObjects, now = new Date().toISOString()) {
  const current = await readReplacementReview(ownerId, projectId, objects);
  if (expectedRevision !== current.revision) throw new StudioProjectConflictError("Review marks changed in another window. Refresh marks before trying again.");
  const marks = applyReplacementOperation(current.marks, targets, operation, now);
  const revision = await objects.write<Document>(key(ownerId, projectId), { version: 1, ownerId: normalizeStudioOwnerSegment(ownerId), projectId, marks }, expectedRevision);
  return { marks, revision };
}
