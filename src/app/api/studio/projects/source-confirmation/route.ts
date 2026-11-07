import { getSessionUser, unauthorizedResponse } from "@/lib/session";
import { readStudioProject } from "@/lib/studioProjectStore";
import { listH3Jobs } from "@/lib/h3JobStore";
import { getMediaGatewayConfig } from "@/lib/mediaGateway";
import { prepareAdditiveSourceConfirmation, SourceConfirmationError } from "@/lib/generationScopeServer";
import { studioJsonResponse } from "@/lib/studioJsonTransportServer";

export const runtime = "nodejs";

/** Explicit confirmation prepares a revision-bound candidate; project writes remain on the CAS endpoint. */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return unauthorizedResponse();
  try {
    const text = await request.text();
    if (text.length > 2048) throw new SourceConfirmationError("Source confirmation metadata is too large.", 400);
    const input = JSON.parse(text);
    if (typeof input.projectId !== "string" || !/^[\w-]{1,96}$/.test(input.projectId)
      || typeof input.expectedRevision !== "string" || !input.expectedRevision || input.expectedRevision.length > 200) {
      throw new SourceConfirmationError("The saved project and its exact revision are required.", 400);
    }
    const saved = await readStudioProject(user.id, input.projectId, { fresh: true });
    if (!saved) throw new SourceConfirmationError("Project not found.", 404);
    const revision = (saved as typeof saved & { revision?: string }).revision;
    if (revision !== input.expectedRevision) throw new SourceConfirmationError("The saved project changed. Reload before confirming its sources.");
    const config = getMediaGatewayConfig();
    if (!config) throw new SourceConfirmationError("Source confirmation storage is unavailable.", 503);
    const jobs = await listH3Jobs(user.id, input.projectId);
    const candidate = await prepareAdditiveSourceConfirmation({ ownerId: user.id, saved, expectedRevision: input.expectedRevision, jobs, bucket: config.bucket });
    return studioJsonResponse(request, { success: true, ...candidate });
  } catch (error) {
    return Response.json({ success: false, error: error instanceof SourceConfirmationError ? error.message : "Source confirmation could not be prepared." },
      { status: error instanceof SourceConfirmationError ? error.status : 503, headers: { "cache-control": "no-store" } });
  }
}
