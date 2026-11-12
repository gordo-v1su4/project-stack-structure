import { auth } from "@/auth";
import type { PersistedStudioProjectDraft } from "@/components/studio/projectPersistence";
import { createStudioProjectId, listStudioProjects, saveStudioProject } from "@/lib/studioProjectStore";
import { StudioProjectConflictError } from "@/lib/studioProjectObjectStore";
import { readStudioJsonBody, studioJsonBodyErrorResponse, studioJsonResponse } from "@/lib/studioJsonTransportServer";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();
  const projects = await listStudioProjects(session.user.id, { deleted: new URL(request.url).searchParams.get("deleted") === "true" });
  return Response.json({ success: true, projects, user: session.user });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();

  let body: { name?: unknown; draft?: unknown; projectId?: unknown };
  try { body = await readStudioJsonBody(request) as typeof body; }
  catch (error) { const response = studioJsonBodyErrorResponse(error); if (response) return response; throw error; }
  if (!isPersistedDraft(body?.draft)) {
    return Response.json({ success: false, error: "A valid Studio project draft is required." }, { status: 400 });
  }
  const projectId = typeof body.projectId === "string" && body.projectId.trim()
    ? body.projectId
    : createStudioProjectId();
  const name = typeof body.name === "string" ? body.name : body.draft.analysis?.sourceLabel || "Untitled project";
  try {
    const saved = await saveStudioProject({ ownerId: session.user.id, projectId, name, draft: body.draft, expectedRevision: null });
    return studioJsonResponse(request, { success: true, saved }, 201);
  } catch (error) {
    if (error instanceof StudioProjectConflictError) return Response.json({ success: false, error: error.message, code: "PROJECT_SAVE_CONFLICT" }, { status: error.status });
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
