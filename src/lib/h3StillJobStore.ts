import type { H3GenerationJob, H3GenerationRequest } from "@/components/studio/h3Generation";
import { parseH3Request } from "./h3GenerationServer";
import { parseH3SceneProofBinding, parseAnimaticShotBinding } from "./h3StillRequest";
import type { SceneProofBinding } from "@/components/studio/sceneProofs";
import { freezeH3Still, h3StillDigest, type H3StillDescriptor } from "./h3StillProfile";
import { normalizeStudioOwnerSegment, normalizeStudioProjectId } from "./studioStoragePaths";
import { studioProjectObjects, StudioProjectConflictError, type StudioJsonObjectStore } from "./studioProjectObjectStore";

export type H3StillState = "queued" | "preparing" | "submitting" | "submission_unknown" | "rendering" | "persisting" | "ready" | "failed" | "cancel_requested" | "cancelled";
export type H3StillImage = { bucket: string; objectKey: string; sha256: string; byteLength: number; width: number; height: number };
export type H3StillResult = { master: H3StillImage; native: H3StillImage; artifactId: string; artifactSha256: string };
export type H3StillJobInput = { ownerId: string; projectId: string; descriptor: H3StillDescriptor;
  /** Future video request stays frozen, with its own independent video intent/attempt. */
  shotRequest: H3GenerationRequest; template: H3GenerationJob; requestIntentId: string; attempt?: number; sceneProof?: SceneProofBinding; animaticShot?: import("@/components/studio/stillAnimatic").AnimaticShotBinding };
export type H3StillJob = Omit<H3StillJobInput, "attempt"> & { version: 1; id: string; attempt: number; state: H3StillState;
  createdAt: string; updatedAt: string; runId?: string; promptId?: string; workflowSha256?: string; providerSchemaSha256?: string;
  /** Unique execution claim before POST; a same-run CAS observer cannot inherit another execution's submission permission. */
  submissionClaimId?: string;
  cancelRequestedAt?: string; error?: string; result?: H3StillResult;
  workerRecoveries?: { previousRunId: string; runId: string; createdAt: string }[] };

const MAX_BYTES = 128 * 1024;
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const text = (v: unknown, max = 512): v is string => typeof v === "string" && v.trim() === v && v.length > 0 && v.length <= max && !/[\x00-\x1f\x7f]/.test(v);
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
const terminal = (state: H3StillState) => ["ready", "failed", "cancelled"].includes(state);
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const same = (a: unknown, b: unknown) => a === undefined || b === undefined ? a === b : h3StillDigest(a) === h3StillDigest(b);

function scope(ownerId: string, projectId: string) {
  if (!ownerId || normalizeStudioOwnerSegment(ownerId) !== ownerId || !projectId || normalizeStudioProjectId(projectId) !== projectId) throw new Error("Invalid owned H3 still scope.");
  return `media-uploads/projects/${ownerId}/still-jobs/${projectId}/`;
}
function key(ownerId: string, projectId: string, id: string) {
  if (!/^h3-still-[a-f0-9]{64}$/.test(id)) throw new Error("Invalid H3 still job identifier.");
  return `${scope(ownerId, projectId)}${id}.json`;
}
function intentKey(ownerId: string, projectId: string, intent: string, attempt: number) {
  return `${scope(ownerId, projectId)}intent-${intent}-${attempt}.json`;
}
type StillIntentClaim = { version: 1; ownerId: string; projectId: string; requestIntentId: string; attempt: number; jobId: string };
type StillIntentRejection = Omit<StillIntentClaim, "jobId"> & { state: "rejected-before-job" };
export class H3StillIntentRejectedError extends Error {
  constructor() { super("This still intent was rejected before job creation. No generation was submitted."); }
}
function validateIntent(ownerId: string, projectId: string, requestIntentId: string, attempt: number) {
  scope(ownerId, projectId);
  if (!uuid(requestIntentId) || !Number.isInteger(attempt) || attempt < 0 || attempt > 2) throw new Error("Choose a valid original H3 still intent and attempt.");
}
function parseIntent(value: unknown, ownerId: string, projectId: string, requestIntentId: string, attempt: number): StillIntentClaim | StillIntentRejection {
  const claim = value as StillIntentClaim & Partial<StillIntentRejection>;
  const rejected = claim?.state === "rejected-before-job";
  const fields = ["version", "ownerId", "projectId", "requestIntentId", "attempt", rejected ? "state" : "jobId"];
  if (!claim || typeof claim !== "object" || Array.isArray(claim) || Buffer.byteLength(JSON.stringify(claim), "utf8") > 4096
    || claim.version !== 1 || claim.ownerId !== ownerId || claim.projectId !== projectId || claim.requestIntentId !== requestIntentId
    || claim.attempt !== attempt || Object.keys(claim).some(field => !fields.includes(field)) || fields.some(field => !Object.hasOwn(claim, field))
    || !rejected && !/^h3-still-[a-f0-9]{64}$/.test(claim.jobId)) throw new Error("Stored H3 still intent ownership differs.");
  return claim;
}
/** A rejection and a creation claim compete for the SAME conditional key.
 * An active claim (even before its job write) must never be cleared or replaced.
 * Unknown storage outcomes are not proof of rejection and must retain the intent. */
