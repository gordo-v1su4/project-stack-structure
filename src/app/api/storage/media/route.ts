import { mediaUploadBelongsToOwner } from "@/lib/essentiaUpload";
import { buildMediaGatewayFileUrl, getMediaGatewayConfig, normalizeMediaPath } from "@/lib/mediaGateway";
import { getSessionUser, unauthorizedResponse } from "@/lib/session";
import { canReadMediaObject } from "@/lib/studioMediaAccess";
import { isCanonicalStudioMetadata, isSafeStudioObjectKey } from "@/lib/studioMetadataPrivacy";
import { isOwnedDraftStoragePath } from "@/lib/studioDraftPolicy";
import { getMediaThumbnail, ThumbnailError } from "@/lib/mediaThumbnail";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return unauthorizedResponse("Sign in with GitHub to stream project media.");

  const url = new URL(request.url);
  const bucket = url.searchParams.get("bucket") ?? "";
  const objectKey = normalizeMediaPath(url.searchParams.get("objectKey") ?? "");
  const config = getMediaGatewayConfig();
  if (!config) return Response.json({ error: "Media gateway is not configured." }, { status: 503 });
  if (bucket !== config.bucket) return Response.json({ error: `bucket must be ${config.bucket}.` }, { status: 400 });
  if (!objectKey.startsWith("media-uploads/") || !isSafeStudioObjectKey(objectKey)) {
    return Response.json({ error: "objectKey must live under media-uploads/." }, { status: 400 });
  }

  const isLegacyRawMediaPool = /^media-uploads\/(video-source|source-audio)\//i.test(objectKey);
  const metadata = isCanonicalStudioMetadata(bucket, objectKey);
  const canRead = mediaUploadBelongsToOwner(objectKey, user.id)
    || isOwnedDraftStoragePath(objectKey, user.id)
    || (!metadata && (isLegacyRawMediaPool || await canReadMediaObject({ userId: user.id, bucket, objectKey })));
  if (!canRead) return Response.json({ error: "Object does not belong to the current user." }, { status: 403 });

  const thumbnail = url.searchParams.get("thumbnail");
  if (thumbnail !== null) {
    if (!["320", "640"].includes(thumbnail) || metadata || request.headers.has("range")) {
      return Response.json({ error: "Use a supported image thumbnail size without a byte range." }, { status: 400 });
    }
    try {
      // Source identity/version and owner isolate the bounded cache. Authorization
      // above still runs before either cached bytes or an ETag response is returned.
      const key = JSON.stringify([user.id, bucket, objectKey, thumbnail, url.searchParams.get("v")]);
      const result = await getMediaThumbnail(key, Number(thumbnail) as 320 | 640, () => fetch(buildMediaGatewayFileUrl(config, bucket, objectKey), {
        cache: "no-store", headers: { Authorization: `Bearer ${config.token}` },
        signal: AbortSignal.timeout(20_000),
      }));
      const headers = { "content-type": "image/webp", "cache-control": "private, no-cache", etag: result.etag,
        "cross-origin-resource-policy": "same-origin", "x-content-type-options": "nosniff" };
      if (request.headers.get("if-none-match") === result.etag) return new Response(null, { status: 304, headers });
      return new Response(new Uint8Array(result.bytes), { headers });
    } catch (error) {
      return Response.json({ error: error instanceof ThumbnailError ? error.message : "Image thumbnail could not be prepared." },
        { status: error instanceof ThumbnailError ? error.status : 502 });
    }
  }

  const range = request.headers.get("range");
  let upstream: Response;
  try {
    upstream = await fetch(buildMediaGatewayFileUrl(config, bucket, objectKey), {
      cache: "no-store",
      headers: { Authorization: `Bearer ${config.token}`, ...(range ? { range } : {}) },
      // Metadata must be served by the authenticated gateway, never an unsigned
      // S3 redirect (including while an older gateway is still deployed).
      redirect: metadata ? "manual" : "follow",
      signal: request.signal,
    });
  } catch {
    return Response.json({ error: "Project media could not be streamed." }, { status: 502 });
  }
  if (!upstream.ok || !upstream.body) {
    await upstream.body?.cancel();
    const status = upstream.status >= 400 && upstream.status <= 599 ? upstream.status : 502;
    return Response.json({ error: "Project media could not be streamed." }, { status });
  }

  const headers = new Headers({
    "cache-control": "private, no-store",
    "cross-origin-resource-policy": "same-origin",
    "vary": "Range",
  });
  for (const name of ["accept-ranges", "content-length", "content-range", "content-type", "etag", "last-modified"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }

  return new Response(upstream.body, { status: upstream.status, headers });
}
