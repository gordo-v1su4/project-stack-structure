import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client, type GetObjectCommandOutput } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import type { H3GenerationJob, H3ReferenceSnapshot } from "@/components/studio/h3Generation";
import { getMediaGatewayConfig } from "./mediaGateway";
import { normalizeStudioOwnerSegment, normalizeStudioProjectId } from "./studioStoragePaths";
import { h3GenerationJobId, H3RequestError } from "./h3GenerationServer";

/** Individual conditional objects avoid overwriting a project during browser autosave. */
let cached: { fingerprint: string; client: S3Client } | undefined;
function storage() {
  const gateway = getMediaGatewayConfig();
  const endpoint = process.env.RUSTFS_S3_ENDPOINT;
  const accessKeyId = process.env.RUSTFS_ACCESS_KEY;
  const secretAccessKey = process.env.RUSTFS_SECRET_KEY;
  if (!gateway || !endpoint || !accessKeyId || !secretAccessKey || new URL(endpoint).protocol !== "https:") {
    throw new Error("Durable generation storage is not configured.");
  }
  const fingerprint = createHash("sha256").update(JSON.stringify([endpoint, accessKeyId, secretAccessKey, process.env.RUSTFS_REGION])).digest("hex");
  if (cached?.fingerprint === fingerprint) return { bucket: gateway.bucket, client: cached.client };
  cached?.client.destroy();
  const client = new S3Client({ endpoint,
    region: process.env.RUSTFS_REGION || "us-east-1", forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
    requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED",
  });
  cached = { fingerprint, client };
  return { bucket: gateway.bucket, client };
}

export function h3JobPrefix(ownerId: string, projectId: string) {
  return `media-uploads/projects/${normalizeStudioOwnerSegment(ownerId)}/generation-jobs/${normalizeStudioProjectId(projectId)}/`;
}

function key(ownerId: string, projectId: string, jobId: string) {
  if (!/^h3-[a-f0-9]{64}$/.test(jobId)) throw new Error("Invalid generation job id.");
  return `${h3JobPrefix(ownerId, projectId)}${jobId}.json`;
}

function status(error: unknown) {
  const code = (error as { $metadata?: { httpStatusCode?: unknown } })?.$metadata?.httpStatusCode;
  return typeof code === "number" && Number.isInteger(code) && code >= 100 && code <= 599 ? code : undefined;
}

const MAX_REFERENCE_BYTES = 32 * 1024 * 1024;

function referenceLookupError(error: unknown, fullComparison = false) {
  const httpStatus = status(error);
  const name = error instanceof Error ? error.name : "";
  const providerCode = ["AccessDenied", "SignatureDoesNotMatch", "InvalidAccessKeyId", "RequestTimeTooSkewed", "NoSuchKey",
    "ExpiredToken", "InvalidToken", "PermanentRedirect", "AuthorizationHeaderMalformed"].includes(name) ? `, ${name}` : "";
  const boundary = fullComparison ? "Reference metadata full GET after ranged signature rejection" : "Reference metadata lookup";
  return Object.assign(new H3RequestError(httpStatus ? `${boundary} failed (storage HTTP ${httpStatus}${providerCode}).`
    : `${boundary} could not reach durable storage.`, 503), httpStatus ? { $metadata: { httpStatusCode: httpStatus } } : {});
}

function closeReferenceBody(body: GetObjectCommandOutput["Body"]) {
  if (body && "destroy" in body && typeof body.destroy === "function") body.destroy();
}

/** Consume a Node SDK stream without buffering or trusting a smaller declared length. */
async function verifyFullReferenceBody(body: NonNullable<GetObjectCommandOutput["Body"]>, expectedSize: number) {
  if (!(Symbol.asyncIterator in body)) {
    closeReferenceBody(body);
    throw new H3RequestError("Reference metadata full GET did not return a supported bounded stream.", 503);
  }
  let size = 0;
  try {
    for await (const chunk of body as AsyncIterable<Uint8Array>) {
      if (!(chunk instanceof Uint8Array)) throw new H3RequestError("Reference metadata full GET returned invalid image bytes.", 503);
      size += chunk.byteLength;
      if (size > expectedSize || size > MAX_REFERENCE_BYTES) {
        throw new H3RequestError("Reference metadata full GET exceeded its declared image size.", 503);
      }
    }
  } catch (error) {
    closeReferenceBody(body);
    if (error instanceof H3RequestError) throw error;
    throw new H3RequestError("Reference metadata full GET was interrupted while reading durable storage.", 503);
  }
  if (size !== expectedSize) throw new H3RequestError("Reference metadata full GET returned an incomplete image.", 503);
}

