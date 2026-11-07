import { auth } from "@/auth";
import type { PersistedStudioProjectDraft } from "@/components/studio/projectPersistence";
import { readStudioProject, saveStudioProject } from "@/lib/studioProjectStore";
import { requireStudioProjectRevision, StudioProjectConflictError } from "@/lib/studioProjectObjectStore";
import { readStudioJsonBody, studioJsonBodyErrorResponse, studioJsonResponse } from "@/lib/studioJsonTransportServer";
import { validateReferenceMigrationAdoption } from "@/lib/referenceMigrationServer";
import { SourceConfirmationError } from "@/lib/generationScopeServer";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();
  const { projectId } = await context.params;
  const saved = await readStudioProject(session.user.id, projectId, { fresh: true });
  if (!saved) return Response.json({ success: false, error: "Project not found." }, { status: 404 });
  return studioJsonResponse(_request, { success: true, saved });
}

export async function PUT(request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();
  const { projectId } = await context.params;
  let expectedRevision: string;
  try { expectedRevision = requireStudioProjectRevision(request.headers.get("if-match")); }
  catch (error) { if (error instanceof StudioProjectConflictError) return Response.json({ success: false, error: error.message, code: "PROJECT_REVISION_REQUIRED" }, { status: error.status }); throw error; }
  let body: { name?: unknown; draft?: unknown };
  try { body = await readStudioJsonBody(request) as typeof body; }
  catch (error) { const response = studioJsonBodyErrorResponse(error); if (response) return response; throw error; }
  if (!isPersistedDraft(body?.draft)) {
    return Response.json({ success: false, error: "A valid Studio project draft is required." }, { status: 400 });
  }
  const existing = await readStudioProject(session.user.id, projectId, { fresh: true });
  if (!existing) return Response.json({ success: false, error: "Project not found." }, { status: 404 });
  const name = typeof body.name === "string" ? body.name : existing?.project.name || "Untitled project";
  try {
    if (existing.revision !== expectedRevision) throw new StudioProjectConflictError();
    await validateReferenceMigrationAdoption(session.user.id, existing, body.draft, expectedRevision);
    const saved = await saveStudioProject({ ownerId: session.user.id, projectId, name, draft: body.draft, expectedRevision });
    return studioJsonResponse(request, { success: true, saved });
  } catch (error) {
    if (error instanceof StudioProjectConflictError) return Response.json({ success: false, error: error.message, code: "PROJECT_SAVE_CONFLICT" }, { status: error.status });
    if (error instanceof SourceConfirmationError) return Response.json({ success: false, error: error.message, code: "REFERENCE_MIGRATION_INVALID" }, { status: error.status });
    throw error;
  }
}

function isPersistedDraft(value: unknown): value is PersistedStudioProjectDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const draft = value as Partial<PersistedStudioProjectDraft>;
  return (draft.version === 1 || draft.version === 2 || draft.version === 3) && Boolean(draft.storyState) && Array.isArray(draft.videoSources);
}

function unauthorized() {
  return Response.json({ success: false, error: "Sign in with GitHub to access saved projects." }, { status: 401 });
}
