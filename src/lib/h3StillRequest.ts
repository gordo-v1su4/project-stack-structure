import type { H3GenerationJob, H3GenerationRequest } from "@/components/studio/h3Generation";
import { H3_FIRST_FRAME_PROFILE } from "@/components/studio/h3FirstFrame";
import { H3RequestError, parseH3Request } from "./h3GenerationServer";
import { assertH3ShotProfile, compileH3Prompt } from "./h3Workflow";
import { freezeH3Still, h3StillDigest, type H3StillDescriptor } from "./h3StillProfile";
import type { SceneProofBinding } from "@/components/studio/sceneProofs";

export type H3StillRequest = { shot: H3GenerationRequest; creativePrompt: string; seed: number; requestIntentId: string; attempt: number; sceneProof?: SceneProofBinding; animaticShot?: import("@/components/studio/stillAnimatic").AnimaticShotBinding };
export type H3StillReferenceReceipt = { assetId: string; etag: string; rawSha256: string };
const SHOT_FIELDS = ["projectId", "planSignature", "requirementId", "timelineItemId", "sectionId", "songStart", "songEnd", "prompt",
  "referenceAssetIds", "requestIntentId", "attempt", "seed", "draftRevision", "identityPolicyFamily"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const detached = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function parseH3SceneProofBinding(value: unknown): SceneProofBinding {
  const binding = value as SceneProofBinding;
  if (!binding || typeof binding !== "object" || Array.isArray(binding)
    || Object.keys(binding).some(key => !["sceneId", "momentId", "bindingSha256"].includes(key))
    || typeof binding.sceneId !== "string" || !binding.sceneId.trim() || binding.sceneId.length > 200 || /[\x00-\x1f\x7f]/.test(binding.sceneId)
    || !["setting", "action", "transition"].includes(binding.momentId) || !hash(binding.bindingSha256)) throw new H3RequestError("Use the exact saved scene preview binding.");
  return { sceneId: binding.sceneId, momentId: binding.momentId, bindingSha256: binding.bindingSha256 };
}

/** Browser input contains creative intent and project identities, never a workflow or backend path. */
export function parseAnimaticShotBinding(value: unknown): NonNullable<H3StillRequest["animaticShot"]> {
  const binding = value as NonNullable<H3StillRequest["animaticShot"]>;
  if (!binding || typeof binding !== "object" || Array.isArray(binding)
    || Object.keys(binding).some(key => !["shotId", "bindingSha256"].includes(key))
    || typeof binding.shotId !== "string" || !/^[A-Za-z0-9_-]{1,96}$/.test(binding.shotId) || !hash(binding.bindingSha256)) throw new H3RequestError("Use the exact saved animatic shot binding.");
  return { shotId: binding.shotId, bindingSha256: binding.bindingSha256 };
}

export function parseH3StillRequest(value: unknown): H3StillRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new H3RequestError("A still request is required.");
  const root = value as Record<string, unknown>;
  if (Object.keys(root).some(key => !["shot", "creativePrompt", "seed", "requestIntentId", "attempt", "sceneProof", "animaticShot"].includes(key))) throw new H3RequestError("Unknown still request field.");
  if (root.sceneProof !== undefined && root.animaticShot !== undefined) throw new H3RequestError("Choose a scene proof or an animatic shot.");
  if (!root.shot || typeof root.shot !== "object" || Array.isArray(root.shot)
    || Object.keys(root.shot).some(key => !SHOT_FIELDS.includes(key))) throw new H3RequestError("Use an unconditioned future video shot without workflow fields.");
  if (typeof root.creativePrompt !== "string" || !root.creativePrompt.trim() || root.creativePrompt !== root.creativePrompt.trim()
    || Buffer.byteLength(root.creativePrompt, "utf8") > 6000) throw new H3RequestError("Use bounded visible entry-scene prose for the still.");
  if (!Number.isSafeInteger(root.seed) || (root.seed as number) < 0 || (root.seed as number) > 0xffffffff
    || typeof root.requestIntentId !== "string" || !UUID.test(root.requestIntentId)
    || !Number.isSafeInteger(root.attempt) || (root.attempt as number) < 0 || (root.attempt as number) > 2) throw new H3RequestError("Use an independent still UUID, uint32 seed and attempt 0–2.");
  let bytes: number;
  try { bytes = Buffer.byteLength(JSON.stringify(root), "utf8"); } catch { throw new H3RequestError("Still input must be bounded JSON."); }
  if (bytes > 32 * 1024) throw new H3RequestError("Still input exceeds its byte bound.");
  const shot = parseH3Request(root.shot);
  // Reuse the official wrapper/language admission for creative prose, without
  // replacing or incrementing the independently frozen future video request.
  parseH3Request({ ...shot, prompt: root.creativePrompt });
  return { shot: detached(shot), creativePrompt: root.creativePrompt, seed: root.seed as number,
    requestIntentId: root.requestIntentId, attempt: root.attempt as number,
    ...(root.sceneProof === undefined ? {} : { sceneProof: parseH3SceneProofBinding(root.sceneProof) }),
    ...(root.animaticShot === undefined ? {} : { animaticShot: parseAnimaticShotBinding(root.animaticShot) }) };
}

