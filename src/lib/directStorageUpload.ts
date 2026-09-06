import { createHmac, timingSafeEqual } from "node:crypto";
import {
  S3Client, CreateMultipartUploadCommand, UploadPartCommand,
  ListPartsCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { essentiaUploadOwnerSegment } from "./essentiaUpload";
import { buildMediaGatewayFileUrl, getMediaGatewayConfig } from "./mediaGateway";

export const DIRECT_UPLOAD_PART_BYTES = 32 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;
const UPLOAD_SECONDS = 60 * 60;
const MIME_TYPES = new Set([
  "image/png", "image/jpeg", "image/webp", "image/avif", "image/gif",
  "video/mp4", "video/quicktime", "video/webm", "video/x-matroska", "video/x-msvideo",
  "audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp3", "audio/mp4", "audio/aac",
  "audio/flac", "audio/x-flac", "audio/ogg", "audio/webm", "audio/aiff", "audio/x-aiff",
  "application/octet-stream", "application/json",
]);

export class DirectUploadError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

type UploadReceipt = {
  owner: string; bucket: string; key: string; uploadId: string;
  size: number; mime: string; expires: number;
};

function config() {
  const gateway = getMediaGatewayConfig();
  const endpoint = process.env.RUSTFS_S3_ENDPOINT;
  const accessKeyId = process.env.RUSTFS_ACCESS_KEY;
  const secretAccessKey = process.env.RUSTFS_SECRET_KEY;
  if (!gateway || !endpoint || !accessKeyId || !secretAccessKey) {
    throw new DirectUploadError("Direct storage uploads are not configured.", 503);
  }
  if (new URL(endpoint).protocol !== "https:") throw new DirectUploadError("Storage requires HTTPS.", 503);
  const client = new S3Client({
    endpoint, region: process.env.RUSTFS_REGION || "us-east-1", forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
    requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED",
  });
  return { gateway, client, secretAccessKey };
}

export function validateDirectUploadInput(value: unknown) {
  if (!value || typeof value !== "object") throw new DirectUploadError("File metadata is required.");
  const input = value as Record<string, unknown>;
  if (typeof input.size !== "number" || !Number.isSafeInteger(input.size) || input.size <= 0 || input.size > MAX_UPLOAD_BYTES) {
    throw new DirectUploadError("Choose a non-empty file smaller than 2 GiB.");
  }
  const mime = typeof input.contentType === "string" ? input.contentType : "application/octet-stream";
  if (!MIME_TYPES.has(mime)) throw new DirectUploadError("This file type is not supported.");
  const name = typeof input.fileName === "string" ? input.fileName : "";
  if (!name || name.length > 255 || /[\\/\x00-\x1f]/.test(name)) throw new DirectUploadError("Invalid file name.");
  const folder = typeof input.folder === "string" ? input.folder : "media-uploads/source";
  if (!/^media-uploads\/[a-zA-Z0-9_./-]+$/.test(folder) || folder.length > 500 || folder.split("/").some(part => !part || part === "." || part === "..")) {
    throw new DirectUploadError("Invalid media folder.");
  }
  return { size: input.size, mime, name: name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-160), folder };
}

export function signUploadReceipt(receipt: UploadReceipt, secret: string) {
  const body = Buffer.from(JSON.stringify(receipt)).toString("base64url");
  return `${body}.${createHmac("sha256", secret).update(`storage-upload:${body}`).digest("base64url")}`;
}

