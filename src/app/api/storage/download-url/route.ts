import { mediaUploadBelongsToOwner } from "@/lib/essentiaUpload";
import { canReadMediaObject } from "@/lib/studioMediaAccess";
import { buildMediaGatewayFileUrl, getMediaGatewayConfig, normalizeMediaPath } from "@/lib/mediaGateway";
import { getSessionUser, unauthorizedResponse } from "@/lib/session";
import { isCanonicalStudioMetadata, isSafeStudioObjectKey } from "@/lib/studioMetadataPrivacy";
import { isOwnedDraftStoragePath } from "@/lib/studioDraftPolicy";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return unauthorizedResponse("Sign in with GitHub to read project media.");
  try {
    const url = new URL(request.url);
    const bucket = url.searchParams.get("bucket") ?? "";
    const objectKey = normalizeMediaPath(url.searchParams.get("objectKey") ?? "");

    const config = getMediaGatewayConfig();
    if (!config) return Response.json({ error: "Media gateway is not configured." }, { status: 503 });
    if (bucket !== config.bucket) {
      return Response.json({ error: `bucket must be ${config.bucket}.` }, { status: 400 });
    }
    if (!objectKey.startsWith("media-uploads/") || !isSafeStudioObjectKey(objectKey)) {
      return Response.json({ error: "objectKey must live under media-uploads/." }, { status: 400 });
    }
    // Pre-scoping raw-media pools are capability-addressed (unguessable UUID
    // keys already public via stored mediaUrl values), so they stay readable;
    // anything else outside the caller's own scope is rejected.
    const isLegacyRawMediaPool = /^media-uploads\/(video-source|source-audio)\//i.test(objectKey);
    const metadata = isCanonicalStudioMetadata(bucket, objectKey);
    const owned = mediaUploadBelongsToOwner(objectKey, user.id) || isOwnedDraftStoragePath(objectKey, user.id);
    if (!owned && (metadata || (!isLegacyRawMediaPool && !(await canReadMediaObject({ userId: user.id, bucket, objectKey }))))) {
      return Response.json({ error: "Object does not belong to the current user." }, { status: 403 });
    }

    const fileUrl = metadata
      ? `/api/storage/media?${new URLSearchParams({ bucket, objectKey })}`
      : buildMediaGatewayFileUrl(config, config.bucket, objectKey);
    return Response.json({ success: true, fileUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Download URL resolution failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
