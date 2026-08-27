import { scopeMediaUploadFolder } from "@/lib/essentiaUpload";
import {
  assembleMediaGatewayChunks,
  getMediaGatewayConfig,
  resolveMediaGatewayUploadFolder,
} from "@/lib/mediaGateway";
import {
  LARGE_UPLOAD_SINGLE_SHOT_MAX,
  normalizeChunkedContentType,
  validateOrderedChunkManifest,
} from "@/lib/chunkedMediaUpload";
import { getSessionUser, unauthorizedResponse } from "@/lib/session";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_ASSEMBLED_UPLOAD_BYTES = 256 * 1024 * 1024;

type AssembleUploadRequest = {
  size?: unknown;
  contentType?: unknown;
  fileName?: unknown;
  folder?: unknown;
  chunks?: unknown;
};

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return unauthorizedResponse("Sign in with GitHub to assemble uploaded media.");

  try {
    const config = getMediaGatewayConfig();
    if (!config) throw new Error("Missing RustFS media gateway env.");

    const payload = await request.json() as AssembleUploadRequest;
    const size = typeof payload.size === "number" && Number.isSafeInteger(payload.size)
      ? payload.size
      : 0;
    if (size <= LARGE_UPLOAD_SINGLE_SHOT_MAX || size > MAX_ASSEMBLED_UPLOAD_BYTES) {
      return Response.json({ error: "Assembled upload size is invalid." }, { status: 400 });
    }

    const requestedFolder = typeof payload.folder === "string" ? payload.folder : "";
    const scopedFolder = scopeMediaUploadFolder(requestedFolder, user.id);
    if (!scopedFolder.startsWith("media-uploads/")) {
      return Response.json({ error: "A valid media upload folder is required." }, { status: 400 });
    }

    const resolvedFolder = resolveMediaGatewayUploadFolder(config, scopedFolder);
    const chunks = validateOrderedChunkManifest({
      value: payload.chunks,
      size,
      bucket: config.bucket,
      expectedPrefix: resolvedFolder,
    });
    if (!chunks) {
      return Response.json({ error: "Chunk manifest is invalid or does not belong to this user." }, { status: 400 });
    }

    const fileName = sanitizeFileName(payload.fileName);
    const requestedContentType = normalizeChunkedContentType(payload.contentType, "video/mp4");
    const contentType = requestedContentType.startsWith("video/") ? requestedContentType : "video/mp4";
    const uploaded = await assembleMediaGatewayChunks({
      chunks,
      expectedSize: size,
      fileName,
      contentType,
      folder: resolvedFolder,
    });

    return Response.json({ storageProvider: "rustfs", ...uploaded });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Chunk assembly failed.";
    const status = /Missing RustFS media gateway env/i.test(message) ? 503 : 500;
    return Response.json({ error: message }, { status });
  }
}

function sanitizeFileName(value: unknown) {
  const name = typeof value === "string" ? value.trim() : "assembled.mp4";
  const safe = name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 160);
  return safe || "assembled.mp4";
}
