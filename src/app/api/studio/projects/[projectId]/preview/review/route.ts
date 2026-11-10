import { getSessionUser, unauthorizedResponse } from "@/lib/session";
import { readStudioProject, saveStudioProject } from "@/lib/studioProjectStore";
import { requireStudioProjectRevision, StudioProjectConflictError } from "@/lib/studioProjectObjectStore";
import { animaticContextSha256, normalizeStillAnimaticPlan, prepareAnimaticSave } from "@/components/studio/stillAnimatic";
import { reviewAnimatic } from "@/components/studio/animaticReview";

export const runtime = "nodejs";

/** Explicit human review only; observing Preview remains read-only. */
export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const user = await getSessionUser();
  if (!user) return unauthorizedResponse();
  const { projectId } = await params;
  if (!/^[\w-]{1,96}$/.test(projectId)) return Response.json({ error: "Project not found." }, { status: 404 });
  let expectedRevision: string;
  try { expectedRevision = requireStudioProjectRevision(request.headers.get("if-match")); }
  catch (error) { if (error instanceof StudioProjectConflictError) return Response.json({ error: error.message }, { status: error.status }); throw error; }
  let body: { bindingSha256?: unknown; status?: unknown; note?: unknown };
  try {
    const raw = await request.text();
    if (raw.length > 12_000) throw new Error();
    body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)
      || Object.keys(body).some(key => !["bindingSha256", "status", "note"].includes(key))
      || typeof body.bindingSha256 !== "string" || !/^[a-f0-9]{64}$/.test(body.bindingSha256)
      || !["approved", "revise"].includes(body.status as string)
      || typeof body.note !== "string" || body.note.length > 2000) throw new Error();
  } catch { return Response.json({ error: "A valid animatic review is required." }, { status: 400 }); }
  const saved = await readStudioProject(user.id, projectId, { fresh: true });
  if (!saved) return Response.json({ error: "Project not found." }, { status: 404 });
  if (saved.revision !== expectedRevision) return Response.json({ error: "The project changed. Review the current animatic." }, { status: 409 });
  const d = saved.draft, story = d.storyState, project = d.musicVideoProject;
  const plan = normalizeStillAnimaticPlan(story.stillAnimaticPlan), audio = d.analysis ?? project?.song;
  if (!plan || !project || !story.confirmedTreatmentSnapshot || !story.sceneProofPlan || !audio?.storageBucket || !audio.storagePath) {
    return Response.json({ error: "Prepare the complete animatic and original master before review." }, { status: 409 });
  }
  let draft: typeof d;
  try {
    const context = animaticContextSha256({ projectId, project, treatment: story.confirmedTreatmentSnapshot,
      storyBeats: story.storyBeats, references: d.referenceAssets ?? [], sceneProofPlan: story.sceneProofPlan });
    const next = reviewAnimatic(plan, context, body.bindingSha256 as string, body.status as "approved" | "revise", body.note as string);
    draft = prepareAnimaticSave(projectId, d, next, plan);
  } catch { return Response.json({ error: "The animatic changed or still has missing images. Review the current complete animatic." }, { status: 409 }); }
  try {
    const next = await saveStudioProject({ ownerId: user.id, projectId, name: saved.project.name, draft, expectedRevision });
    return Response.json({ review: next.draft.storyState.stillAnimaticPlan!.review, revision: next.revision }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof StudioProjectConflictError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