export async function rejectH3StillIntent(ownerId: string, projectId: string, requestIntentId: string, attempt: number,
  objects: StudioJsonObjectStore = studioProjectObjects): Promise<boolean> {
  validateIntent(ownerId, projectId, requestIntentId, attempt);
  const objectKey = intentKey(ownerId, projectId, requestIntentId, attempt);
  const rejection: StillIntentRejection = { version: 1, ownerId, projectId, requestIntentId, attempt, state: "rejected-before-job" };
  const read = async () => {
    const record = await objects.read<unknown>(objectKey);
    return record ? parseIntent(record.value, ownerId, projectId, requestIntentId, attempt) : null;
  };
  const existing = await read();
  if (existing) return "state" in existing;
  try { await objects.write(objectKey, rejection, null); return true; }
  catch (error) {
    const restored = await read();
    if (restored) return "state" in restored;
    throw error;
  }
}
function frozen(input: H3StillJobInput) {
  const detached = clone(input), { ownerId, projectId } = detached;
  scope(ownerId, projectId);
  const attempt = detached.attempt ?? 0, descriptor = freezeH3Still(detached.descriptor?.body);
  const shotRequest = clone(parseH3Request(detached.shotRequest));
  const template = detached.template;
  if (!uuid(detached.requestIntentId) || !Number.isInteger(attempt) || attempt < 0 || attempt > 2
    || detached.shotRequest.conditioning !== undefined || !same(descriptor, detached.descriptor)
    || descriptor.body.ownerId !== ownerId || descriptor.body.projectId !== projectId || shotRequest.projectId !== projectId
    || descriptor.body.planSignature !== shotRequest.planSignature
    || descriptor.body.target.timelineItemId !== shotRequest.timelineItemId || descriptor.body.target.sectionId !== shotRequest.sectionId
    || descriptor.body.target.requirementId !== shotRequest.requirementId || descriptor.body.target.songStart !== shotRequest.songStart
    || descriptor.body.target.songEnd !== shotRequest.songEnd
    || !same(descriptor.body.references.map(ref => ref.assetId), shotRequest.referenceAssetIds)) throw new Error("H3 still descriptor differs from its frozen shot and owned intent.");
  const templateFields = ["version", "id", "ownerId", "projectId", "profile", "conditioningPreparationVersion", "request", "references", "target", "state", "createdAt", "updatedAt", "referenceHashes"];
  if (!template || template.version !== 1 || !/^h3-[a-f0-9]{64}$/.test(template.id) || template.ownerId !== ownerId || template.projectId !== projectId
    || template.state !== "queued" || Object.keys(template).some(field => !templateFields.includes(field))
    || !text(template.profile) || !Number.isFinite(Date.parse(template.createdAt)) || !Number.isFinite(Date.parse(template.updatedAt))
    || !same(template.request, shotRequest) || template.target?.planSignature !== shotRequest.planSignature
    || !same({ timelineItemId: template.target.timelineItemId, sectionId: template.target.sectionId,
      ...(template.target.requirementId === undefined ? {} : { requirementId: template.target.requirementId }), songStart: template.target.songStart, songEnd: template.target.songEnd }, descriptor.body.target)
    || !same(template.references.map(ref => ({ assetId: ref.assetId, canonicalName: ref.canonicalName, role: ref.role, bucket: ref.bucket, objectKey: ref.objectKey, version: ref.version, etag: ref.etag })), descriptor.body.references.map(({ rawSha256: _hash, ...ref }) => { void _hash; return ref; }))
    || (template.referenceHashes !== undefined && !same(template.referenceHashes, descriptor.body.references.map(ref => ref.rawSha256)))) throw new Error("H3 still template differs from its frozen owned shot and raw references.");
  if (detached.sceneProof && detached.animaticShot) throw new Error("A still cannot target both a scene proof and an animatic shot.");
  return { ownerId, projectId, descriptor, shotRequest, template, requestIntentId: detached.requestIntentId, attempt,
    ...(detached.sceneProof === undefined ? {} : { sceneProof: parseH3SceneProofBinding(detached.sceneProof) }),
    ...(detached.animaticShot === undefined ? {} : { animaticShot: parseAnimaticShotBinding(detached.animaticShot) }) };
}
function identity(input: ReturnType<typeof frozen>) {
  // Materialization stamps fresh metadata on every lookup. Those two clocks do
  // not change a GPU request; the first stored template still remains immutable.
  const { createdAt: _created, updatedAt: _updated, ...template } = input.template; void _created; void _updated;
  return `h3-still-${h3StillDigest({ ...input, template })}`;
}
function bounded(job: H3StillJob) {
  if (Buffer.byteLength(JSON.stringify(job), "utf8") > MAX_BYTES) throw new Error("H3 still job exceeds its storage bound.");
}
function validate(job: H3StillJob, ownerId: string, projectId: string, id: string) {
  bounded(job);
  const initial = frozen(job);
  const fields = ["version", "id", "ownerId", "projectId", "descriptor", "shotRequest", "template", "requestIntentId", "attempt", "state", "createdAt", "updatedAt", "runId", "promptId", "workflowSha256", "providerSchemaSha256", "submissionClaimId", "cancelRequestedAt", "error", "result", "workerRecoveries", "sceneProof", "animaticShot"];
  if (job.version !== 1 || job.ownerId !== ownerId || job.projectId !== projectId || job.id !== id || identity(initial) !== id
    || Object.keys(job).some(field => !fields.includes(field)) || !Object.hasOwn(transitions, job.state)
    || !text(job.createdAt) || !Number.isFinite(Date.parse(job.createdAt)) || !text(job.updatedAt) || !Number.isFinite(Date.parse(job.updatedAt))
    || Date.parse(job.updatedAt) < Date.parse(job.createdAt)
    || (job.runId !== undefined && !text(job.runId, 256)) || (job.promptId !== undefined && (!text(job.promptId, 256) || !job.runId || !hash(job.workflowSha256)))
    || (job.workflowSha256 !== undefined && !hash(job.workflowSha256)) || (job.providerSchemaSha256 !== undefined && !hash(job.providerSchemaSha256))
    || (job.submissionClaimId !== undefined && (!uuid(job.submissionClaimId) || !job.runId || !hash(job.workflowSha256)))
    || (job.cancelRequestedAt !== undefined && (!text(job.cancelRequestedAt) || !Number.isFinite(Date.parse(job.cancelRequestedAt)) || Date.parse(job.cancelRequestedAt) > Date.parse(job.updatedAt)))
    || (job.error !== undefined && !text(job.error, 2048))
    || (["submitting", "submission_unknown", "rendering", "persisting", "ready"].includes(job.state) && (!job.runId || !job.workflowSha256))
    || (["rendering", "persisting", "ready"].includes(job.state) && !job.promptId)
    || (job.state === "cancel_requested" && !job.cancelRequestedAt) || (job.result !== undefined && job.state !== "ready")
    || (job.state === "ready" && !job.result)) throw new Error("Stored H3 still job is malformed or its frozen identity changed.");
  if (job.workerRecoveries !== undefined) {
    const recoveries = job.workerRecoveries;
    if (!Array.isArray(recoveries) || recoveries.length < 1 || recoveries.length > 8 || !job.workflowSha256
      || recoveries.some((entry, index) => !entry || Object.keys(entry).some(field => !["previousRunId", "runId", "createdAt"].includes(field))
        || !text(entry.previousRunId, 256) || !text(entry.runId, 256) || entry.previousRunId === entry.runId
        || !text(entry.createdAt) || !Number.isFinite(Date.parse(entry.createdAt))
        || Date.parse(entry.createdAt) < Date.parse(job.createdAt) || Date.parse(entry.createdAt) > Date.parse(job.updatedAt)
        || (index > 0 && (entry.previousRunId !== recoveries[index - 1].runId || Date.parse(entry.createdAt) < Date.parse(recoveries[index - 1].createdAt))))
      || new Set([recoveries[0].previousRunId, ...recoveries.map(entry => entry.runId)]).size !== recoveries.length + 1
      || recoveries.at(-1)!.runId !== job.runId) throw new Error("H3 still recovery ownership history is invalid.");
  }
  if (job.result) {
    const result = job.result, prefix = `media-uploads/projects/${ownerId}/still-results/${projectId}/${id}/`;
    if (Object.keys(result).some(field => !["master", "native", "artifactId", "artifactSha256"].includes(field))
      || !hash(result.artifactSha256) || result.artifactId !== `h3-frame-${result.artifactSha256}`) throw new Error("Invalid H3 still artifact binding.");
    for (const [name, width, height] of [["master", 2048, 1152], ["native", 1344, 768]] as const) {
      const image = result[name];
      if (!image || Object.keys(image).some(field => !["bucket", "objectKey", "sha256", "byteLength", "width", "height"].includes(field))
        || !text(image.bucket, 256) || image.objectKey !== `${prefix}${name}.png` || !hash(image.sha256)
        || !Number.isSafeInteger(image.byteLength) || image.byteLength <= 0 || image.byteLength > 32 * 1024 * 1024
        || image.width !== width || image.height !== height) throw new Error("Invalid owned H3 still image binding.");
    }
    if (result.master.bucket !== result.native.bucket) throw new Error("H3 still image buckets differ.");
  }
  return job;
}

