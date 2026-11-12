import { getSessionUser, unauthorizedResponse } from "@/lib/session";
import { readStudioProject } from "@/lib/studioProjectStore";
import { projectReviewInputs } from "@/lib/projectReviewCut";
import { normalizeStillAnimaticPlan } from "@/components/studio/stillAnimatic";
import { replacementTargets, type ReplacementOperation } from "@/components/studio/replacementReview";
import { readReplacementReview, writeReplacementReview } from "@/lib/replacementReviewStore";
import { StudioProjectConflictError } from "@/lib/studioProjectObjectStore";

export const runtime = "nodejs";
type Context = { params: Promise<{ projectId: string }> };
const headers = { "cache-control": "private, no-store" };

async function handle(request: Request, context: Context, write: boolean) {
  const user = await getSessionUser();
  if (!user) return unauthorizedResponse();
  const { projectId } = await context.params;
  if (!/^[\w-]{1,96}$/.test(projectId)) return Response.json({ error: "Project not found." }, { status: 404 });
  try {
    const saved = await readStudioProject(user.id, projectId, { fresh: true });
    if (!saved) return Response.json({ error: "Project not found." }, { status: 404 });
    const { base } = projectReviewInputs(saved.project.id, saved.draft, normalizeStillAnimaticPlan(saved.draft.storyState.stillAnimaticPlan) ?? null);
    const targets = replacementTargets(saved.project.id, base);
    if (!write) return Response.json({ projectId: saved.project.id, targets, ...await readReplacementReview(user.id, saved.project.id) }, { headers });
    if (!request.headers.get("content-type")?.startsWith("application/json")) return Response.json({ error: "JSON is required." }, { status: 415 });
    let input: { revision: string | null; operation: ReplacementOperation };
    try {
      const reader = request.body?.getReader();
      if (!reader) throw new Error("Missing body.");
      const chunks: Uint8Array[] = []; let size = 0;
      try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength;
        if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new Error("Body too large."); } chunks.push(part.value); } }
      finally { reader.releaseLock(); }
      input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!input || !(input.revision === null || (typeof input.revision === "string" && input.revision.length <= 256))) throw new Error("Missing revision.");
    } catch { return Response.json({ error: "Invalid replacement review request." }, { status: 400 }); }
    let next;
    try { next = await writeReplacementReview(user.id, saved.project.id, input.revision, targets, input.operation); }
    catch (error) {
      if (error instanceof StudioProjectConflictError) throw error;
      if (error instanceof Error && /^(Invalid replacement|The shot plan changed|The replacement mark no longer)/.test(error.message)) return Response.json({ error: error.message }, { status: 400 });
      throw error;
    }
    return Response.json({ projectId: saved.project.id, targets, ...next }, { headers });
  } catch (error) {
    if (error instanceof StudioProjectConflictError) return Response.json({ error: "Review marks changed in another window. Refresh marks before trying again." }, { status: 409, headers });
    return Response.json({ error: "Review marks are unavailable. Refresh marks before retrying; your cut is unchanged." }, { status: 503, headers });
  }
}
export function GET(request: Request, context: Context) { return handle(request, context, false); }
export function POST(request: Request, context: Context) { return handle(request, context, true); }
