import { createHash } from "node:crypto";
import { getSessionUser, unauthorizedResponse } from "@/lib/session";
import { readStudioProject } from "@/lib/studioProjectStore";
import { readProjectWorkSnapshot } from "@/lib/projectWorkSnapshot";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const user = await getSessionUser();
  if (!user) return unauthorizedResponse();
  const { projectId } = await params;
  if (!/^[\w-]{1,96}$/.test(projectId)) return Response.json({ error: "Project not found." }, { status: 404 });
  const saved = await readStudioProject(user.id, projectId, { fresh: true });
  if (!saved) return Response.json({ error: "Project not found." }, { status: 404 });
  try {
    const snapshot = await readProjectWorkSnapshot(user.id, saved);
    const etag = `"work-${createHash("sha256").update(JSON.stringify(snapshot)).digest("hex")}"`;
    const headers = { "cache-control": "private, no-cache", etag };
    if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    return Response.json(snapshot, { headers });
  } catch {
    return Response.json({ error: "Render receipts could not be read. Current media is unchanged." }, { status: 503 });
  }
}