const transitions: Record<H3StillState, H3StillState[]> = {
  queued: ["preparing", "failed", "cancel_requested", "cancelled"], preparing: ["submitting", "failed", "cancel_requested", "cancelled"],
  submitting: ["rendering", "submission_unknown", "failed", "cancel_requested"], submission_unknown: ["rendering", "failed", "cancel_requested"],
  rendering: ["persisting", "submission_unknown", "failed", "cancel_requested"], persisting: ["ready", "submission_unknown", "failed", "cancel_requested"],
  cancel_requested: ["cancelled"], ready: [], failed: [], cancelled: [],
};

/** Pure structural/frozen-binding assertion; it makes no storage or provider request. */
export function assertH3StillJob(job: H3StillJob) { return validate(job, job.ownerId, job.projectId, job.id); }

export async function readH3StillJob(ownerId: string, projectId: string, id: string, objects: StudioJsonObjectStore = studioProjectObjects): Promise<H3StillJob | null> {
  const stored = await objects.read<H3StillJob>(key(ownerId, projectId, id));
  return stored ? validate(stored.value, ownerId, projectId, id) : null;
}

/** Restore a lost creation ACK from its original owned still intent. This is a
 * read-only history lookup: current project edits neither invalidate the frozen
 * job nor authorize materialization, dispatch, or replacement generation.
 */
