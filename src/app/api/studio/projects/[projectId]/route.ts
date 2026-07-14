import { auth } from "@/auth";
import type { PersistedStudioProjectDraft } from "@/components/studio/projectPersistence";
import { readStudioProject, saveStudioProject } from "@/lib/studioProjectStore";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();
  const { projectId } = await context.params;
  const saved = await readStudioProject(session.user.id, projectId);
  if (!saved) return Response.json({ success: false, error: "Project not found." }, { status: 404 });
  return Response.json({ success: true, saved });
}

export async function PUT(request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();
  const { projectId } = await context.params;
  const body = await request.json() as { name?: unknown; draft?: unknown };
  if (!isPersistedDraft(body.draft)) {
    return Response.json({ success: false, error: "A valid Studio project draft is required." }, { status: 400 });
  }
  const existing = await readStudioProject(session.user.id, projectId);
  const name = typeof body.name === "string" ? body.name : existing?.project.name || "Untitled project";
  const saved = await saveStudioProject({ ownerId: session.user.id, projectId, name, draft: body.draft });
  return Response.json({ success: true, saved });
}

function isPersistedDraft(value: unknown): value is PersistedStudioProjectDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const draft = value as Partial<PersistedStudioProjectDraft>;
  return draft.version === 1 && Boolean(draft.storyState) && Array.isArray(draft.videoSources);
}

function unauthorized() {
  return Response.json({ success: false, error: "Sign in with GitHub to access saved projects." }, { status: 401 });
}
