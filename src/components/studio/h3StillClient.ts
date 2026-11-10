import { isH3JobTerminal, type H3GenerationJob, type H3GenerationRequest } from "./h3Generation";
import { nextH3Attempt } from "./h3DraftPlan";
import type { H3FirstFrameChoice } from "./h3FirstFrame";
import { identityPolicySha256 } from "./issuedIdentityPolicy";
import type { H3StillJob } from "@/lib/h3StillJobStore";
import type { ReferenceAsset } from "./referenceAssets";
import type { SceneProofBinding } from "./sceneProofs";

export type StillClientRequest = { shot: H3GenerationRequest; creativePrompt: string; seed: number; requestIntentId: string; attempt: number; sceneProof?: SceneProofBinding; animaticShot?: import("./stillAnimatic").AnimaticShotBinding };
export type StillClientRecord = { version: 1; projectId: string; context: string; request: StillClientRequest; jobId?: string };
export class StillClientAdmissionError extends Error {}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const jobId = /^h3-still-[a-f0-9]{64}$/;
export const stillClientStorageKey = (projectId: string, storageScope?: string) => storageScope === undefined
  ? `studio-minimax-still-v1:${projectId}`
  : `studio-minimax-still-v1:${projectId}:moment:${encodeURIComponent(storageScope)}`;
export const stillClientRecordBinding = (record: StillClientRecord) => identityPolicySha256({ projectId: record.projectId, context: record.context, request: record.request });
/** A late response may attach its job ID only to the same still intent that is
 * currently stored. It cannot roll an A→B→A project switch back to an older take.
 */
export function acknowledgeStillClientRecord(storage: Pick<Storage, "getItem" | "setItem">, next: StillClientRecord, storageScope?: string): boolean {
  const accepted = parseStillClientRecord(next, next.projectId);
  if (!accepted?.jobId) return false;
  const key = stillClientStorageKey(next.projectId, storageScope);
  const current = parseStillClientRecord(JSON.parse(storage.getItem(key) ?? "null"), next.projectId);
  if (!current || stillClientRecordBinding(current) !== stillClientRecordBinding(accepted) || current.jobId !== undefined && current.jobId !== accepted.jobId) return false;
  storage.setItem(key, JSON.stringify(accepted));
  return true;
}
export const isStillTerminal = (state: string) => ["ready", "failed", "cancelled"].includes(state);
/** A rejected response can release only its exact current unacknowledged intent. */
export function releaseRejectedStillRecord(storage: Pick<Storage, "getItem" | "removeItem">, rejected: StillClientRecord, storageScope?: string): boolean {
  const key = stillClientStorageKey(rejected.projectId, storageScope);
  const current = parseStillClientRecord(JSON.parse(storage.getItem(key) ?? "null"), rejected.projectId);
  if (!current || current.jobId || identityPolicySha256(current) !== identityPolicySha256(rejected)) return false;
  storage.removeItem(key);
  return true;
}
/** Persist the intent in the owning project before the sole POST. A rejected
 * save or changed moment leaves the provider untouched, including when the
 * persistence callback itself changes the mounted scene. */
