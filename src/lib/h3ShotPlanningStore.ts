import { generationScopeSha256 } from "@/components/studio/generationScope";
import { parseH3ShotPlanningResult, type H3ShotPlanningInput, type H3ShotPlanningResult } from "@/components/studio/h3ShotPlanning";
import { normalizeStudioOwnerSegment, normalizeStudioProjectId } from "./studioStoragePaths";
import { StudioProjectConflictError, studioProjectObjects, type StudioJsonObjectStore } from "./studioProjectObjectStore";

type StoredShotPlan = {
  version: 1;
  ownerId: string;
  projectId: string;
  input: H3ShotPlanningInput;
  result: H3ShotPlanningResult;
  resultSha256: string;
};

function key(ownerId: string, projectId: string, input: H3ShotPlanningInput) {
  const { bindingSha256, ...body } = input;
  if (!ownerId || normalizeStudioOwnerSegment(ownerId) !== ownerId
    || !projectId || normalizeStudioProjectId(projectId) !== projectId
    || input.projectId !== projectId || !/^[a-f0-9]{64}$/.test(bindingSha256)
    || generationScopeSha256(body) !== bindingSha256) {
    throw new Error("Invalid owned shot planning context.");
  }
  return `media-uploads/projects/${ownerId}/shot-plans/${projectId}/${input.bindingSha256}.json`;
}

function checked(record: StoredShotPlan, ownerId: string, projectId: string, input: H3ShotPlanningInput) {
  if (!record || record.version !== 1 || record.ownerId !== ownerId || record.projectId !== projectId
    || generationScopeSha256(record.input) !== generationScopeSha256(input)
    || generationScopeSha256(record.result) !== record.resultSha256) {
    throw new Error("Stored shot planning context changed.");
  }
  return parseH3ShotPlanningResult(record.result, input);
}

/** Internal storage seam. The authenticated caller supplies the fresh canonical
 * full-plan input; storage is not generation, identity or creative approval.
 */
export async function readH3ShotPlan(ownerId: string, projectId: string, input: H3ShotPlanningInput,
  objects: StudioJsonObjectStore = studioProjectObjects): Promise<H3ShotPlanningResult | null> {
  const stored = await objects.read<StoredShotPlan>(key(ownerId, projectId, input));
  return stored ? checked(stored.value, ownerId, projectId, input) : null;
}

/** One immutable planning result per owned input. A racing or timed-out write
 * may be reconciled by readback; it never replaces an existing direction set.
 */
export async function storeH3ShotPlan(ownerId: string, projectId: string, input: H3ShotPlanningInput,
  value: unknown, objects: StudioJsonObjectStore = studioProjectObjects): Promise<H3ShotPlanningResult> {
  const objectKey = key(ownerId, projectId, input);
  // Detach before the first await so caller mutations cannot change the write.
  const snapshot = JSON.parse(JSON.stringify(input)) as H3ShotPlanningInput;
  const result = parseH3ShotPlanningResult(value, snapshot);
  const record: StoredShotPlan = { version: 1, ownerId, projectId, input: snapshot, result,
    resultSha256: generationScopeSha256(result) };
  const reconcile = async () => {
    const existing = await objects.read<StoredShotPlan>(objectKey);
    if (!existing) return null;
    const restored = checked(existing.value, ownerId, projectId, snapshot);
    if (generationScopeSha256(restored) !== record.resultSha256) {
      throw new StudioProjectConflictError("A different shot plan already exists for this confirmed input.");
    }
    return restored;
  };
  const existing = await reconcile();
  if (existing) return existing;
  try {
    await objects.write(objectKey, record, null);
    return result;
  } catch (error) {
    // Includes an acknowledged write whose response was lost. Do not issue a
    // second PUT or infer that the first operation did not reach storage.
    const restored = await reconcile();
    if (restored) return restored;
    throw error;
  }
}
