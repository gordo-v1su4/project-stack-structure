import { getSessionUser, unauthorizedResponse } from "@/lib/session";
import { readStudioProject } from "@/lib/studioProjectStore";
import { animaticContextSha256, normalizeStillAnimaticPlan } from "@/components/studio/stillAnimatic";
import type { AnimaticPreviewSnapshot } from "@/components/studio/animaticPreviewSnapshot";
import { projectReviewCut } from "@/lib/projectReviewCut";
import { reviewPreparationSources } from "@/components/studio/reviewPreparationSources";

export const runtime = "nodejs";

/** A read-only projection: observing a render never autosaves a stale editor. */
export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const user = await getSessionUser();
  if (!user) return unauthorizedResponse();
  const { projectId } = await params;
  if (!/^[\w-]{1,96}$/.test(projectId)) return Response.json({ error: "Project not found." }, { status: 404 });
  const saved = await readStudioProject(user.id, projectId, { fresh: true });
  if (!saved) return Response.json({ error: "Project not found." }, { status: 404 });
  const headers = { "cache-control": "private, no-cache", "etag": saved.revision! };
  if (saved.revision && request.headers.get("if-none-match") === saved.revision) return new Response(null, { status: 304, headers });
  const d = saved.draft, story = d.storyState, project = d.musicVideoProject;
  const normalized = normalizeStillAnimaticPlan(story.stillAnimaticPlan);
  if (story.stillAnimaticPlan && !normalized) return Response.json({ error: "The saved shot plan could not be read." }, { status: 503 });
  const plan = normalized ? { ...normalized, priorVersions: undefined } : null;
  const audio = d.analysis ?? project?.song;
  const audioUrl = audio?.storageBucket && audio.storagePath
    ? `/api/storage/media?${new URLSearchParams({ bucket: audio.storageBucket, objectKey: audio.storagePath })}` : "";
  const snapshot: AnimaticPreviewSnapshot = { projectId, name: saved.project.name, revision: saved.revision ?? "",
    songLabel: audio?.sourceLabel ?? "Original master", audioUrl, plan,
    cut: projectReviewCut(projectId, d, plan),
    reviewSources: reviewPreparationSources(d.videoSources ?? [], d.generatedAssets ?? []),
    contextSha256: project && story.confirmedTreatmentSnapshot && story.sceneProofPlan
      ? animaticContextSha256({ projectId, project, treatment: story.confirmedTreatmentSnapshot,
        storyBeats: story.storyBeats, references: d.referenceAssets ?? [], sceneProofPlan: story.sceneProofPlan }) : "" };
  return Response.json(snapshot, { headers });
}