export function verifyUploadReceipt(token: unknown, owner: string, bucket: string, secret: string): UploadReceipt {
  if (typeof token !== "string" || token.length > 6000) throw new DirectUploadError("Invalid upload receipt.", 403);
  const [body, signature, extra] = token.split(".");
  const expected = createHmac("sha256", secret).update(`storage-upload:${body}`).digest();
  const actual = Buffer.from(signature || "", "base64url");
  if (extra || actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new DirectUploadError("Invalid upload receipt.", 403);
  let receipt: UploadReceipt;
  try { receipt = JSON.parse(Buffer.from(body, "base64url").toString()); }
  catch { throw new DirectUploadError("Invalid upload receipt.", 403); }
  if (receipt.owner !== owner || receipt.bucket !== bucket || receipt.expires <= Date.now()
    || !receipt.key.startsWith(`media-uploads/${essentiaUploadOwnerSegment(owner)}/`)) {
    throw new DirectUploadError("This upload has expired or belongs to another user.", 403);
  }
  return receipt;
}

function target(receipt: UploadReceipt) {
  return { Bucket: receipt.bucket, Key: receipt.key, UploadId: receipt.uploadId };
}

function storedResult(receipt: UploadReceipt, gatewayUrl: string) {
  const url = buildMediaGatewayFileUrl({ url: gatewayUrl }, receipt.bucket, receipt.key);
  return { bucket: receipt.bucket, objectKey: receipt.key, storagePath: receipt.key, publicUrl: url, mediaUrl: url, mime: receipt.mime };
}

export async function startDirectUpload(value: unknown, owner: string) {
  const input = validateDirectUploadInput(value);
  const { client, gateway, secretAccessKey } = config();
  // Always insert the authenticated owner and a fresh upload namespace. A
  // caller cannot select an existing object, another user's key, or a bucket.
  const key = `media-uploads/${essentiaUploadOwnerSegment(owner)}/${input.folder.slice("media-uploads/".length)}/${crypto.randomUUID()}/${input.name}`;
  const created = await client.send(new CreateMultipartUploadCommand({
    Bucket: gateway.bucket, Key: key, ContentType: input.mime,
  }));
  if (!created.UploadId) throw new Error("Storage did not create an upload.");
  const receipt: UploadReceipt = {
    owner, bucket: gateway.bucket, key, uploadId: created.UploadId,
    size: input.size, mime: input.mime, expires: Date.now() + UPLOAD_SECONDS * 1000,
  };
  try {
    const parts = await Promise.all(Array.from({ length: Math.ceil(input.size / DIRECT_UPLOAD_PART_BYTES) }, async (_, index) => ({
      number: index + 1,
      url: await getSignedUrl(client, new UploadPartCommand({
        ...target(receipt), PartNumber: index + 1,
        ContentLength: Math.min(DIRECT_UPLOAD_PART_BYTES, input.size - index * DIRECT_UPLOAD_PART_BYTES),
      }), { expiresIn: UPLOAD_SECONDS }),
    })));
    return { token: signUploadReceipt(receipt, secretAccessKey), partSize: DIRECT_UPLOAD_PART_BYTES, parts };
  } catch (error) {
    await client.send(new AbortMultipartUploadCommand(target(receipt))).catch(() => {});
    throw error;
  }
}

export function validateStoredParts(parts: Array<{ PartNumber?: number; Size?: number; ETag?: string }>, size: number) {
  const count = Math.ceil(size / DIRECT_UPLOAD_PART_BYTES);
  if (parts.length !== count || parts.some((part, index) => part.PartNumber !== index + 1 || !part.ETag
    || part.Size !== Math.min(DIRECT_UPLOAD_PART_BYTES, size - index * DIRECT_UPLOAD_PART_BYTES))) {
    throw new DirectUploadError("Upload is incomplete. Please retry the file.");
  }
  return parts.map(part => ({ PartNumber: part.PartNumber, ETag: part.ETag }));
}

export async function finishDirectUpload(token: unknown, owner: string, abort = false) {
  const { client, gateway, secretAccessKey } = config();
  const receipt = verifyUploadReceipt(token, owner, gateway.bucket, secretAccessKey);
  if (abort) {
    await client.send(new AbortMultipartUploadCommand(target(receipt)));
    return { aborted: true };
  }
  const listed = await client.send(new ListPartsCommand(target(receipt)));
  const parts = validateStoredParts(listed.Parts || [], receipt.size);
  await client.send(new CompleteMultipartUploadCommand({ ...target(receipt), MultipartUpload: { Parts: parts } }));
  return { ...storedResult(receipt, gateway.url), uploadToken: token };
}

/** Verify a completed upload before it is dispatched to a media worker. */
export async function getCompletedDirectUpload(token: unknown, owner: string) {
  const { gateway, secretAccessKey } = config();
  const receipt = verifyUploadReceipt(token, owner, gateway.bucket, secretAccessKey);
  const stored = storedResult(receipt, gateway.url);
  // Use the same durable gateway URL workers consume. This deployment accepts
  // public HEAD but rejects SDK-signed HeadObject requests; no file bytes are
  // read, and the URL is constructed solely from the authenticated receipt.
  const head = await fetch(stored.publicUrl, {
    method: "HEAD", headers: { Authorization: `Bearer ${gateway.token}` },
    signal: AbortSignal.timeout(15000), cache: "no-store",
  });
  if (!head.ok || Number(head.headers.get("content-length")) !== receipt.size
    || head.headers.get("content-type")?.split(";")[0] !== receipt.mime) throw new DirectUploadError("Stored file does not match the upload.");
  return { ...stored, size: receipt.size };
}
