import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { getMediaGatewayConfig } from "./mediaGateway";

export class StudioProjectConflictError extends Error {
  constructor(message = "Another window changed this saved project. Your changes are still in this window; reload the saved project before saving again.", public readonly status = 409) {
    super(message);
    this.name = "StudioProjectConflictError";
  }
}

export function requireStudioProjectRevision(value: string | null | undefined): string {
  if (!value) throw new StudioProjectConflictError("Reload this saved project before saving it; this window has no saved revision.", 428);
  if (value.length > 256 || value === "*" || /[\r\n]/.test(value)) throw new StudioProjectConflictError("The saved project revision is invalid.", 400);
  return value;
}

export type StudioObjectVersion<T> = { value: T; revision: string };
export type StudioJsonObjectStore = {
  read<T>(key: string): Promise<StudioObjectVersion<T> | null>;
  write<T>(key: string, value: T, expectedRevision: string | null): Promise<string>;
};

let cached: { fingerprint: string; client: S3Client; bucket: string } | undefined;
function storage() {
  const gateway = getMediaGatewayConfig();
  const endpoint = process.env.RUSTFS_S3_ENDPOINT;
  const accessKeyId = process.env.RUSTFS_ACCESS_KEY;
  const secretAccessKey = process.env.RUSTFS_SECRET_KEY;
  if (!gateway || !endpoint || !accessKeyId || !secretAccessKey || new URL(endpoint).protocol !== "https:") {
    throw new Error("Durable project storage is not configured.");
  }
  const fingerprint = createHash("sha256").update(JSON.stringify([endpoint, accessKeyId, secretAccessKey, process.env.RUSTFS_REGION, gateway.bucket])).digest("hex");
  if (cached?.fingerprint === fingerprint) return cached;
  cached?.client.destroy();
  const client = new S3Client({ endpoint, region: process.env.RUSTFS_REGION || "us-east-1", forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey }, maxAttempts: 1,
    requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" });
  cached = { fingerprint, client, bucket: gateway.bucket };
  return cached;
}

const status = (error: unknown) => (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
export const studioProjectObjects: StudioJsonObjectStore = {
  async read<T>(key: string): Promise<StudioObjectVersion<T> | null> {
    const { client, bucket } = storage();
    try {
      const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: AbortSignal.timeout(30_000) });
      if (!result.Body || !result.ETag) throw new Error("Saved project has no durable revision.");
      if ((result.ContentLength ?? 0) > 64 * 1024 * 1024) throw new Error("Saved project exceeds its storage bound.");
      const body = await result.Body.transformToString();
      if (Buffer.byteLength(body) > 64 * 1024 * 1024) throw new Error("Saved project exceeds its storage bound.");
      return { value: JSON.parse(body) as T, revision: result.ETag };
    } catch (error) { if (status(error) === 404) return null; throw error; }
  },
  async write<T>(key: string, value: T, expectedRevision: string | null): Promise<string> {
    const { client, bucket } = storage();
    const body = JSON.stringify(value);
    if (Buffer.byteLength(body) > 64 * 1024 * 1024) throw new Error("Saved project exceeds its storage bound.");
    try {
      const result = await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: "application/json",
        ...(expectedRevision === null ? { IfNoneMatch: "*" } : { IfMatch: requireStudioProjectRevision(expectedRevision) }) }),
      { abortSignal: AbortSignal.timeout(30_000) });
      if (!result.ETag) throw new Error("Project save acknowledgment has no revision. Reload the saved project before another save.");
      return result.ETag;
    } catch (error) {
      if (status(error) === 409 || status(error) === 412) throw new StudioProjectConflictError();
      throw error;
    }
  },
};

/** Retry only the index merge; an obsolete project body is never resubmitted. */
export async function mergeStudioProjectIndex<T extends { id: string; updatedAt: string }>(
  objects: StudioJsonObjectStore, key: string, readProject: () => Promise<T>,
): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await objects.read<{ version: 1; projects: T[] }>(key);
    const entries = current?.value.projects;
    if (current && (!Array.isArray(entries) || current.value.version !== 1)) throw new Error("Saved project index is invalid.");
    // Read the authoritative body AFTER taking the index revision. A delayed
    // merge then either publishes the current body or loses to a newer index
    // commit and repeats this read; timestamps never decide commit order.
    const project = await readProject();
    const next = { version: 1 as const, projects: [project, ...(entries ?? []).filter(entry => entry.id !== project.id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) };
    try { await objects.write(key, next, current?.revision ?? null); return; }
    catch (error) { if (!(error instanceof StudioProjectConflictError) || attempt === 4) throw error; }
  }
}