/** Pin the actual stored bytes, rather than assuming a filename can never be overwritten. */
export async function pinH3JobReferences(job: H3GenerationJob): Promise<H3GenerationJob> {
  const { client, bucket } = storage();
  const references: H3ReferenceSnapshot[] = [];
  for (const reference of job.references) {
    if (reference.bucket !== bucket) throw new H3RequestError("Reference bucket changed.", 403);
    // Signed HEAD is rejected here, and gateway HEAD redirects to object storage.
    // A signed one-byte GET pins authoritative metadata without following redirects.
    let metadata: GetObjectCommandOutput;
    let fullComparison = false;
    try {
      metadata = await client.send(new GetObjectCommand({ Bucket: bucket, Key: reference.objectKey, Range: "bytes=0-0" }),
        { abortSignal: AbortSignal.timeout(15_000) });
    } catch (error) {
      if (status(error) !== 403 || !(error instanceof Error) || error.name !== "SignatureDoesNotMatch") throw referenceLookupError(error);
      // The public proxy path can reject signed Range while accepting a normal
      // signed GET. Compare only this specific failure, using the same owned key.
      fullComparison = true;
      try {
        metadata = await client.send(new GetObjectCommand({ Bucket: bucket, Key: reference.objectKey }),
          { abortSignal: AbortSignal.timeout(15_000) });
      } catch (fullError) { throw referenceLookupError(fullError, true); }
    }
    const etag = metadata.ETag;
    const range = metadata.ContentRange?.match(/^bytes 0-0\/(\d+)$/);
    const size = fullComparison ? metadata.ContentLength ?? 0 : range ? Number(range[1]) : 0;
    if (fullComparison ? metadata.$metadata.httpStatusCode !== 200 || metadata.ContentRange || !metadata.Body
      : metadata.$metadata.httpStatusCode !== 206 || metadata.ContentLength !== 1 || !range || !metadata.Body) {
      // Never consume a full image if a proxy ignores Range.
      closeReferenceBody(metadata.Body);
      throw new H3RequestError(fullComparison ? "Reference metadata full GET did not return a complete image response."
        : "Reference metadata lookup did not return the requested one-byte range.", 503);
    }
    if (!etag || !Number.isSafeInteger(size) || size < 1 || size > MAX_REFERENCE_BYTES
      || !/^image\/(?:png|jpeg|webp)(?:;|$)/.test(metadata.ContentType ?? "")) {
      closeReferenceBody(metadata.Body);
      throw new H3RequestError("H3 references must be PNG, JPEG or WebP images smaller than 32 MiB.");
    }
    if (fullComparison) {
      await verifyFullReferenceBody(metadata.Body!, size);
      console.info("[H3 references] Signed full GET verified after ranged SignatureDoesNotMatch.");
    } else {
      let bytes;
      try { bytes = await metadata.Body!.transformToByteArray(); }
      catch { throw new H3RequestError("Reference metadata lookup was interrupted while reading durable storage.", 503); }
      if (bytes.length !== 1) throw new H3RequestError("Reference metadata lookup returned an incomplete byte range.", 503);
    }
    references.push({ ...reference, etag,
      version: createHash("sha256").update(JSON.stringify([reference.version, etag])).digest("hex") });
  }
  return { ...job, references, id: h3GenerationJobId(job.ownerId, job.request, references, {
    profile: job.profile, conditioningPreparationVersion: job.conditioningPreparationVersion, ...(job.firstFrame ? { firstFrame: job.firstFrame } : {}),
  }) };
}

export async function downloadH3ReferenceImage(reference: H3ReferenceSnapshot) {
  const { client, bucket } = storage();
  if (reference.bucket !== bucket || !reference.etag) throw new Error("The immutable reference version is unavailable.");
  let response: GetObjectCommandOutput | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: reference.objectKey, IfMatch: reference.etag }), { abortSignal: AbortSignal.timeout(120_000) });
      break;
    } catch (error) {
      // Retry only this transport rejection; every attempt keeps the same signed conditional read.
      // A 412, unrelated 403, or changed bytes must never become an unconditional GET.
      if (attempt !== 0 || status(error) !== 403 || !(error instanceof Error) || error.name !== "SignatureDoesNotMatch") throw referenceLookupError(error);
      console.info("[H3 references] Retrying the same conditional GET after storage HTTP 403 SignatureDoesNotMatch.");
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  if (!response || response.ETag !== reference.etag) {
    closeReferenceBody(response?.Body);
    throw new Error("The immutable reference response version changed.");
  }
  if (!response.ContentLength || response.ContentLength > 32 * 1024 * 1024) throw new Error("The reference exceeds the supported image size.");
  const bytes = await response.Body!.transformToByteArray();
  if (bytes.byteLength !== response.ContentLength || bytes.byteLength > MAX_REFERENCE_BYTES) throw new Error("The immutable reference response was incomplete or exceeded its bound.");
  return { bytes: new Uint8Array(bytes).buffer, mime: response.ContentType?.split(";")[0]?.trim() ?? "", etag: response.ETag };
}

