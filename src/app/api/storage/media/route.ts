import { mediaUploadBelongsToOwner } from "@/lib/essentiaUpload";
import { buildMediaGatewayFileUrl, getMediaGatewayConfig, normalizeMediaPath } from "@/lib/mediaGateway";
import { getSessionUser, unauthorizedResponse } from "@/lib/session";
import { canReadMediaObject } from "@/lib/studioMediaAccess";

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
  if (!objectKey.startsWith("media-uploads/")) {
    return Response.json({ error: "objectKey must live under media-uploads/." }, { status: 400 });
  }

  const isLegacyRawMediaPool = /^media-uploads\/(video-source|source-audio)\//i.test(objectKey);
  const canRead = mediaUploadBelongsToOwner(objectKey, user.id)
    || isLegacyRawMediaPool
    || await canReadMediaObject({ userId: user.id, bucket, objectKey });
  if (!canRead) return Response.json({ error: "Object does not belong to the current user." }, { status: 403 });

  const range = request.headers.get("range");
  const upstream = await fetch(buildMediaGatewayFileUrl(config, bucket, objectKey), {
    cache: "no-store",
    headers: range ? { range } : undefined,
  });
  if (!upstream.ok || !upstream.body) {
    return Response.json({ error: "Project media could not be streamed." }, { status: upstream.status || 502 });
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
