import { open, readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  S3Client,
  UploadPartCommand,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import {
  buildMediaGatewayFileUrl,
  getMediaGatewayConfig,
  resolveMediaGatewayUploadFolder,
  uploadFileToMediaGateway,
  type MediaGatewayUploadResult,
} from "./mediaGateway";

export const WORKER_UPLOAD_PART_BYTES = 32 * 1024 * 1024;
export const MAX_WORKER_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;

/** Upload worker output without routing full-song renders through a browser/body limit. */
export async function uploadWorkerFileToStorage({ filePath, fileName, folder, env = process.env, gatewayUpload = uploadFileToMediaGateway, clientFactory = config => new S3Client(config), fetchImpl = fetch }: {
  filePath: string;
  fileName: string;
  folder: string;
  env?: Record<string, string | undefined>;
  gatewayUpload?: typeof uploadFileToMediaGateway;
  clientFactory?: (config: S3ClientConfig) => S3Client;
  fetchImpl?: typeof fetch;
}): Promise<MediaGatewayUploadResult> {
  const size = (await stat(filePath)).size;
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_WORKER_UPLOAD_BYTES) throw new Error("Worker output must be between 1 byte and 2 GiB.");
  const gateway = getMediaGatewayConfig(env);
  if (!gateway || new URL(gateway.url).protocol !== "https:") throw new Error("Worker output requires configured HTTPS media storage.");
  const endpoint = env.RUSTFS_S3_ENDPOINT?.trim();
  const accessKeyId = env.RUSTFS_ACCESS_KEY?.trim();
  const secretAccessKey = env.RUSTFS_SECRET_KEY?.trim();
  const hasDirectStorage = Boolean(endpoint && accessKeyId && secretAccessKey);
  // Prefer the existing gateway for small outputs. Its internal URL bypasses
  // the public proxy, but its own multipart-body limit can still reject a file.
  if (size <= WORKER_UPLOAD_PART_BYTES || !hasDirectStorage) {
    try {
      return await gatewayUpload({ file: new File([await readFile(filePath)], path.basename(fileName), { type: "video/mp4" }), folder, env });
    } catch (error) {
      if (!hasDirectStorage) throw error;
    }
  }
  if (new URL(endpoint!).protocol !== "https:") throw new Error("Direct worker storage requires HTTPS.");
  const client = clientFactory({
    endpoint, region: env.RUSTFS_REGION || "us-east-1", forcePathStyle: true,
    credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! },
    requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED",
  });
  const key = `${resolveMediaGatewayUploadFolder(gateway, folder)}/${crypto.randomUUID()}/${path.basename(fileName)}`;
  let uploadId: string | undefined;
  let file: Awaited<ReturnType<typeof open>> | undefined;
  try {
    file = await open(filePath, "r");
    const created = await client.send(new CreateMultipartUploadCommand({ Bucket: gateway.bucket, Key: key, ContentType: "video/mp4" }));
    uploadId = created.UploadId;
    if (!uploadId) throw new Error("Storage did not create a multipart worker upload.");
    const parts: Array<{ PartNumber: number; ETag: string }> = [];
    for (let offset = 0; offset < size; offset += WORKER_UPLOAD_PART_BYTES) {
      const length = Math.min(WORKER_UPLOAD_PART_BYTES, size - offset);
      const bytes = Buffer.allocUnsafe(length);
      let read = 0;
      while (read < length) {
        const result = await file.read(bytes, read, length - read, offset + read);
        if (!result.bytesRead) throw new Error("Worker output changed during upload.");
        read += result.bytesRead;
      }
      const partNumber = parts.length + 1;
      const uploaded = await client.send(new UploadPartCommand({ Bucket: gateway.bucket, Key: key, UploadId: uploadId, PartNumber: partNumber, ContentLength: length, Body: bytes }));
      if (!uploaded.ETag) throw new Error("Storage did not acknowledge an uploaded worker part.");
      parts.push({ PartNumber: partNumber, ETag: uploaded.ETag });
    }
    await client.send(new CompleteMultipartUploadCommand({ Bucket: gateway.bucket, Key: key, UploadId: uploadId, MultipartUpload: { Parts: parts } }));
    // This RustFS deployment supports gateway HEAD, not SDK-signed HeadObject.
    const verifyUrl = buildMediaGatewayFileUrl({ url: gateway.internalUrl || gateway.url }, gateway.bucket, key);
    const verified = await fetchImpl(verifyUrl, { method: "HEAD", headers: { Authorization: `Bearer ${gateway.token}` }, signal: AbortSignal.timeout(30_000) });
    if (!verified.ok || Number(verified.headers.get("content-length")) !== size || verified.headers.get("content-type")?.split(";")[0] !== "video/mp4") {
      throw new Error("Stored worker output failed size or media-type verification.");
    }
    const url = buildMediaGatewayFileUrl(gateway, gateway.bucket, key);
    return { bucket: gateway.bucket, objectKey: key, storagePath: key, publicUrl: url, mediaUrl: url, mime: "video/mp4" };
  } catch (error) {
    if (uploadId) await client.send(new AbortMultipartUploadCommand({ Bucket: gateway.bucket, Key: key, UploadId: uploadId })).catch(() => {});
    throw error;
  } finally {
    await file?.close();
    client.destroy();
  }
}
