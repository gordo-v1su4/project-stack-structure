import { createHash } from "node:crypto";
import { readStudioProject } from "./studioProjectStore";
import { getMediaGatewayConfig } from "./mediaGateway";
import { validateSavedGenerationScope, recordGenerationScopeBaseline, SourceConfirmationError } from "./generationScopeServer";
import { materializeH3Job, H3RequestError } from "./h3GenerationServer";
import { pinH3JobReferences, downloadH3ReferenceImage } from "./h3JobStore";
import { buildH3StillDescriptor, parseH3StillRequest, type H3StillRequest } from "./h3StillRequest";
import { createH3StillJob, rejectH3StillIntent, type H3StillJob } from "./h3StillJobStore";
import { h3StillDigest } from "./h3StillProfile";
import { assertH3SceneProofRequest, assertH3SceneProofJob } from "./h3SceneProofServer";
import { materializeAnimaticStill, savedAnimaticStillRequest, assertAnimaticStillJob } from "./h3AnimaticServer";

type Dependencies = {
  read: typeof readStudioProject; config: typeof getMediaGatewayConfig;
  validate: typeof validateSavedGenerationScope; baseline: typeof recordGenerationScopeBaseline;
  pin: typeof pinH3JobReferences; download: typeof downloadH3ReferenceImage;
  create: typeof createH3StillJob; rejectIntent: typeof rejectH3StillIntent;
};
const defaults: Dependencies = { read: readStudioProject, config: getMediaGatewayConfig,
  validate: validateSavedGenerationScope, baseline: recordGenerationScopeBaseline,
  pin: pinH3JobReferences, download: downloadH3ReferenceImage, create: createH3StillJob, rejectIntent: rejectH3StillIntent };

/** Only a known rejection before durable creation may release a browser intent.
 * A reserved intent, existing job, failed lookup or create ACK stays uncertain.
 */
export class H3StillAdmissionError extends H3RequestError {}

/** Recover only the bounded owner-scoped intent envelope, even if creative
 * grammar is rejected. This does not admit the shot or authorize generation.
 */
function stillIntentEnvelope(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const root = value as Record<string, unknown>, shot = root.shot as Record<string, unknown> | null;
  if (!shot || typeof shot !== "object" || Array.isArray(shot)
    || typeof shot.projectId !== "string" || !/^[a-zA-Z0-9_-]{1,96}$/.test(shot.projectId)
    || typeof root.requestIntentId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(root.requestIntentId)
    || !Number.isInteger(root.attempt) || (root.attempt as number) < 0 || (root.attempt as number) > 2) return null;
  return { projectId: shot.projectId, requestIntentId: root.requestIntentId, attempt: root.attempt as number };
}

/** Authenticated API/worker supplies ownerId; the browser supplies no storage or provider paths. */
export async function loadH3StillContext(ownerId: string, request: H3StillRequest,
  dependencies: Dependencies = defaults) {
  const saved = await dependencies.read(ownerId, request.shot.projectId, { fresh: true });
  const config = dependencies.config();
  if (!saved) throw new H3RequestError("Project not found.", 404);
  if (!config) throw new H3RequestError("Generation storage is unavailable.", 503);
  assertH3SceneProofRequest(saved, request);
  await dependencies.validate(ownerId, saved, { allowUnissuedBaseline: true });
  // Validate both the unchanged future-video direction and the still direction
  // against approved identities and their selected references.
  const template = await dependencies.pin(materializeAnimaticStill(ownerId, saved, request, config.bucket));
  if (template.references.some(ref => ref.aesthetic)) {
    throw new H3RequestError("Still-to-video continuation with shot and style refs needs a separate frozen continuation request. Choose the named subject and environment sheets for this still.", 422);
  }
  if (!request.animaticShot) materializeH3Job(ownerId, saved, { ...request.shot, prompt: request.creativePrompt }, config.bucket);
  const receipts = []; let total = 0;
  for (const ref of template.references) {
    const raw = await dependencies.download(ref);
    total += raw.bytes.byteLength;
    if (total > 128 * 1024 * 1024 || !["image/png", "image/jpeg", "image/webp"].includes(raw.mime)
      || raw.etag !== ref.etag) throw new H3RequestError("The selected raw reference package changed or exceeds its bound.", 409);
    receipts.push({ assetId: ref.assetId, etag: raw.etag,
      rawSha256: createHash("sha256").update(new Uint8Array(raw.bytes)).digest("hex") });
  }
  const descriptor = buildH3StillDescriptor(request, template, receipts);
  return { saved, template, descriptor };
}