export async function submitStillClientIntent(record: StillClientRecord, options: {
  storage: Pick<Storage, "setItem">; storageScope?: string;
  onRecord?: (record: StillClientRecord) => void | Promise<void>;
  isCurrent: () => boolean; fetchImpl?: typeof fetch;
}): Promise<H3StillJob> {
  const frozen = parseStillClientRecord(record, record.projectId);
  if (!frozen || !options.isCurrent()) throw new Error("The still moment changed before its intent was saved.");
  await options.onRecord?.(frozen);
  if (!options.isCurrent()) throw new Error("The still moment changed while its intent was saved. No generation was submitted.");
  options.storage.setItem(stillClientStorageKey(frozen.projectId, options.storageScope), JSON.stringify(frozen));
  return stillClientRequest("POST", frozen, options.fetchImpl);
}
/** Recovery binds canonical shot context, never transient form values or browser URLs. */
export function stillCanonicalContext(value: { projectId: string | null; windowKey: string; references: ReferenceAsset[];
  plan: unknown; currentIdentity: unknown; storyApproved: boolean }) {
  return identityPolicySha256({ ...value, references: value.references.map(ref => ({ id: ref.id, role: ref.role, kind: ref.kind,
    name: ref.displayName, bucket: ref.storageBucket, key: ref.storagePath, createdAt: ref.createdAt, status: ref.storageStatus })) });
}
export function restoreStillShotForm(shot: H3GenerationRequest) {
  return { direction: shot.prompt, duration: String(shot.songEnd - shot.songStart) };
}
export function sameStillFutureCreative(a: H3GenerationRequest, b: H3GenerationRequest) {
  const creative = (shot: H3GenerationRequest) => ({ projectId: shot.projectId, planSignature: shot.planSignature,
    requirementId: shot.requirementId, timelineItemId: shot.timelineItemId, sectionId: shot.sectionId,
    songStart: shot.songStart, songEnd: shot.songEnd, prompt: shot.prompt, referenceAssetIds: shot.referenceAssetIds,
    identityPolicyFamily: shot.identityPolicyFamily, conditioning: shot.conditioning });
  return identityPolicySha256(creative(a)) === identityPolicySha256(creative(b));
}
export function canCreateStill(record: StillClientRecord | null, job: H3StillJob | null) {
  if (!record) return true;
  try { return Boolean(job && isStillTerminal(assertStillClientJob(job, record).state)); } catch { return false; }
}
/** Explicit Create-video admission only. Image generation consumes no video attempt. */
export function buildStillVideoRequest(selection: { shot: H3GenerationRequest; conditioning: H3FirstFrameChoice }, jobs: H3GenerationJob[], newIntent = () => crypto.randomUUID()): H3GenerationRequest {
  const shot = JSON.parse(JSON.stringify(selection.shot)) as H3GenerationRequest, conditioning = { ...selection.conditioning };
  if (shot.conditioning || conditioning.kind !== "first-frame" || !/^h3-frame-[a-f0-9]{64}$/.test(conditioning.artifactId)
    || !/^[a-f0-9]{64}$/.test(conditioning.expectedSha256)) throw new Error("Choose a frozen unconditioned video shot and exact first frame.");
  const siblings = jobs.filter(job => job.projectId === shot.projectId);
  const matching = siblings.filter(job => sameStillFutureCreative({ ...job.request, conditioning: undefined }, shot));
  if (matching.some(job => !isH3JobTerminal(job))) throw new Error("Review the active video submission before creating another take.");
  const sameFrame = matching.filter(job => identityPolicySha256(job.request.conditioning ?? null) === identityPolicySha256(conditioning))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || (b.request.attempt ?? 0) - (a.request.attempt ?? 0));
  if (sameFrame[0]) {
    const retry = nextH3Attempt(sameFrame[0], siblings, shot.draftRevision ?? 0);
    return { ...shot, conditioning, requestIntentId: retry.requestIntentId, attempt: retry.attempt };
  }
  return { ...shot, conditioning,
    ...(siblings.some(job => job.request.requestIntentId === shot.requestIntentId) ? { requestIntentId: newIntent(), attempt: 0 } : {}) };
}
export function parseStillClientRecord(value: unknown, projectId: string): StillClientRecord | null {
  try {
    if (!value || typeof value !== "object" || JSON.stringify(value).length > 64 * 1024) return null;
    const v = value as StillClientRecord, r = v.request, s = r?.shot;
    if (v.version !== 1 || v.projectId !== projectId || !/^[a-f0-9]{64}$/.test(v.context) || s?.projectId !== projectId || s.conditioning
      || !uuid.test(r.requestIntentId) || !uuid.test(s.requestIntentId) || !Number.isInteger(r.attempt) || r.attempt < 0 || r.attempt > 2
      || !Number.isSafeInteger(r.seed) || r.seed < 0 || r.seed > 0xffffffff || typeof r.creativePrompt !== "string" || !r.creativePrompt.trim()
      || new TextEncoder().encode(r.creativePrompt).length > 6000 || !s.prompt || !s.planSignature || !s.sectionId
      || !Number.isFinite(s.songStart) || !Number.isFinite(s.songEnd) || s.songStart < 0 || s.songEnd <= s.songStart
      || !Array.isArray(s.referenceAssetIds) || !s.referenceAssetIds.length || s.referenceAssetIds.length > 9
      || s.referenceAssetIds.some(id => typeof id !== "string") || (v.jobId !== undefined && !jobId.test(v.jobId))) return null;
    if (r.sceneProof !== undefined && (!r.sceneProof || typeof r.sceneProof !== "object" || Array.isArray(r.sceneProof)
      || Object.keys(r.sceneProof).some(key => !["sceneId", "momentId", "bindingSha256"].includes(key))
      || typeof r.sceneProof.sceneId !== "string" || !r.sceneProof.sceneId.trim() || r.sceneProof.sceneId.length > 200 || /[\x00-\x1f\x7f]/.test(r.sceneProof.sceneId)
      || !["setting", "action", "transition"].includes(r.sceneProof.momentId) || !/^[a-f0-9]{64}$/.test(r.sceneProof.bindingSha256)
      || r.sceneProof.bindingSha256 !== v.context)) return null;
    if (r.animaticShot !== undefined && (r.sceneProof !== undefined || !r.animaticShot
      || Object.keys(r.animaticShot).some(key => !["shotId", "bindingSha256"].includes(key))
      || !/^[A-Za-z0-9_-]{1,96}$/.test(r.animaticShot.shotId) || !/^[a-f0-9]{64}$/.test(r.animaticShot.bindingSha256)
      || r.animaticShot.bindingSha256 !== v.context)) return null;
    return JSON.parse(JSON.stringify(v)) as StillClientRecord;
  } catch { return null; }
}
export function assertStillClientJob(value: unknown, record: StillClientRecord): H3StillJob {
  const job = value as H3StillJob;
  if (!job || !jobId.test(job.id) || record.jobId && job.id !== record.jobId || job.projectId !== record.projectId
    || job.requestIntentId !== record.request.requestIntentId || job.attempt !== record.request.attempt
    || identityPolicySha256(job.shotRequest) !== identityPolicySha256(record.request.shot)
    || identityPolicySha256(job.sceneProof ?? null) !== identityPolicySha256(record.request.sceneProof ?? null)
    || identityPolicySha256(job.animaticShot ?? null) !== identityPolicySha256(record.request.animaticShot ?? null)
    || job.descriptor?.body.seed !== record.request.seed || !job.descriptor.body.target
    || job.descriptor.body.target.songStart !== record.request.shot.songStart || job.descriptor.body.target.songEnd !== record.request.shot.songEnd
    || job.descriptor.body.planSignature !== record.request.shot.planSignature) throw new Error("The returned still belongs to another frozen request.");
  return job;
}
export function stillMediaUrl(image: { bucket: string; objectKey: string }) {
  return `/api/storage/media?${new URLSearchParams({ bucket: image.bucket, objectKey: image.objectKey })}`;
}
export function buildStillContinuation(record: StillClientRecord, job: H3StillJob, currentContext: string): { shot: H3GenerationRequest; conditioning: H3FirstFrameChoice } {
  assertStillClientJob(job, record);
  if (record.context !== currentContext || job.state !== "ready" || !job.result || !/^h3-frame-[a-f0-9]{64}$/.test(job.result.artifactId)
    || !/^[a-f0-9]{64}$/.test(job.result.native.sha256) || !["sface-yunet-foreground-frontal-v2", "sface-yunet-joint-frontal-v2"].includes(record.request.shot.identityPolicyFamily ?? "")) throw new Error("Review a current ready still with its frozen named character shot before using it.");
  return { shot: JSON.parse(JSON.stringify(record.request.shot)) as H3GenerationRequest,
    conditioning: { kind: "first-frame", artifactId: job.result.artifactId, expectedSha256: job.result.native.sha256 } };
}
/** One explicit request. Network uncertainty never causes automatic replay. */
export async function stillClientRequest(method: "POST" | "GET" | "PATCH" | "DELETE", record: StillClientRecord, fetchImpl: typeof fetch = fetch): Promise<H3StillJob> {
  if (method !== "POST" && method !== "GET" && !record.jobId) throw new Error("Recover the saved still intent's job ID before cancelling or reconciling it.");
  const query = new URLSearchParams(record.jobId ? { projectId: record.projectId, jobId: record.jobId }
    : { projectId: record.projectId, requestIntentId: record.request.requestIntentId, attempt: String(record.request.attempt) });
  const body = method === "POST" ? record.request : method === "PATCH" ? { projectId: record.projectId, jobId: record.jobId, requestIntentId: crypto.randomUUID() } : undefined;
  const response = await fetchImpl(`/api/generate/h3/stills${method === "GET" || method === "DELETE" ? `?${query}` : ""}`, {
    method, cache: "no-store", headers: body ? { "Content-Type": "application/json" } : undefined,
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(method === "POST" ? 180_000 : 30_000),
  });
  const value = await response.json() as { job?: unknown; error?: string; admission?: string };
  if (!response.ok) {
    if ((method === "POST" || method === "GET" && !record.jobId) && [400, 409, 422].includes(response.status) && value.admission === "rejected-before-job") throw new StillClientAdmissionError(value.error || "The still was rejected before dispatch.");
    throw new Error(value.error || "Still request could not be confirmed. Its saved intent is retained.");
  }
  return assertStillClientJob(value.job, record);
}
