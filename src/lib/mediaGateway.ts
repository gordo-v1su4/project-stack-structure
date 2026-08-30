export type MediaGatewayConfig = {
  url: string;
  internalUrl: string | null;
  token: string;
  userId: string;
  bucket: string;
  uploadPrefix: string;
};

export type MediaGatewayUploadResult = {
  bucket: string;
  publicUrl: string;
  mediaUrl?: string;
  storagePath: string;
  objectKey: string;
  mime: string;
};

export type MediaGatewayDownloadResult = {
  bytes: ArrayBuffer;
  fileName: string;
  mime: string;
};

export type MediaGatewayDeleteResult = {
  deleted: number;
  failed: number;
};

export type MediaGatewayChunkReference = {
  bucket: string;
  objectKey: string;
};

const DEFAULT_MEDIA_UPLOAD_PREFIX = "media-uploads";

export function buildMediaGatewayFileUrl(config: Pick<MediaGatewayConfig, "url">, bucket: string, objectKey: string) {
  const safeBucket = encodeURIComponent(bucket);
  const safeKey = normalizeMediaPath(objectKey).split("/").map(encodeURIComponent).join("/");
  return `${config.url}/files/${safeBucket}/${safeKey}`;
}

export async function downloadMediaGatewayFile(args: {
  bucket: string;
  objectKey: string;
  fileName?: string;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): Promise<MediaGatewayDownloadResult> {
  const config = getMediaGatewayConfig(args.env);
  if (!config) {
    throw new Error("Missing RustFS media gateway env. Required: MEDIA_GATEWAY_URL/RUSTFS_MEDIA_API_URL and MEDIA_GATEWAY_TOKEN/MEDIA_API_TOKEN");
  }

  const fetcher = args.fetchImpl ?? fetch;
  const response = await fetcher(buildMediaGatewayFileUrl({ url: config.internalUrl || config.url }, args.bucket, args.objectKey), {
    headers: { Authorization: `Bearer ${config.token}` },
    redirect: "follow",
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Media gateway download failed (${response.status}): ${text.slice(0, 300)}`);
  }

  const objectName = normalizeMediaPath(args.objectKey).split("/").pop() || "media.bin";
  return {
    bytes: await response.arrayBuffer(),
    fileName: args.fileName?.trim() || objectName,
    mime: response.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream",
  };
}

export async function deleteMediaGatewayFiles(args: {
  bucket: string;
  objectKeys: string[];
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): Promise<MediaGatewayDeleteResult> {
  const config = getMediaGatewayConfig(args.env);
  if (!config) {
    throw new Error("Missing RustFS media gateway env. Required: MEDIA_GATEWAY_URL/RUSTFS_MEDIA_API_URL and MEDIA_GATEWAY_TOKEN/MEDIA_API_TOKEN");
  }

  const objectKeys = [...new Set(args.objectKeys.map(normalizeMediaPath).filter(Boolean))];
  if (!args.bucket.trim() || !objectKeys.length) return { deleted: 0, failed: 0 };

  const fetcher = args.fetchImpl ?? fetch;
  const response = await fetcher(`${config.url}/delete`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ bucket: args.bucket.trim(), objectKeys }),
  });
  const payload = await readGatewayJson(response);
  if (!response.ok) {
    throw new Error(`Media gateway delete failed (${response.status}): ${JSON.stringify(payload).slice(0, 300)}`);
  }

  const result = isRecord(payload) ? payload : {};
  const deleted = typeof result.deleted === "number" ? result.deleted : 0;
  const failed = typeof result.failed === "number" ? result.failed : 0;
  if (failed > 0) throw new Error(`Media gateway failed to delete ${failed} temporary object${failed === 1 ? "" : "s"}.`);
  return { deleted, failed };
}

export async function assembleMediaGatewayChunks(args: {
  chunks: MediaGatewayChunkReference[];
  expectedSize: number;
  fileName: string;
  contentType: string;
  folder: string;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): Promise<MediaGatewayUploadResult> {
  if (!args.chunks.length) throw new Error("At least one media chunk is required.");

  const parts: ArrayBuffer[] = [];
  let assembledSize = 0;
  for (const [index, chunk] of args.chunks.entries()) {
    const part = await downloadMediaGatewayFile({
      bucket: chunk.bucket,
      objectKey: chunk.objectKey,
      fileName: `part-${String(index).padStart(5, "0")}.part`,
      env: args.env,
      fetchImpl: args.fetchImpl,
    });
    parts.push(part.bytes);
    assembledSize += part.bytes.byteLength;
  }

  if (assembledSize !== args.expectedSize) {
    throw new Error(`Assembled media size mismatch: expected ${args.expectedSize}, received ${assembledSize}.`);
  }

  const uploaded = await uploadFileToMediaGateway({
    file: new File(parts, args.fileName, { type: args.contentType }),
    folder: args.folder,
    env: args.env,
    fetchImpl: args.fetchImpl,
  });

  try {
    await deleteMediaGatewayFiles({
      bucket: args.chunks[0]?.bucket ?? "",
      objectKeys: args.chunks.map((chunk) => chunk.objectKey),
      env: args.env,
      fetchImpl: args.fetchImpl,
    });
  } catch {
    // The assembled object is already durable. Temporary-part cleanup is best effort.
  }

  return uploaded;
}

export async function downloadJsonFromMediaGateway<T = Record<string, unknown>>(args: {
  bucket: string;
  objectKey: string;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): Promise<T> {
  const source = await downloadMediaGatewayFile({
    ...args,
    fileName: args.objectKey.split("/").pop() || "manifest.json",
  });
  const text = new TextDecoder().decode(source.bytes);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Media gateway JSON object is invalid: ${args.objectKey}`);
  }
}

export function normalizeMediaPath(value: string) {
  return value
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/");
}

export function getMediaGatewayConfig(env: Record<string, string | undefined> = process.env): MediaGatewayConfig | null {
  const url = env.MEDIA_GATEWAY_URL || env.RUSTFS_MEDIA_API_URL;
  const internalUrl = env.MEDIA_GATEWAY_INTERNAL_URL?.trim() || null;
  const token = env.MEDIA_GATEWAY_TOKEN || env.MEDIA_API_TOKEN;
  const userId = env.MEDIA_GATEWAY_USER_ID || env.STACK_STRUCTURE_MEDIA_USER_ID || "stack-structure";
  const bucket = env.MEDIA_GATEWAY_BUCKET || "stack-structure";
  const configuredPrefix = env.MEDIA_GATEWAY_UPLOAD_PREFIX || DEFAULT_MEDIA_UPLOAD_PREFIX;
  const normalizedPrefix = normalizeMediaPath(configuredPrefix);
  const duplicatedBucketPrefix = `${bucket}/media-uploads`;
  const uploadPrefix = normalizedPrefix === duplicatedBucketPrefix || normalizedPrefix.startsWith(`${duplicatedBucketPrefix}/`)
    ? normalizedPrefix.slice(`${bucket}/`.length)
    : normalizedPrefix;

  if (!url || !token) return null;

  return {
    url: url.replace(/\/+$/, ""),
    internalUrl: internalUrl?.replace(/\/+$/, "") || null,
    token,
    userId,
    bucket,
    uploadPrefix: uploadPrefix || DEFAULT_MEDIA_UPLOAD_PREFIX,
  };
}

export function buildStudioMediaFolder(config: Pick<MediaGatewayConfig, "uploadPrefix">, now = new Date()) {
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  return normalizeMediaPath(`${config.uploadPrefix}/${year}/${month}_${day}`);
}

export function resolveMediaGatewayUploadFolder(
  config: Pick<MediaGatewayConfig, "uploadPrefix">,
  explicitFolder?: string,
) {
  const folder = normalizeMediaPath(explicitFolder || buildStudioMediaFolder(config));
  const uploadPrefix = normalizeMediaPath(config.uploadPrefix) || DEFAULT_MEDIA_UPLOAD_PREFIX;

  if (folder === uploadPrefix || folder.startsWith(`${uploadPrefix}/`)) return folder;
  if (folder === DEFAULT_MEDIA_UPLOAD_PREFIX || folder.startsWith(`${DEFAULT_MEDIA_UPLOAD_PREFIX}/`)) {
    return normalizeMediaPath(`${uploadPrefix}/${folder.slice(DEFAULT_MEDIA_UPLOAD_PREFIX.length)}`);
  }

  return folder;
}

export async function uploadFileToMediaGateway(args: {
  file: File;
  folder?: string;
  preserveFileName?: boolean;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): Promise<MediaGatewayUploadResult> {
  const config = getMediaGatewayConfig(args.env);
  if (!config) {
    throw new Error("Missing RustFS media gateway env. Required: MEDIA_GATEWAY_URL/RUSTFS_MEDIA_API_URL and MEDIA_GATEWAY_TOKEN/MEDIA_API_TOKEN");
  }

  const formData = new FormData();
  formData.append("userId", config.userId);
  formData.append("bucket", config.bucket);
  formData.append("folder", resolveMediaGatewayUploadFolder(config, args.folder));
  if (args.preserveFileName) formData.append("preserveFilename", "true");
  formData.append("file", args.file, args.file.name);

  const fetcher = args.fetchImpl ?? fetch;
  // Worker hosts resolve the gateway locally so large payloads bypass Cloudflare's body cap.
  const response = await fetcher(`${(config.internalUrl || config.url)}/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
    },
    body: formData,
  });

  const text = await response.text().catch(() => "");
  if (!response.ok) {
    throw new Error(`Media gateway upload failed (${response.status}): ${text.slice(0, 300)}`);
  }

  const parsed = text.trim() ? JSON.parse(text) as Record<string, unknown> : {};
  return normalizeMediaGatewayUploadResult(parsed, config.bucket, args.file.type || "application/octet-stream");
}

export async function uploadJsonToMediaGateway(args: {
  data: unknown;
  fileName: string;
  folder?: string;
  preserveFileName?: boolean;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): Promise<MediaGatewayUploadResult> {
  const file = new File(
    [JSON.stringify(args.data, null, 2)],
    args.fileName,
    { type: "application/json" },
  );

  return uploadFileToMediaGateway({
    file,
    folder: args.folder,
    preserveFileName: args.preserveFileName,
    env: args.env,
    fetchImpl: args.fetchImpl,
  });
}

export function normalizeMediaGatewayUploadResult(
  payload: Record<string, unknown>,
  fallbackBucket: string,
  fallbackMime: string,
): MediaGatewayUploadResult {
  const publicUrl = readString(payload.publicUrl) || readString(payload.mediaUrl) || readString(payload.url);
  let storagePath = readString(payload.objectKey) || readString(payload.storagePath) || readString(payload.path) || "";
  if (/%2f/i.test(storagePath)) storagePath = decodeURIComponent(storagePath);
  const bucket = readString(payload.bucket) || fallbackBucket;
  const mime = readString(payload.mime) || readString(payload.contentType) || fallbackMime;

  if (!publicUrl || !storagePath) {
    throw new Error("Media gateway upload returned an incomplete payload.");
  }

  return {
    bucket,
    publicUrl,
    mediaUrl: readString(payload.mediaUrl),
    storagePath: normalizeMediaPath(storagePath),
    objectKey: normalizeMediaPath(storagePath),
    mime,
  };
}


export type MediaGatewayVideoJobStatus = "queued" | "processing" | "completed" | "failed";

export type MediaGatewayVideoJob = {
  job_id: string;
  status: MediaGatewayVideoJobStatus;
  stage?: string;
  bucket?: string;
  objectKey?: string;
  source?: Record<string, unknown> | null;
  result?: Record<string, unknown> | null;
  error?: string | null;
  progress_completed?: number;
  progress_total?: number | null;
};

export async function createMediaGatewayVideoJob(args: {
  bucket: string;
  objectKey: string;
  mode?: string;
  profile?: string;
  metadata?: Record<string, unknown>;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): Promise<MediaGatewayVideoJob> {
  const config = getMediaGatewayConfig(args.env);
  if (!config) {
    throw new Error("Missing RustFS media gateway env. Required: MEDIA_GATEWAY_URL/RUSTFS_MEDIA_API_URL and MEDIA_GATEWAY_TOKEN/MEDIA_API_TOKEN");
  }

  const fetcher = args.fetchImpl ?? fetch;
  const response = await fetcher(`${config.url}/video/jobs`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      bucket: args.bucket,
      objectKey: normalizeMediaPath(args.objectKey),
      mode: args.mode ?? "scene-detect",
      profile: args.profile ?? "pyscenedetect-adaptive",
      metadata: args.metadata,
    }),
  });

  const payload = await readGatewayJson(response);
  if (!response.ok) {
    throw new Error(`Media gateway video job failed (${response.status}): ${JSON.stringify(payload).slice(0, 300)}`);
  }
  return normalizeMediaGatewayVideoJob(payload);
}

export async function getMediaGatewayVideoJob(args: {
  jobId: string;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): Promise<MediaGatewayVideoJob> {
  const config = getMediaGatewayConfig(args.env);
  if (!config) {
    throw new Error("Missing RustFS media gateway env. Required: MEDIA_GATEWAY_URL/RUSTFS_MEDIA_API_URL and MEDIA_GATEWAY_TOKEN/MEDIA_API_TOKEN");
  }

  const fetcher = args.fetchImpl ?? fetch;
  const response = await fetcher(`${config.url}/video/jobs/${encodeURIComponent(args.jobId)}`, {
    headers: { Authorization: `Bearer ${config.token}` },
  });
  const payload = await readGatewayJson(response);
  if (!response.ok) {
    throw new Error(`Media gateway video job status failed (${response.status}): ${JSON.stringify(payload).slice(0, 300)}`);
  }
  return normalizeMediaGatewayVideoJob(payload);
}

export async function getMediaGatewayVideoJobResult(args: {
  jobId: string;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): Promise<Record<string, unknown>> {
  const config = getMediaGatewayConfig(args.env);
  if (!config) {
    throw new Error("Missing RustFS media gateway env. Required: MEDIA_GATEWAY_URL/RUSTFS_MEDIA_API_URL and MEDIA_GATEWAY_TOKEN/MEDIA_API_TOKEN");
  }

  const fetcher = args.fetchImpl ?? fetch;
  const response = await fetcher(`${config.url}/video/jobs/${encodeURIComponent(args.jobId)}/result`, {
    headers: { Authorization: `Bearer ${config.token}` },
  });
  const payload = await readGatewayJson(response);
  if (!response.ok) {
    throw new Error(`Media gateway video job result failed (${response.status}): ${JSON.stringify(payload).slice(0, 300)}`);
  }
  return isRecord(payload) ? payload : { result: payload };
}

export function normalizeMediaGatewayVideoJob(payload: unknown): MediaGatewayVideoJob {
  const record = isRecord(payload) ? payload : {};
  const job = isRecord(record.job) ? record.job : record;
  const jobId = readString(job.job_id) || readString(job.jobId) || readString(job.id);
  const status = readString(job.status) as MediaGatewayVideoJobStatus | undefined;

  if (!jobId || !status) {
    throw new Error("Media gateway video job returned an incomplete payload.");
  }

  return {
    job_id: jobId,
    status,
    stage: readString(job.stage),
    bucket: readString(job.bucket),
    objectKey: readString(job.objectKey) || readString(job.storagePath),
    source: isRecord(job.source) ? job.source : null,
    result: isRecord(job.result) ? job.result : null,
    error: readString(job.error) ?? null,
    progress_completed: typeof job.progress_completed === "number" ? job.progress_completed : undefined,
    progress_total: typeof job.progress_total === "number" ? job.progress_total : null,
  };
}

async function readGatewayJson(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => "");
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: text.slice(0, 300) };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
