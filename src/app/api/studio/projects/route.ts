import { auth } from "@/auth";
import type { PersistedStudioProjectDraft } from "@/components/studio/projectPersistence";
import { createStudioProjectId, listStudioProjects, saveStudioProject } from "@/lib/studioProjectStore";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();
  const projects = await listStudioProjects(session.user.id);
  return Response.json({ success: true, projects, user: session.user });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();

  const body = await request.json() as { name?: unknown; draft?: unknown; projectId?: unknown };
  if (!isPersistedDraft(body.draft)) {
    return Response.json({ success: false, error: "A valid Studio project draft is required." }, { status: 400 });
  }
  const projectId = typeof body.projectId === "string" && body.projectId.trim()
    ? body.projectId
    : createStudioProjectId();
  const name = typeof body.name === "string" ? body.name : body.draft.analysis?.sourceLabel || "Untitled project";
  const saved = await saveStudioProject({ ownerId: session.user.id, projectId, name, draft: body.draft });
  return Response.json({ success: true, saved }, { status: 201 });
}

function isPersistedDraft(value: unknown): value is PersistedStudioProjectDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const draft = value as Partial<PersistedStudioProjectDraft>;
  return (draft.version === 1 || draft.version === 2) && Boolean(draft.storyState) && Array.isArray(draft.videoSources);
}

function unauthorized() {
  return Response.json({ success: false, error: "Sign in with GitHub to access saved projects." }, { status: 401 });
}