/** The caller must materialize against the fresh owned project and conditionally
 * read raw references first. Receipts bind that actual ordered read to pinned
 * etags; descriptor versions come exclusively from the canonical job snapshots.
 */
export function buildH3StillDescriptor(request: H3StillRequest, pinnedJob: H3GenerationJob, receipts: H3StillReferenceReceipt[]): H3StillDescriptor {
  const parsed = parseH3StillRequest(request);
  if (!pinnedJob || pinnedJob.profile === H3_FIRST_FRAME_PROFILE || pinnedJob.request.conditioning || pinnedJob.firstFrame
    || pinnedJob.projectId !== parsed.shot.projectId
    || h3StillDigest(detached(parseH3Request(pinnedJob.request))) !== h3StillDigest(parsed.shot)
    || pinnedJob.target.planSignature !== parsed.shot.planSignature || pinnedJob.target.sectionId !== parsed.shot.sectionId
    || pinnedJob.target.songStart !== parsed.shot.songStart || pinnedJob.target.songEnd !== parsed.shot.songEnd
    || parsed.shot.timelineItemId !== undefined && pinnedJob.target.timelineItemId !== parsed.shot.timelineItemId
    || parsed.shot.requirementId !== undefined && pinnedJob.target.requirementId !== parsed.shot.requirementId) throw new H3RequestError("Still request differs from its canonical future video shot.", 409);
  if (!Array.isArray(receipts) || receipts.length !== pinnedJob.references.length || receipts.length < 1 || receipts.length > 9
    || parsed.shot.referenceAssetIds.length !== pinnedJob.references.length
    || pinnedJob.referenceHashes && pinnedJob.referenceHashes.length !== pinnedJob.references.length) throw new H3RequestError("Still raw-reference receipts differ from the canonical reference order.", 409);
  const references = pinnedJob.references.map((reference, index) => {
    const receipt = receipts[index];
    if (!receipt || Object.keys(receipt).some(key => !["assetId", "etag", "rawSha256"].includes(key))
      || receipt.assetId !== reference.assetId || parsed.shot.referenceAssetIds[index] !== reference.assetId
      || !reference.version || !reference.etag || receipt.etag !== reference.etag || !hash(receipt.rawSha256)
      || pinnedJob.referenceHashes && pinnedJob.referenceHashes[index] !== receipt.rawSha256) throw new H3RequestError("Still raw references changed after canonical pinning.", 409);
    return { assetId: reference.assetId, canonicalName: reference.canonicalName, role: reference.role, bucket: reference.bucket,
      objectKey: reference.objectKey, version: reference.version, etag: reference.etag, rawSha256: receipt.rawSha256 };
  });
  // Reuse native grammar without future-video timestamps. Conditioning has five
  // frames at 24 FPS; the Fizgig latent sampled by this profile remains T=1.
  let prompt: string;
  try {
    const compiled = compileH3Prompt({ ...pinnedJob, request: { ...pinnedJob.request, prompt: parsed.creativePrompt } });
    assertH3ShotProfile(compiled.frameSchedule["0"], 5 / 24);
    prompt = compiled.prompt;
  }
  catch { throw new H3RequestError("The still entry scene failed native prompt and reference admission. Use positive visible prose with the exact named references.", 422); }
  try { return freezeH3Still({ ownerId: pinnedJob.ownerId, projectId: pinnedJob.projectId, planSignature: pinnedJob.target.planSignature!,
    target: { timelineItemId: pinnedJob.target.timelineItemId, sectionId: pinnedJob.target.sectionId,
      ...(pinnedJob.target.requirementId ? { requirementId: pinnedJob.target.requirementId } : {}),
      songStart: pinnedJob.target.songStart, songEnd: pinnedJob.target.songEnd },
    prompt, seed: parsed.seed, references }); }
  catch { throw new H3RequestError("The canonical still descriptor failed its profile or reference bounds.", 422); }
}