export async function readH3StillJobByIntent(ownerId: string, projectId: string, requestIntentId: string, attempt: number,
  objects: StudioJsonObjectStore = studioProjectObjects): Promise<H3StillJob | null> {
  validateIntent(ownerId, projectId, requestIntentId, attempt);
  const record = await objects.read<unknown>(intentKey(ownerId, projectId, requestIntentId, attempt));
  if (!record) return null;
  const claim = parseIntent(record.value, ownerId, projectId, requestIntentId, attempt);
  if ("state" in claim) throw new H3StillIntentRejectedError();
  const job = await readH3StillJob(ownerId, projectId, claim.jobId, objects);
  if (!job) throw new StudioProjectConflictError("This still intent is reserved but its durable job is not confirmed. Check the same intent again; no replacement was submitted.");
  if (job.requestIntentId !== requestIntentId || job.attempt !== attempt) throw new Error("Stored H3 still job differs from its original intent.");
  return job;
}

/** Claim a separate still intent before creating its job. An uncertain ACK is read back, never blindly repeated. */
export async function createH3StillJob(input: H3StillJobInput, objects: StudioJsonObjectStore = studioProjectObjects): Promise<H3StillJob> {
  const body = frozen(input), id = identity(body), objectKey = key(body.ownerId, body.projectId, id);
  const now = new Date().toISOString(), job: H3StillJob = { version: 1, id, ...body, state: "queued", createdAt: now, updatedAt: now };
  bounded(job);
  const claim: StillIntentClaim = { version: 1, ownerId: body.ownerId, projectId: body.projectId, requestIntentId: body.requestIntentId, attempt: body.attempt, jobId: id };
  const claimKey = intentKey(body.ownerId, body.projectId, body.requestIntentId, body.attempt);
  const readClaim = async (attempt: number) => {
    const record = await objects.read<unknown>(intentKey(body.ownerId, body.projectId, body.requestIntentId, attempt));
    if (!record) return null;
    const value = parseIntent(record.value, body.ownerId, body.projectId, body.requestIntentId, attempt);
    if ("state" in value) throw new H3StillIntentRejectedError();
    return value;
  };
  const existingClaim = await readClaim(body.attempt);
  if (existingClaim && !same(existingClaim, claim)) throw new StudioProjectConflictError("This still intent already identifies another frozen image request.");
  if (!existingClaim) {
    if (body.attempt > 0) {
      const previous = await readClaim(body.attempt - 1), previousJob = previous ? await readH3StillJob(body.ownerId, body.projectId, previous.jobId, objects) : null;
      if (!previousJob || !terminal(previousJob.state)) throw new StudioProjectConflictError("Reconcile the preceding still attempt before requesting another image revision.");
    }
    try { await objects.write(claimKey, claim, null); }
    catch (error) { if (!same(await readClaim(body.attempt), claim)) throw error; }
  }
  const existing = await readH3StillJob(body.ownerId, body.projectId, id, objects);
  if (existing) return existing;
  try { await objects.write(objectKey, job, null); return job; }
  catch (error) { const restored = await readH3StillJob(body.ownerId, body.projectId, id, objects); if (restored) return restored; throw error; }
}