async function readVersion(ownerId: string, projectId: string, jobId: string) {
  const { client, bucket } = storage();
  try {
    const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key(ownerId, projectId, jobId) }), { abortSignal: AbortSignal.timeout(15_000) });
    const job = JSON.parse(await result.Body!.transformToString()) as H3GenerationJob;
    if (job.version !== 1 || job.id !== jobId || job.ownerId !== ownerId || job.projectId !== projectId) {
      throw new Error("Generation job ownership does not match.");
    }
    return { job, etag: result.ETag };
  } catch (error) { if (status(error) === 404) return null; throw error; }
}

export async function readH3Job(ownerId: string, projectId: string, jobId: string) {
  return (await readVersion(ownerId, projectId, jobId))?.job ?? null;
}

function intentKey(job: H3GenerationJob, attempt = job.request.attempt ?? 0) {
  if (!/^[a-f0-9-]{36}$/i.test(job.request.requestIntentId)) throw new H3RequestError("Invalid generation intent.");
  return `${h3JobPrefix(job.ownerId, job.projectId)}intent-${job.request.requestIntentId}-${attempt}.json`;
}

/** One transport intent/attempt can never mutate into a different GPU request. */
export async function claimH3GenerationIntent(job: H3GenerationJob) {
  const { client, bucket } = storage();
  const readClaim = async (attempt: number) => {
    try {
      const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: intentKey(job, attempt) }), { abortSignal: AbortSignal.timeout(15_000) });
      return JSON.parse(await response.Body!.transformToString()) as { jobId?: string };
    } catch (error) { if (status(error) === 404) return null; throw error; }
  };
  const attempt = job.request.attempt ?? 0;
  if (attempt > 0) {
    const previous = await readClaim(attempt - 1);
    const priorJob = previous?.jobId ? await readH3Job(job.ownerId, job.projectId, previous.jobId) : null;
    if (!priorJob || !["ready", "failed", "cancelled"].includes(priorJob.state)) {
      throw new H3RequestError("Complete or reconcile the preceding attempt before requesting a revision.", 409);
    }
  }
  try {
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: intentKey(job),
      Body: JSON.stringify({ version: 1, ownerId: job.ownerId, projectId: job.projectId,
        requestIntentId: job.request.requestIntentId, attempt, jobId: job.id }), ContentType: "application/json", IfNoneMatch: "*" }),
    { abortSignal: AbortSignal.timeout(15_000) });
  } catch (error) {
    if (status(error) !== 412 && status(error) !== 409) throw error;
    if ((await readClaim(attempt))?.jobId !== job.id) {
      throw new H3RequestError("This request intent already identifies another shot. Use a new deliberate revision intent.", 409);
    }
  }
}

export async function createH3Job(job: H3GenerationJob) {
  const { client, bucket } = storage();
  try {
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key(job.ownerId, job.projectId, job.id),
      Body: JSON.stringify(job), ContentType: "application/json", IfNoneMatch: "*" }), { abortSignal: AbortSignal.timeout(15_000) });
    return job;
  } catch (error) {
    if (status(error) !== 412 && status(error) !== 409) throw error;
    const existing = await readH3Job(job.ownerId, job.projectId, job.id);
    if (!existing) throw error;
    return existing;
  }
}

export async function updateH3Job(ownerId: string, projectId: string, jobId: string,
  change: (current: H3GenerationJob) => H3GenerationJob) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await readVersion(ownerId, projectId, jobId);
    if (!current?.etag) throw new Error("Generation job not found.");
    const next = change(current.job);
    if (next.id !== current.job.id || next.ownerId !== ownerId || next.projectId !== projectId) {
      throw new Error("Generation job identity is immutable.");
    }
    const { client, bucket } = storage();
    try {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key(ownerId, projectId, jobId),
        Body: JSON.stringify({ ...next, updatedAt: new Date().toISOString() }),
        ContentType: "application/json", IfMatch: current.etag }), { abortSignal: AbortSignal.timeout(15_000) });
      return next;
    } catch (error) { if (status(error) !== 412 && status(error) !== 409) throw error; }
  }
  throw new Error("Generation job changed concurrently; retry its status lookup.");
}

export async function listH3Jobs(ownerId: string, projectId: string) {
  const { client, bucket } = storage();
  const jobs: H3GenerationJob[] = [];
  let token: string | undefined;
  do {
    const page = await client.send(new ListObjectsV2Command({ Bucket: bucket,
      Prefix: h3JobPrefix(ownerId, projectId), ContinuationToken: token, MaxKeys: 1000 }), { abortSignal: AbortSignal.timeout(15_000) });
    const ids = (page.Contents ?? []).flatMap(object => {
      const id = object.Key?.split("/").at(-1)?.replace(/\.json$/, "");
      return id && /^h3-[a-f0-9]{64}$/.test(id) ? [id] : [];
    });
    for (let offset = 0; offset < ids.length; offset += 8) {
      const batch = await Promise.all(ids.slice(offset, offset + 8).map(id => readH3Job(ownerId, projectId, id)));
      for (const job of batch) if (job) jobs.push(job);
    }
    token = page.NextContinuationToken;
  } while (token);
  return jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
