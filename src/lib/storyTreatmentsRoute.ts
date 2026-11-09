import { parseStoryTreatmentRequest } from "@/components/studio/storyTreatments";
import { getSessionUser, unauthorizedResponse } from "@/lib/session";
import { isStoryTreatmentConfigured } from "@/lib/storyTreatmentGateway";
import { queueStoryTreatmentGeneration } from "@/lib/storyTreatmentServer";
import type { SessionUser } from "@/lib/session";
import type { StoryTreatmentGenerationResult, StoryTreatmentRequest } from "@/components/studio/storyTreatments";
import { resolveStoryCanon, StoryCanonError, type VerifiedStoryCanon } from "./storyBibleServer";
import type { readStudioProject } from "./studioProjectStore";

export async function handleStoryTreatmentsPost(request: Request, dependencies: {
  getUser?: () => Promise<SessionUser | null>;
  generate?: (input: StoryTreatmentRequest, options: { canon?: VerifiedStoryCanon }) => Promise<StoryTreatmentGenerationResult>;
  queue?: (input: StoryTreatmentRequest, options: { requestIntentId: string; canon?: VerifiedStoryCanon }) => Promise<{ runId: string; model: string }>;
  readProject?: typeof readStudioProject;
  referenceBucket?: string;
  isConfigured?: boolean;
} = {}) {
  const user = await (dependencies.getUser ?? getSessionUser)();
  if (!user) return unauthorizedResponse("Sign in with GitHub to generate story treatments.");
  const configured = dependencies.isConfigured ?? isStoryTreatmentConfigured();
  if (!configured) {
    return Response.json({
      success: false,
      error: "Story generation is not configured. Set SCENE_CAPTION_SMART_GATEWAY_URL and Trigger.dev credentials.",
    }, { status: 503 });
  }

  let input: StoryTreatmentRequest;
  let requestIntentId: string;
  try {
    const suppliedId = request.headers.get("x-story-request-id");
    if (suppliedId !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(suppliedId)) {
      throw new Error("Story request id must be a UUID.");
    }
    requestIntentId = suppliedId?.toLowerCase() ?? crypto.randomUUID();
    input = parseStoryTreatmentRequest(await request.json());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Story treatment request is invalid.";
    return Response.json({ success: false, error: message }, { status: 400 });
  }

  try {
    const canon = await resolveStoryCanon(user.id, input, { read: dependencies.readProject, bucket: dependencies.referenceBucket });
    if (dependencies.generate) {
      const result = await dependencies.generate(input, { canon });
      return Response.json({ success: true, ...result });
    }

    const queued = await (dependencies.queue ?? queueStoryTreatmentGeneration)(input, { requestIntentId, canon });
    return Response.json({
      success: true,
      queued: true,
      orchestration: "trigger.dev",
      runId: queued.runId,
      model: queued.model,
    }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Story treatment generation failed.";
    return Response.json({ success: false, error: message }, { status: error instanceof StoryCanonError ? error.status : 502 });
  }
}