async function mutate(ownerId: string, projectId: string, id: string, change: (current: H3StillJob) => H3StillJob, objects: StudioJsonObjectStore,
  recovery?: { previousRunId: string; runId: string }) {
  const objectKey = key(ownerId, projectId, id);
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await objects.read<H3StillJob>(objectKey);
    if (!current) throw new Error("H3 still job not found.");
    validate(current.value, ownerId, projectId, id);
    const next = clone(change(clone(current.value)));
    if (same(next, current.value)) return current.value;
    if (!same(frozen(next), frozen(current.value)) || next.createdAt !== current.value.createdAt
      || (terminal(current.value.state)) || (next.state !== current.value.state && !transitions[current.value.state].includes(next.state))
      || (current.value.runId && next.runId !== current.value.runId && (!recovery || current.value.runId !== recovery.previousRunId || next.runId !== recovery.runId))
      || (!recovery && !same(next.workerRecoveries, current.value.workerRecoveries))
      || (["promptId", "workflowSha256", "providerSchemaSha256", "submissionClaimId", "cancelRequestedAt", "result"] as const).some(field => current.value[field] !== undefined && !same(next[field], current.value[field]))) throw new Error("H3 still frozen data, ownership, result or state transition cannot change.");
    next.updatedAt = new Date(Math.max(Date.now(), Date.parse(current.value.updatedAt))).toISOString();
    validate(next, ownerId, projectId, id);
    try { await objects.write(objectKey, next, current.revision); return next; }
    catch (error) {
      const restored = await objects.read<H3StillJob>(objectKey);
      if (restored) { validate(restored.value, ownerId, projectId, id); if (same(restored.value, next)) return restored.value; }
      if (!(error instanceof StudioProjectConflictError)) throw error;
    }
  }
  throw new StudioProjectConflictError("H3 still job changed concurrently; reload its durable status.");
}

