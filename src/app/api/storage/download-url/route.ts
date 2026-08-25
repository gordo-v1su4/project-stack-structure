import { canReadMediaObject } from "@/lib/studioMediaAccess";
import { buildMediaGatewayFileUrl, getMediaGatewayConfig } from "@/lib/mediaGateway";
import { getSessionUser, unauthorizedResponse } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return unauthorizedResponse("Sign in with GitHub to read project media.");
  try {
    const url = new URL(request.url);
    const bucket = url.searchParams.get("bucket") ?? "";
    const objectKey = url.searchParams.get("objectKey") ?? "";

    const config = getMediaGatewayConfig();
    if (!config) return Response.json({ error: "Media gateway is not configured." }, { status: 503 });
    if (bucket !== config.bucket) {
      return Response.json({ error: `bucket must be ${config.bucket}.` }, { status: 400 });
    }
    if (!objectKey.startsWith("media-uploads/")) {
      return Response.json({ error: "objectKey must live under media-uploads/." }, { status: 400 });
    }
    // Legacy raw-media pools predate per-user scoping; membership in the
    // caller's saved project is what binds them to this session.
    if (!(await canReadMediaObject({ userId: user.id, bucket, objectKey }))) {
      return Response.json({ error: "Object does not belong to the current user." }, { status: 403 });
    }

    return Response.json({ success: true, fileUrl: buildMediaGatewayFileUrl(config, config.bucket, objectKey) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Download URL resolution failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
