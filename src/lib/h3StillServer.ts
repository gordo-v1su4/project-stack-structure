import { createHash } from "node:crypto";
import { readStudioProject } from "./studioProjectStore";
import { getMediaGatewayConfig } from "./mediaGateway";
import { validateSavedGenerationScope, recordGenerationScopeBaseline } from "./generationScopeServer";
import { materializeH3Job, H3RequestError } from "./h3GenerationServer";
import { pinH3JobReferences, downloadH3ReferenceImage } from "./h3JobStore";
import { buildH3StillDescriptor, parseH3StillRequest, type H3StillRequest } from "./h3StillRequest";
import { createH3StillJob, type H3StillJob } from "./h3StillJobStore";
import { h3StillDigest } from "./h3StillProfile";

type Dependencies = {
  read: typeof readStudioProject; config: typeof getMediaGatewayConfig;
  validate: typeof validateSavedGenerationScope; baseline: typeof recordGenerationScopeBaseline;
  pin: typeof pinH3JobReferences; download: typeof downloadH3ReferenceImage;
  create: typeof createH3StillJob;
};
const defaults: Dependencies = { read: readStudioProject, config: getMediaGatewayConfig,
  validate: validateSavedGenerationScope, baseline: recordGenerationScopeBaseline,
  pin: pinH3JobReferences, download: downloadH3ReferenceImage, create: createH3StillJob };

/** Authenticated API/worker supplies ownerId; the browser supplies no storage or provider paths. */
export async function loadH3StillContext(ownerId: string, request: H3StillRequest,
  dependencies: Dependencies = defaults) {
  const saved = await dependencies.read(ownerId, request.shot.projectId, { fresh: true });
  const config = dependencies.config();
  if (!saved) throw new H3RequestError("Project not found.", 404);
  if (!config) throw new H3RequestError("Generation storage is unavailable.", 503);
  await dependencies.validate(ownerId, saved, { allowUnissuedBaseline: true });
  // Validate both the unchanged future-video direction and the still direction
  // against approved identities and their selected references.
  const template = await dependencies.pin(materializeH3Job(ownerId, saved, request.shot, config.bucket));
  if (template.references.some(ref => ref.aesthetic)) {
    throw new H3RequestError("Still-to-video continuation with shot and style refs needs a separate frozen continuation request. Choose the named subject and environment sheets for this still.", 422);
  }
  materializeH3Job(ownerId, saved, { ...request.shot, prompt: request.creativePrompt }, config.bucket);
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
  const request = parseH3StillRequest(value);
  const context = await loadH3StillContext(ownerId, request, dependencies);
  const latest = await dependencies.read(ownerId, request.shot.projectId, { fresh: true });
  if (!latest || h3StillDigest(latest) !== h3StillDigest(context.saved)) {
    throw new H3RequestError("The saved project changed while its still references were prepared. Save and review the current shot.", 409);
  }
  await dependencies.validate(ownerId, latest, { allowUnissuedBaseline: true });
  await dependencies.baseline(ownerId, latest);
  return dependencies.create({ ownerId, projectId: request.shot.projectId, descriptor: context.descriptor,
    shotRequest: request.shot, template: context.template, requestIntentId: request.requestIntentId, attempt: request.attempt });
}

/** Re-resolve every authority before an unsubmitted worker can touch the GPU. */
export async function validateH3StillJobContext(job: H3StillJob, dependencies: Dependencies = defaults) {
  const saved = await dependencies.read(job.ownerId, job.projectId, { fresh: true });
  const config = dependencies.config();
  if (!saved || !config) throw new H3RequestError("The saved still project is unavailable.", 409);
  await dependencies.validate(job.ownerId, saved);
  const template = await dependencies.pin(materializeH3Job(job.ownerId, saved, job.shotRequest, config.bucket));
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