/** Worker may claim the run once; a stale run cannot mutate a recovered/current owner. */
export async function updateH3StillJob(ownerId: string, projectId: string, id: string, runId: string,
  change: (current: H3StillJob) => H3StillJob, objects: StudioJsonObjectStore = studioProjectObjects) {
  if (!text(runId, 256)) throw new Error("An exact H3 still worker run is required.");
  return mutate(ownerId, projectId, id, current => {
    if (current.runId && current.runId !== runId) throw new Error("A different worker run owns this H3 still job.");
    const next = change(current);
    if (next.runId !== undefined && next.runId !== runId) throw new Error("H3 still worker ownership cannot change.");
    return { ...next, runId };
  }, objects);
}

/** Authenticated UI cancellation never claims worker ownership or accepts an image result. */
export async function requestH3StillCancellation(ownerId: string, projectId: string, id: string, objects: StudioJsonObjectStore = studioProjectObjects) {
  return mutate(ownerId, projectId, id, current => terminal(current.state) || current.cancelRequestedAt ? current
    : { ...current, state: current.runId ? "cancel_requested" : "cancelled", cancelRequestedAt: new Date().toISOString() }, objects);
}

/** Authority boundary: caller must first prove the exact owned Trigger run is
 * terminal. This never clears ownership or makes a frozen attempt submit again.
 * Missing provider history is not evidence for this operation: every durable
 * submission marker must still be absent in the winning conditional write.
 */
export async function finishH3StillPreparation(ownerId: string, projectId: string, id: string, expectedRunId: string,
  objects: StudioJsonObjectStore = studioProjectObjects) {
  if (!text(expectedRunId, 256)) throw new Error("An exact terminal still worker run is required.");
  return mutate(ownerId, projectId, id, current => {
    if (current.runId !== expectedRunId || current.workflowSha256 !== undefined || current.providerSchemaSha256 !== undefined
      || current.submissionClaimId !== undefined || current.promptId !== undefined || current.result !== undefined || current.workerRecoveries?.length
      || !["queued", "preparing", "cancel_requested", "failed", "cancelled"].includes(current.state)) {
      throw new StudioProjectConflictError("The still worker or submission boundary changed; reload its existing attempt.");
    }
    if (current.state === "failed" || current.state === "cancelled") return current;
    return { ...current, state: current.cancelRequestedAt || current.state === "cancel_requested" ? "cancelled" : "failed",
      error: "The previous worker ended before submitting this still. Start an explicit new still attempt to continue." };
  }, objects);
}

/** Trust boundary: the authenticated orchestrator must first retrieve the exact
 * owned previous Trigger run and prove it terminal. Only its explicit reconcile
 * dispatch may call this seam; these parameters are not client authorization.
 * This transfers observation of an existing provider boundary, never permission
 * to submit another prompt. The runner must remain on its read-only path.
 */
export async function claimH3StillReconciliation(ownerId: string, projectId: string, id: string, expectedPreviousRunId: string, newRunId: string,
  objects: StudioJsonObjectStore = studioProjectObjects) {
  if (!text(expectedPreviousRunId, 256) || !text(newRunId, 256) || expectedPreviousRunId === newRunId) throw new Error("Explicit distinct H3 still recovery runs are required.");
  return mutate(ownerId, projectId, id, current => {
    const history = current.workerRecoveries ?? [], last = history.at(-1);
    if (current.runId === newRunId && last?.previousRunId === expectedPreviousRunId && last.runId === newRunId) return current;
    if (current.runId !== expectedPreviousRunId || !["submitting", "submission_unknown", "rendering", "persisting", "cancel_requested"].includes(current.state)
      || !hash(current.workflowSha256) || history.length >= 8 || history.some(entry => entry.previousRunId === newRunId || entry.runId === newRunId)) throw new StudioProjectConflictError("Only the exact previous still worker at an existing provider boundary may be reconciled.");
    return { ...current, runId: newRunId, workerRecoveries: [...history, { previousRunId: expectedPreviousRunId, runId: newRunId,
      createdAt: new Date(Math.max(Date.now(), Date.parse(current.updatedAt))).toISOString() }] };
  }, objects, { previousRunId: expectedPreviousRunId, runId: newRunId });
}