/** Freeze canonical bytes before dispatch, and recheck the saved plan after the
 * potentially slow conditional reference reads. Never rewrite project content. */
export async function prepareH3StillJob(ownerId: string, value: unknown, dependencies: Dependencies = defaults) {
  let request: H3StillRequest;
  let context: Awaited<ReturnType<typeof loadH3StillContext>>;
  try {
    request = parseH3StillRequest(value);
    context = await loadH3StillContext(ownerId, request, dependencies);
    const latest = await dependencies.read(ownerId, request.shot.projectId, { fresh: true });
    if (!latest || h3StillDigest(latest) !== h3StillDigest(context.saved)) {
      throw new H3RequestError("The saved project changed while its still references were prepared. Save and review the current shot.", 409);
    }
    await dependencies.validate(ownerId, latest, { allowUnissuedBaseline: true });
    await dependencies.baseline(ownerId, latest);
  } catch (error) {
    if ((error instanceof H3RequestError || error instanceof SourceConfirmationError) && [400, 409, 422].includes(error.status)) {
      const envelope = stillIntentEnvelope(value);
      let rejected = false;
      try { rejected = envelope !== null && await dependencies.rejectIntent(ownerId, envelope.projectId, envelope.requestIntentId, envelope.attempt); }
      catch { /* Unknown storage state must retain the saved intent. */ }
      if (rejected) throw new H3StillAdmissionError(error.message, error.status);
    }
    throw error;
  }
  return dependencies.create({ ownerId, projectId: request.shot.projectId, descriptor: context.descriptor,
    shotRequest: request.shot, template: context.template, requestIntentId: request.requestIntentId, attempt: request.attempt,
    ...(request.sceneProof ? { sceneProof: request.sceneProof } : {}),
    ...(request.animaticShot ? { animaticShot: request.animaticShot } : {}) });
}

/** Re-resolve every authority before an unsubmitted worker can touch the GPU. */
export async function validateH3StillJobContext(job: H3StillJob, dependencies: Dependencies = defaults) {
  const saved = await dependencies.read(job.ownerId, job.projectId, { fresh: true });
  const config = dependencies.config();
  if (!saved || !config) throw new H3RequestError("The saved still project is unavailable.", 409);
  await dependencies.validate(job.ownerId, saved);
  const request = job.animaticShot ? savedAnimaticStillRequest(saved, job.animaticShot).request : undefined;
  const template = await dependencies.pin(request ? materializeAnimaticStill(job.ownerId, saved, request, config.bucket)
    : materializeH3Job(job.ownerId, saved, job.shotRequest, config.bucket));
  assertH3SceneProofJob(saved, job, template);
  assertAnimaticStillJob(saved, job, template);
  const refs = template.references.map(({ assetId, canonicalName, role, bucket, objectKey, version, etag }) =>
    ({ assetId, canonicalName, role, bucket, objectKey, version, etag }));
  const expected = job.descriptor.body.references.map(({ rawSha256: _rawSha256, ...ref }) => { void _rawSha256; return ref; });
  if (h3StillDigest(refs) !== h3StillDigest(expected)
    || template.target.timelineItemId !== job.descriptor.body.target.timelineItemId
    || template.target.requirementId !== job.descriptor.body.target.requirementId) {
    throw new H3RequestError("The still target or selected reference versions changed before generation.", 409);
  }
  return template;
}
